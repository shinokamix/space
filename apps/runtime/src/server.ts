import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import { Schema } from "effect";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { ClientEvent, CreateSessionCommand, type RuntimeEvent } from "@space/protocol";

type Session = ReturnType<typeof pty.spawn>;

const sessions = new Map<string, Session>();

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

export const createRuntimeServer = () => {
  const clients = new Set<WebSocket>();
  const broadcast = (event: RuntimeEvent) => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-origin": "*",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok", version: "0.1.0" });
      return;
    }

    if (request.method === "POST" && request.url === "/commands/sessions") {
      try {
        const command = Schema.decodeUnknownSync(CreateSessionCommand)(await readJson(request));
        const sessionId = randomUUID();
        const shell =
          command.shell ??
          (platform() === "win32" ? "powershell.exe" : (process.env.SHELL ?? "/bin/zsh"));
        const cwd = command.cwd ?? process.cwd();
        const terminal = pty.spawn(shell, [], {
          cols: 100,
          cwd,
          env: process.env as Record<string, string>,
          name: "xterm-256color",
          rows: 30,
        });
        sessions.set(sessionId, terminal);
        terminal.onData((data) => broadcast({ type: "terminal.data", sessionId, data }));
        terminal.onExit(({ exitCode }) => {
          sessions.delete(sessionId);
          broadcast({ type: "terminal.exit", sessionId, exitCode });
        });
        broadcast({ type: "terminal.opened", sessionId });
        sendJson(response, 201, { sessionId });
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : "Invalid command",
        });
      }
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });

  const sockets = new WebSocketServer({ server, path: "/events" });
  sockets.on("connection", (socket) => {
    clients.add(socket);
    socket.send(
      JSON.stringify({
        type: "runtime.ready",
        timestamp: new Date().toISOString(),
      } satisfies RuntimeEvent),
    );
    socket.on("close", () => clients.delete(socket));
    socket.on("message", (raw) => {
      try {
        const payload = Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw).toString("utf8")
            : Buffer.concat(raw).toString("utf8");
        const event = Schema.decodeUnknownSync(ClientEvent)(JSON.parse(payload));
        const terminal = sessions.get(event.sessionId);
        if (!terminal) return;
        if (event.type === "terminal.input") terminal.write(event.data);
        if (event.type === "terminal.resize") terminal.resize(event.cols, event.rows);
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "runtime.error",
            message: error instanceof Error ? error.message : "Invalid event",
          } satisfies RuntimeEvent),
        );
      }
    });
  });

  return server;
};
