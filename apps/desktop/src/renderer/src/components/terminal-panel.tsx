import { useEffect, useRef } from "react";
import * as FitAddonModule from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { RuntimeEvent } from "@space/protocol";

const runtimeUrl = import.meta.env.VITE_RUNTIME_URL ?? "http://127.0.0.1:4310";

export const TerminalPanel = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: { background: "#09090b", foreground: "#e4e4e7" },
    });
    const fit = new FitAddonModule.FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    terminal.writeln("Connecting to Space runtime...");

    const socket = new WebSocket(runtimeUrl.replace(/^http/, "ws") + "/events");
    let sessionId: string | undefined;

    socket.addEventListener("open", () => {
      void fetch(`${runtimeUrl}/commands/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
        .then((response) => response.json() as Promise<{ sessionId: string }>)
        .then((response) => {
          sessionId = response.sessionId;
          terminal.focus();
        })
        .catch((error: unknown) => terminal.writeln(`\r\nRuntime error: ${String(error)}`));
    });
    socket.addEventListener("message", ({ data }) => {
      const event = JSON.parse(String(data)) as RuntimeEvent;
      if (event.type === "terminal.data" && event.sessionId === sessionId)
        terminal.write(event.data);
      if (event.type === "runtime.error") terminal.writeln(`\r\n${event.message}`);
    });

    const input = terminal.onData((data) => {
      if (sessionId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "terminal.input", sessionId, data }));
      }
    });
    let resizeFrame: number | undefined;
    const resize = new ResizeObserver(() => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        fit.fit();
        if (sessionId && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "terminal.resize",
              sessionId,
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          );
        }
      });
    });
    resize.observe(container);

    return () => {
      input.dispose();
      resize.disconnect();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      socket.close();
      terminal.dispose();
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full overflow-hidden p-3" />;
};
