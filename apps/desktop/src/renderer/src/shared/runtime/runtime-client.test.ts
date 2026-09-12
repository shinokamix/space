import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const { getRuntimeConfig } = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn<() => Promise<{ token: string; url: string }>>(async () => ({
    token: "token",
    url: "http://runtime.test",
  })),
}));

vi.mock("@/shared/runtime/runtime-config", () => ({ getRuntimeConfig }));

import { RuntimeClient } from "./runtime-client";

class TestWebSocket {
  static readonly OPEN = 1;
  readonly readyState = 0;

  addEventListener() {}
  send() {}
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("RuntimeClient terminal creation", () => {
  it("retries a network failure with the same command ID", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("runtime unavailable"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "session-1", created: true }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new RuntimeClient();
    await expect(client.getOrCreateTerminal("panel-1")).resolves.toBe("session-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(fetchMock.mock.calls[0]?.[1]?.body);
  });

  it("stops retrying when terminal creation is cancelled", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const client = new RuntimeClient();
    const created = client.getOrCreateTerminal("panel-1", controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(created).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("queues an accepted session for close when cancellation wins the response race", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const client = new RuntimeClient();
    const created = client.getOrCreateTerminal("panel-1", controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(created).rejects.toMatchObject({ name: "AbortError" });
    resolveFetch?.(
      new Response(JSON.stringify({ sessionId: "orphan-1", created: true }), { status: 201 }),
    );
    await vi.waitFor(() =>
      expect(localStorage.getItem("space.terminal.pending-closes")).toContain("orphan-1"),
    );
  });

  it("keeps an established session when its panel unmounts", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ sessionId: "session-1", created: true }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const client = new RuntimeClient();
    await expect(client.getOrCreateTerminal("panel-1", controller.signal)).resolves.toBe(
      "session-1",
    );
    controller.abort();
    await expect(client.getOrCreateTerminal("panel-1")).resolves.toBe("session-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry protocol and non-transient HTTP failures", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const protocolFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ created: true }), { status: 201 }));
    vi.stubGlobal("fetch", protocolFailure);

    const firstClient = new RuntimeClient();
    await expect(firstClient.getOrCreateTerminal("protocol-panel")).rejects.toThrow("sessionId");
    expect(protocolFailure).toHaveBeenCalledTimes(1);

    const httpFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not implemented", { status: 501 }));
    vi.stubGlobal("fetch", httpFailure);
    const secondClient = new RuntimeClient();
    await expect(secondClient.getOrCreateTerminal("http-panel")).rejects.toThrow("not implemented");
    expect(httpFailure).toHaveBeenCalledTimes(1);
  });

  it("retries selected transient HTTP failures", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "session-1", created: true }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new RuntimeClient();
    await expect(client.getOrCreateTerminal("panel-1")).resolves.toBe("session-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a new command ID for a new terminal lifecycle", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "session-1", created: true }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "session-2", created: true }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new RuntimeClient();
    const firstSessionId = await client.getOrCreateTerminal("panel-1");
    client.releaseTerminal("panel-1", firstSessionId);
    await Promise.resolve();
    await expect(client.getOrCreateTerminal("panel-1")).resolves.toBe("session-2");

    expect(fetchMock.mock.calls[1]?.[1]?.body).not.toBe(fetchMock.mock.calls[0]?.[1]?.body);
  });
});
