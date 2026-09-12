import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Schema } from "effect";
import type { IPty } from "node-pty";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { WebSocket, type RawData } from "ws";

import { RuntimeEvent, type RuntimeEvent as RuntimeEventType } from "@space/protocol";

import { EnvironmentInUseError } from "./database.js";
import { createRuntimeServer, type RuntimeServer } from "./server.js";

const token = "test-token-that-is-at-least-32-characters-long";
const servers = new Set<ReturnType<typeof createRuntimeServer>>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.shutdown()));
  servers.clear();
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true })));
  directories.clear();
});

const createDatabasePath = async () => {
  const directory = await mkdtemp(join(tmpdir(), "space-runtime-test-"));
  directories.add(directory);
  return join(directory, "space.db");
};

const createRejectingResizeTerminal = (): IPty => ({
  pid: 1,
  cols: 100,
  rows: 30,
  process: "test-shell",
  handleFlowControl: false,
  onData: () => ({ dispose() {} }),
  onExit: () => ({ dispose() {} }),
  resize: () => {
    throw new Error("PTY rejected resize");
  },
  clear() {},
  write() {},
  kill() {},
  pause() {},
  resume() {},
});

const listen = async (
  databasePath?: string,
  spawnTerminal?: Parameters<typeof createRuntimeServer>[0]["spawnTerminal"],
  shutdownGraceMs?: number,
) => {
  const server = createRuntimeServer({
    token,
    databasePath: databasePath ?? (await createDatabasePath()),
    ...(spawnTerminal ? { spawnTerminal } : {}),
    ...(shutdownGraceMs === undefined ? {} : { shutdownGraceMs }),
  });
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
};

const stop = async (server: RuntimeServer) => {
  await server.shutdown();
  servers.delete(server);
};

const waitForEvent = (socket: WebSocket, predicate: (event: RuntimeEventType) => boolean) =>
  new Promise<RuntimeEventType>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for runtime event")),
      5_000,
    );
    const onMessage = (raw: RawData) => {
      const payload = Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw).toString("utf8")
          : Buffer.concat(raw).toString("utf8");
      const event = Schema.decodeUnknownSync(RuntimeEvent)(JSON.parse(payload));
      if (!predicate(event)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(event);
    };
    socket.on("message", onMessage);
  });

const connect = async (url: string) => {
  const socket = new WebSocket(url.replace(/^http/, "ws") + "/events", [
    "space",
    `space-token.${token}`,
  ]);
  await waitForEvent(socket, (event) => event.type === "runtime.ready");
  return socket;
};

const closeSocket = (socket: WebSocket) =>
  new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });

