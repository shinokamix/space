import { Schema } from "effect";

import { getRuntimeConfig } from "@/shared/runtime/runtime-config";
import {
  CreateSessionResponse,
  RuntimeEvent,
  type ClientEvent,
  type RuntimeEvent as RuntimeEventType,
} from "@space/protocol";

export type RuntimeStatus = "connecting" | "online" | "offline";

const PENDING_TERMINAL_CLOSES_KEY = "space.terminal.pending-closes";
const RETRYABLE_CREATE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type TerminalEvent = Exclude<RuntimeEventType, { readonly type: "runtime.ready" }>;
type StatusListener = (status: RuntimeStatus) => void;
type TerminalListener = (event: TerminalEvent) => void;

export class RuntimeClient {
  private socket: WebSocket | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;
  private started = false;
  private status: RuntimeStatus = "connecting";
  private environmentId: string | undefined;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly terminalListeners = new Map<string, Set<TerminalListener>>();
  private readonly terminalSessions = new Map<
    string,
    { readonly commandId: string; readonly sessionId: Promise<string>; settled: boolean }
  >();
  private readonly pendingTerminalCloses = new Set<string>();

  constructor() {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(PENDING_TERMINAL_CLOSES_KEY) ?? "[]");
      if (Array.isArray(stored)) {
        for (const sessionId of stored) {
          if (typeof sessionId === "string") this.pendingTerminalCloses.add(sessionId);
        }
      }
    } catch {
      // A client can still close sessions while storage is unavailable.
    }
  }

  subscribeStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    this.start();
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeTerminal(sessionId: string, listener: TerminalListener) {
    const listeners = this.terminalListeners.get(sessionId) ?? new Set<TerminalListener>();
    const wasEmpty = listeners.size === 0;
    listeners.add(listener);
    this.terminalListeners.set(sessionId, listeners);
    this.start();
    if (wasEmpty && this.status === "online") {
      this.send({ type: "terminal.attach", sessionId });
    }

    return () => {
      const current = this.terminalListeners.get(sessionId);
      if (!current) return;
      current.delete(listener);
      if (current.size > 0) return;
      this.terminalListeners.delete(sessionId);
      this.send({ type: "terminal.detach", sessionId });
    };
  }

  getOrCreateTerminal(panelId: string, signal?: AbortSignal) {
    const existing = this.terminalSessions.get(panelId);
    if (existing) return existing.sessionId;

    const commandId = this.getTerminalCommandId(panelId);
    const sessionId = this.createTerminalWithRetry(commandId, signal).catch((error: unknown) => {
      const current = this.terminalSessions.get(panelId);
      if (current?.commandId === commandId) {
        this.terminalSessions.delete(panelId);
        if (!isAbortError(error)) this.clearTerminalCommandId(panelId, commandId);
      }
      throw error;
    });
    const attempt = { commandId, sessionId, settled: false };
    this.terminalSessions.set(panelId, attempt);
    void sessionId.then(
      () => {
        attempt.settled = true;
      },
      () => {
        attempt.settled = true;
      },
    );
    signal?.addEventListener(
      "abort",
      () => {
        if (!attempt.settled && this.terminalSessions.get(panelId) === attempt) {
          this.terminalSessions.delete(panelId);
        }
      },
      { once: true },
    );
    return sessionId;
  }

  releaseTerminal(panelId: string, sessionId: string) {
    const current = this.terminalSessions.get(panelId);
    if (!current) return;
    void current.sessionId.then((currentSessionId) => {
      if (currentSessionId === sessionId && this.terminalSessions.get(panelId) === current) {
        this.terminalSessions.delete(panelId);
        this.clearTerminalCommandId(panelId, current.commandId);
      }
    });
  }

  sendTerminalInput(sessionId: string, data: string) {
    this.send({ type: "terminal.input", sessionId, data });
  }

  resizeTerminal(sessionId: string, cols: number, rows: number) {
    this.send({ type: "terminal.resize", sessionId, cols, rows });
  }

  closeTerminal(sessionId: string) {
    this.send({ type: "terminal.close", sessionId });
  }

  getEnvironmentId() {
    return this.environmentId;
  }

  private getTerminalCommandId(panelId: string) {
    const storageKey = `space.terminal.command:${panelId}`;
    try {
      const existing = localStorage.getItem(storageKey);
      if (existing) return existing;
      const commandId = `terminal.create:${panelId}:${crypto.randomUUID()}`;
      localStorage.setItem(storageKey, commandId);
      return commandId;
    } catch {
      return `terminal.create:${panelId}:${crypto.randomUUID()}`;
    }
  }

  private clearTerminalCommandId(panelId: string, commandId: string) {
    try {
      const storageKey = `space.terminal.command:${panelId}`;
      if (localStorage.getItem(storageKey) === commandId) localStorage.removeItem(storageKey);
    } catch {
      // The in-memory attempt still resets when storage is unavailable.
    }
  }

  private start() {
    if (this.started) return;
    this.started = true;
    void this.connect();
  }

  private async createTerminal(commandId: string) {
    const { token, url } = await getRuntimeConfig();
    const response = await fetch(`${url}/commands/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ commandId }),
    });
    if (!response.ok) throw new RuntimeRequestError(response.status, await response.text());
    return Schema.decodeUnknownSync(CreateSessionResponse)(await response.json()).sessionId;
  }

  private createTerminalWithRetry(
    commandId: string,
    signal?: AbortSignal,
    retryAttempt = 0,
  ): Promise<string> {
    this.start();
    if (signal?.aborted) return Promise.reject(createAbortError());
    const request = this.createTerminal(commandId);
    if (signal) {
      void request
        .then((sessionId) => {
          if (signal.aborted) this.queueTerminalClose(sessionId);
        })
        .catch(() => undefined);
    }
    return raceWithAbort(request, signal).catch(async (error: unknown) => {
      if (signal?.aborted || isAbortError(error)) throw createAbortError();
      if (error instanceof RuntimeRequestError) {
        if (!RETRYABLE_CREATE_STATUSES.has(error.status)) throw error;
      } else if (!(error instanceof TypeError)) {
        throw error;
      }
      const delay = Math.min(250 * 2 ** retryAttempt, 5_000);
      await waitForRetry(delay, signal);
      return this.createTerminalWithRetry(commandId, signal, retryAttempt + 1);
    });
  }

  private async connect() {
    this.setStatus(this.retryAttempt === 0 ? "connecting" : "offline");
    try {
      const { token, url } = await getRuntimeConfig();
      const socket = new WebSocket(url.replace(/^http/, "ws") + "/events", [
        "space",
        `space-token.${token}`,
      ]);
      this.socket = socket;
      socket.addEventListener("message", ({ data }) => this.receive(data));
      socket.addEventListener("error", () => socket.close());
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.setStatus("offline");
        this.scheduleReconnect();
      });
    } catch {
      this.setStatus("offline");
      this.scheduleReconnect();
    }
  }

  private receive(data: unknown) {
    let event: RuntimeEventType;
    try {
      event = Schema.decodeUnknownSync(RuntimeEvent)(JSON.parse(String(data)));
    } catch {
      return;
    }

    if (event.type === "runtime.ready") {
      this.environmentId = event.environmentId;
      this.retryAttempt = 0;
      this.setStatus("online");
      for (const sessionId of this.terminalListeners.keys()) {
        this.send({ type: "terminal.attach", sessionId });
      }
      this.flushPendingTerminalCloses();
      return;
    }
    if (event.type === "runtime.error") {
      if (!event.sessionId) return;
      for (const listener of this.terminalListeners.get(event.sessionId) ?? []) listener(event);
      return;
    }
    for (const listener of this.terminalListeners.get(event.sessionId) ?? []) listener(event);
  }

  private scheduleReconnect() {
    if (this.retryTimer) return;
    const delay = Math.min(500 * 2 ** this.retryAttempt, 10_000);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, delay);
  }

  private send(event: ClientEvent) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
      return true;
    }
    return false;
  }

  private queueTerminalClose(sessionId: string) {
    this.pendingTerminalCloses.add(sessionId);
    this.storePendingTerminalCloses();
    this.flushPendingTerminalCloses();
  }

  private flushPendingTerminalCloses() {
    for (const sessionId of this.pendingTerminalCloses) {
      if (!this.send({ type: "terminal.close", sessionId })) return;
      this.pendingTerminalCloses.delete(sessionId);
    }
    this.storePendingTerminalCloses();
  }

  private storePendingTerminalCloses() {
    try {
      localStorage.setItem(
        PENDING_TERMINAL_CLOSES_KEY,
        JSON.stringify([...this.pendingTerminalCloses]),
      );
    } catch {
      // The current client still keeps the close queue in memory.
    }
  }

  private setStatus(status: RuntimeStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

class RuntimeRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const createAbortError = () => new DOMException("Terminal creation was cancelled", "AbortError");

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

const raceWithAbort = <T>(request: Promise<T>, signal?: AbortSignal) => {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal.addEventListener("abort", abort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
};

const waitForRetry = (delay: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timeout = setTimeout(done, delay);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeout);
      reject(createAbortError());
    }
    signal?.addEventListener("abort", abort, { once: true });
  });

export const runtimeClient = new RuntimeClient();
