import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { platform } from "node:os";
import { resolve } from "node:path";

import { Schema } from "effect";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

import { ClientEvent, CreateSessionCommand, type RuntimeEvent } from "@space/protocol";

import {
  CommandConflictError,
  openRuntimeDatabase,
  type TerminalExitReason,
  type TerminalSessionRecord,
} from "./database.js";

type Terminal = ReturnType<typeof pty.spawn>;

interface RuntimeServerOptions {
  readonly token: string;
  readonly databasePath?: string;
  readonly spawnTerminal?: typeof pty.spawn;
  readonly shutdownGraceMs?: number;
}

export type RuntimeServer = Server & { readonly shutdown: () => Promise<void> };

interface Session {
  terminal: Terminal | undefined;
  readonly subscribers: Set<WebSocket>;
  data: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitReason: TerminalExitReason | undefined;
  exitCode: number | undefined;
  stopRequested: boolean;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TERMINAL_BUFFER_CHARS = 1024 * 1024;

const isAllowedOrigin = (origin: string | undefined) => {
  if (origin === undefined || origin === "null" || origin === "file://") return true;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
};

const hasToken = (request: IncomingMessage, token: string) => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

const hasWebSocketToken = (request: IncomingMessage, token: string) => {
  const protocols = request.headers["sec-websocket-protocol"]
    ?.split(",")
    .map((value) => value.trim());
  return protocols?.includes("space") === true && protocols.includes(`space-token.${token}`);
};

const sendJson = (
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
) => {
  const origin = request.headers.origin;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const toSession = (record: TerminalSessionRecord): Session => ({
  terminal: undefined,
  subscribers: new Set(),
  data: "",
  cols: record.cols,
  rows: record.rows,
  status: record.status,
  exitReason: record.exitReason,
  exitCode: record.exitCode,
  stopRequested: false,
});

export const createRuntimeServer = ({
  token,
  databasePath,
  spawnTerminal = pty.spawn,
  shutdownGraceMs = 1_000,
}: RuntimeServerOptions) => {
  if (token.length < 32) throw new Error("SPACE_RUNTIME_TOKEN must contain at least 32 characters");

  const database = openRuntimeDatabase(databasePath);
  database.interruptRunningTerminals(new Date().toISOString());
  const clients = new Map<string, WebSocket>();
  const sessions = new Map<string, Session>();
  let shuttingDown = false;

  const send = (socket: WebSocket, event: RuntimeEvent) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  };

  const broadcast = (session: Session, event: RuntimeEvent) => {
    for (const subscriber of session.subscribers) send(subscriber, event);
  };

  const sendSnapshot = (socket: WebSocket, sessionId: string, session: Session) => {
    if (session.status === "running") {
      send(socket, {
        type: "terminal.snapshot",
        sessionId,
        status: "running",
        data: session.data,
        cols: session.cols,
        rows: session.rows,
      });
      return;
    }
    send(socket, {
      type: "terminal.snapshot",
      sessionId,
      status: "exited",
      data: session.data,
      cols: session.cols,
      rows: session.rows,
      exit:
        session.exitReason === "process-exit"
          ? { reason: "process-exit", code: session.exitCode ?? 0 }
          : { reason: session.exitReason ?? "runtime-restart" },
    });
  };

  const closeSession = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session?.terminal) return;
    session.stopRequested = true;
    session.terminal.kill();
  };

  const findSession = (sessionId: string) => {
    const current = sessions.get(sessionId);
    if (current) return current;
    const record = database.getTerminalSession(sessionId);
    if (!record) return undefined;
    const session = toSession(record);
    sessions.set(sessionId, session);
    return session;
  };

  const detachClient = (socket: WebSocket) => {
    for (const session of sessions.values()) session.subscribers.delete(socket);
  };

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin)) {
      sendJson(request, response, 403, { error: "Origin is not allowed" });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "authorization,content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
      });
      response.end();
      return;
    }

    if (!hasToken(request, token)) {
      sendJson(request, response, 401, { error: "Unauthorized" });
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(request, response, 200, {
        status: "ok",
        version: "0.1.0",
        environmentId: database.environmentId,
      });
      return;
    }

    if (request.method === "POST" && request.url === "/commands/sessions") {
      try {
        const command = Schema.decodeUnknownSync(CreateSessionCommand)(await readJson(request));
        const sessionId = randomUUID();
        const shell =
          command.shell ??
          (platform() === "win32" ? "powershell.exe" : (process.env.SHELL ?? "/bin/sh"));
        const cwd = resolve(command.cwd ?? process.cwd());
        const commandPayload = JSON.stringify({ cwd, shell });
        const result = database.createTerminal({
          commandId: command.commandId,
          sessionId,
          cwd,
          shell,
          cols: 100,
          rows: 30,
          startedAt: new Date().toISOString(),
          commandPayload,
        });
        if (!result.created) {
          if (!sessions.has(result.session.id)) {
            sessions.set(result.session.id, toSession(result.session));
          }
          sendJson(request, response, 200, { sessionId: result.session.id, created: false });
          return;
        }

        const session = toSession(result.session);
        sessions.set(sessionId, session);
        let terminal: Terminal;
        try {
          terminal = spawnTerminal(shell, [], {
            cols: 100,
            cwd,
            env: Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ),
            name: "xterm-256color",
            rows: 30,
          });
        } catch {
          session.status = "exited";
          session.exitReason = "spawn-error";
          database.exitTerminal(sessionId, {
            at: new Date().toISOString(),
            reason: "spawn-error",
          });
          sendJson(request, response, 201, { sessionId, created: true });
          return;
        }
        session.terminal = terminal;
        terminal.onData((data) => {
          session.data = (session.data + data).slice(-MAX_TERMINAL_BUFFER_CHARS);
          broadcast(session, { type: "terminal.data", sessionId, data });
        });
        terminal.onExit(({ exitCode }) => {
          session.terminal = undefined;
          session.status = "exited";
          session.exitReason = session.stopRequested ? "user-stop" : "process-exit";
          session.exitCode = exitCode;
          if (!shuttingDown) {
            database.exitTerminal(sessionId, {
              at: new Date().toISOString(),
              reason: session.exitReason,
              ...(session.exitReason === "process-exit" ? { code: exitCode } : {}),
            });
          }
          broadcast(session, {
            type: "terminal.exit",
            sessionId,
            exit:
              session.exitReason === "process-exit"
                ? { reason: "process-exit", code: exitCode }
                : { reason: "user-stop" },
          });
        });
        sendJson(request, response, 201, { sessionId, created: true });
      } catch (error) {
        sendJson(request, response, error instanceof CommandConflictError ? 409 : 400, {
          error: error instanceof Error ? error.message : "Invalid command",
        });
      }
      return;
    }

    sendJson(request, response, 404, { error: "Not found" });
  });

  const sockets = new WebSocketServer({ noServer: true, handleProtocols: () => "space" });
  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, "http://localhost").pathname : undefined;
    if (
      pathname !== "/events" ||
      !isAllowedOrigin(request.headers.origin) ||
      !hasWebSocketToken(request, token)
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) =>
      sockets.emit("connection", webSocket),
    );
  });

  sockets.on("error", (error) => console.error("Runtime WebSocket server error", error));
  sockets.on("connection", (socket) => {
    socket.on("error", () => socket.close());
    const clientId = randomUUID();
    clients.set(clientId, socket);
    send(socket, {
      type: "runtime.ready",
      timestamp: new Date().toISOString(),
      environmentId: database.environmentId,
    });
    socket.on("close", () => {
      clients.delete(clientId);
      detachClient(socket);
    });
    socket.on("message", (raw) => {
      let eventSessionId: string | undefined;
      try {
        const payload = Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw).toString("utf8")
            : Buffer.concat(raw).toString("utf8");
        const parsed: unknown = JSON.parse(payload);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "sessionId" in parsed &&
          typeof parsed.sessionId === "string"
        ) {
          eventSessionId = parsed.sessionId;
        }
        const event = Schema.decodeUnknownSync(ClientEvent)(parsed);
        eventSessionId = event.sessionId;
        const session = findSession(event.sessionId);
        if (!session) {
          send(socket, {
            type: "runtime.error",
            message: "Terminal session not found",
            sessionId: event.sessionId,
          });
          return;
        }
        if (event.type === "terminal.attach") {
          session.subscribers.add(socket);
          sendSnapshot(socket, event.sessionId, session);
          return;
        }
        if (event.type === "terminal.detach") {
          session.subscribers.delete(socket);
          return;
        }
        if (event.type === "terminal.close") {
          closeSession(event.sessionId);
          return;
        }
        if (!session.subscribers.has(socket)) return;
        if (event.type === "terminal.input") session.terminal?.write(event.data);
        if (event.type === "terminal.resize" && session.terminal) {
          session.terminal.resize(event.cols, event.rows);
          session.cols = event.cols;
          session.rows = event.rows;
          database.resizeTerminal(event.sessionId, event.cols, event.rows);
        }
      } catch (error) {
        send(socket, {
          type: "runtime.error",
          message: error instanceof Error ? error.message : "Invalid event",
          ...(eventSessionId ? { sessionId: eventSessionId } : {}),
        });
      }
    });
  });

  let finalized = false;
  const stopResources = () => {
    shuttingDown = true;
    for (const session of sessions.values()) session.terminal?.kill();
    for (const socket of clients.values()) socket.terminate();
    sockets.close();
  };
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    database.close();
  };
  server.on("close", () => {
    stopResources();
    finalize();
  });
  const shutdown = async () => {
    stopResources();
    if (!server.listening) {
      finalize();
      return;
    }
    await new Promise<void>((done, reject) => {
      const forceClose = setTimeout(() => server.closeAllConnections(), shutdownGraceMs);
      forceClose.unref();
      server.close((error) => {
        clearTimeout(forceClose);
        finalize();
        if (error) reject(error);
        else done();
      });
      server.closeIdleConnections();
    });
  };

  return Object.assign(server, { shutdown });
};