const createSession = async (
  url: string,
  commandId: string,
  options: { readonly cwd?: string; readonly shell?: string } = {},
) => {
  const response = await fetch(`${url}/commands/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ commandId, ...options }),
  });
  return {
    body: (await response.json()) as { sessionId: string; created: boolean },
    status: response.status,
  };
};

describe("runtime server", () => {
  it("rejects unauthenticated requests", async () => {
    const { url } = await listen();
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(401);
  });

  it("rejects requests from non-local origins", async () => {
    const { url } = await listen();
    const response = await fetch(`${url}/health`, {
      headers: { authorization: `Bearer ${token}`, origin: "https://example.com" },
    });
    expect(response.status).toBe(403);
  });

  it("serves health to an authenticated local client", async () => {
    const { url } = await listen();
    const response = await fetch(`${url}/health`, {
      headers: { authorization: `Bearer ${token}`, origin: "http://localhost:5173" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      version: "0.1.0",
      environmentId: expect.any(String),
    });
  });

  it("rejects a second runtime owner for the same environment", async () => {
    const databasePath = await createDatabasePath();
    await listen(databasePath);
    expect(() => createRuntimeServer({ token, databasePath })).toThrow(EnvironmentInUseError);
  });

  it("forces an incomplete HTTP request closed and releases the environment", async () => {
    const databasePath = await createDatabasePath();
    const runtime = await listen(databasePath, undefined, 20);
    const { port } = runtime.server.address() as AddressInfo;
    const connection = createConnection({ host: "127.0.0.1", port });
    await once(connection, "connect");
    connection.write(
      `POST /commands/sessions HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n` +
        `Authorization: Bearer ${token}\r\nContent-Type: application/json\r\n\r\n{`,
    );

    const closed = once(connection, "close");
    await runtime.server.shutdown();
    await closed;
    servers.delete(runtime.server);
    expect(connection.destroyed).toBe(true);

    const nextOwner = createRuntimeServer({ token, databasePath });
    await nextOwner.shutdown();
  });

  it("returns the same session when a create command is retried", async () => {
    const { url } = await listen();
    const first = await createSession(url, "terminal.create:test-panel");
    const second = await createSession(url, "terminal.create:test-panel");

    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(second).toEqual({
      status: 200,
      body: { sessionId: first.body.sessionId, created: false },
    });
  });

  it("rejects reuse of a command ID with a different normalized payload", async () => {
    const { url } = await listen();
    const first = await createSession(url, "terminal.create:payload-conflict", {
      cwd: ".",
    });
    const equivalent = await createSession(url, "terminal.create:payload-conflict", {
      cwd: process.cwd(),
    });
    const conflict = await createSession(url, "terminal.create:payload-conflict", { cwd: "/tmp" });

    expect(first.status).toBe(201);
    expect(equivalent.status).toBe(200);
    expect(conflict.status).toBe(409);
  });

  it("records a spawn failure as an exited session", async () => {
    const databasePath = await createDatabasePath();
    const { url } = await listen(databasePath, () => {
      throw new Error("spawn failed");
    });
    const created = await createSession(url, "terminal.create:spawn-error");
    expect(created.status).toBe(201);
    expect(created.body.created).toBe(true);

    const socket = await connect(url);
    const snapshot = waitForEvent(
      socket,
      (event) => event.type === "terminal.snapshot" && event.sessionId === created.body.sessionId,
    );
    socket.send(JSON.stringify({ type: "terminal.attach", sessionId: created.body.sessionId }));
    await expect(snapshot).resolves.toMatchObject({
      status: "exited",
      exit: { reason: "spawn-error" },
    });
    await closeSocket(socket);
  });

  it("keeps a terminal alive when its subscriber disconnects", async () => {
    const { url } = await listen();
    const { body } = await createSession(url, "terminal.create:reconnect-test");
    const firstSocket = await connect(url);
    const firstSnapshot = waitForEvent(
      firstSocket,
      (event) => event.type === "terminal.snapshot" && event.sessionId === body.sessionId,
    );
    firstSocket.send(JSON.stringify({ type: "terminal.attach", sessionId: body.sessionId }));
    await expect(firstSnapshot).resolves.toMatchObject({ status: "running" });
    await closeSocket(firstSocket);

    const secondSocket = await connect(url);
    const secondSnapshot = waitForEvent(
      secondSocket,
      (event) => event.type === "terminal.snapshot" && event.sessionId === body.sessionId,
    );
    secondSocket.send(JSON.stringify({ type: "terminal.attach", sessionId: body.sessionId }));
    await expect(secondSnapshot).resolves.toMatchObject({ status: "running" });

    const exit = waitForEvent(
      secondSocket,
      (event) => event.type === "terminal.exit" && event.sessionId === body.sessionId,
    );
    secondSocket.send(JSON.stringify({ type: "terminal.close", sessionId: body.sessionId }));
    await expect(exit).resolves.toMatchObject({
      type: "terminal.exit",
      exit: { reason: "user-stop" },
    });
    await closeSocket(secondSocket);
  });

  it("rejects invalid terminal dimensions without changing the snapshot", async () => {
    const { url } = await listen();
    const { body } = await createSession(url, "terminal.create:invalid-resize");
    const socket = await connect(url);
    const firstSnapshot = waitForEvent(
      socket,
      (event) => event.type === "terminal.snapshot" && event.sessionId === body.sessionId,
    );
    socket.send(JSON.stringify({ type: "terminal.attach", sessionId: body.sessionId }));
    await firstSnapshot;

    const error = waitForEvent(
      socket,
      (event) => event.type === "runtime.error" && event.sessionId === body.sessionId,
    );
    socket.send(
      JSON.stringify({ type: "terminal.resize", sessionId: body.sessionId, cols: 0, rows: 30 }),
    );
    await expect(error).resolves.toMatchObject({ type: "runtime.error" });

    const snapshot = waitForEvent(
      socket,
      (event) => event.type === "terminal.snapshot" && event.sessionId === body.sessionId,
    );
    socket.send(JSON.stringify({ type: "terminal.attach", sessionId: body.sessionId }));
    await expect(snapshot).resolves.toMatchObject({ cols: 100, rows: 30 });
    await closeSocket(socket);
  });

  it("does not persist dimensions when the PTY rejects a valid resize", async () => {
    const databasePath = await createDatabasePath();
    const firstRuntime = await listen(databasePath, () => createRejectingResizeTerminal());
    const { body } = await createSession(firstRuntime.url, "terminal.create:rejected-resize");
    const firstSocket = await connect(firstRuntime.url);
    const firstSnapshot = waitForEvent(
      firstSocket,
      (event) => event.type === "terminal.snapshot" && event.sessionId === body.sessionId,
    );
    firstSocket.send(JSON.stringify({ type: "terminal.attach", sessionId: body.sessionId }));
    await firstSnapshot;

    const error = waitForEvent(
      firstSocket,
      (event) => event.type === "runtime.error" && event.sessionId === body.sessionId,
    );
    firstSocket.send(
      JSON.stringify({ type: "terminal.resize", sessionId: body.sessionId, cols: 120, rows: 40 }),
    );
    await expect(error).resolves.toMatchObject({ message: "PTY rejected resize" });
    await closeSocket(firstSocket);
    await stop(firstRuntime.server);

    const secondRuntime = await listen(databasePath);
    const secondSocket = await connect(secondRuntime.url);
    const snapshot = waitForEvent(
      secondSocket,
      (event) => event.type === "terminal.snapshot" && event.sessionId === body.sessionId,
    );
    secondSocket.send(JSON.stringify({ type: "terminal.attach", sessionId: body.sessionId }));
    await expect(snapshot).resolves.toMatchObject({ cols: 100, rows: 30 });
    await closeSocket(secondSocket);
  });

  it("keeps its identity and create receipt after the server is recreated", async () => {
    const databasePath = await createDatabasePath();
    const firstRuntime = await listen(databasePath);
    const firstHealth = (await fetch(`${firstRuntime.url}/health`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((response) => response.json())) as { environmentId: string };
    const first = await createSession(firstRuntime.url, "terminal.create:durable-retry");
    await stop(firstRuntime.server);

    const secondRuntime = await listen(databasePath);
    const secondHealth = (await fetch(`${secondRuntime.url}/health`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((response) => response.json())) as { environmentId: string };
    const retry = await createSession(secondRuntime.url, "terminal.create:durable-retry");

    expect(secondHealth.environmentId).toBe(firstHealth.environmentId);
    expect(retry).toEqual({
      status: 200,
      body: { sessionId: first.body.sessionId, created: false },
    });
  });

  it("recovers a running terminal as interrupted after restart", async () => {
    const databasePath = await createDatabasePath();
    const firstRuntime = await listen(databasePath);
    const created = await createSession(firstRuntime.url, "terminal.create:interrupted");
    await stop(firstRuntime.server);

    const secondRuntime = await listen(databasePath);
    const socket = await connect(secondRuntime.url);
    const snapshot = waitForEvent(
      socket,
      (event) => event.type === "terminal.snapshot" && event.sessionId === created.body.sessionId,
    );
    socket.send(JSON.stringify({ type: "terminal.attach", sessionId: created.body.sessionId }));

    await expect(snapshot).resolves.toMatchObject({
      type: "terminal.snapshot",
      status: "exited",
      data: "",
      exit: { reason: "runtime-restart" },
    });
    await closeSocket(socket);
  });
});
