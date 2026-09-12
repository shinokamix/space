import * as FitAddonModule from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import "@xterm/xterm/css/xterm.css";
import { runtimeClient } from "@/shared/runtime";
import type { TerminalExit } from "@space/protocol";

const formatTerminalExit = (exit: TerminalExit) => {
  switch (exit.reason) {
    case "process-exit":
      return `Process exited with code ${exit.code}`;
    case "runtime-restart":
      return "Process ended because the runtime restarted";
    case "spawn-error":
      return "Process failed to start";
    case "user-stop":
      return "Process stopped";
  }
};

interface TerminalProps {
  panelId: string;
}

export const Terminal = ({ panelId }: TerminalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [terminalLifecycle, setTerminalLifecycle] = useState(0);
  const [canRestart, setCanRestart] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Xterm({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: { background: "#09090b", foreground: "#e4e4e7" },
    });
    const fit = new FitAddonModule.FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    terminal.writeln(
      terminalLifecycle === 0 ? "Connecting to Space runtime..." : "Starting a new terminal...",
    );
    setCanRestart(false);

    let disposed = false;
    const abortController = new AbortController();
    let unsubscribe: (() => void) | undefined;
    let sessionId: string | undefined;

    void runtimeClient
      .getOrCreateTerminal(panelId, abortController.signal)
      .then((createdSessionId) => {
        if (disposed) return;
        sessionId = createdSessionId;
        unsubscribe = runtimeClient.subscribeTerminal(createdSessionId, (event) => {
          if (event.type === "terminal.snapshot") {
            terminal.reset();
            terminal.write(event.data);
            if (event.status === "exited") {
              terminal.writeln(`\r\n${formatTerminalExit(event.exit)}`);
              runtimeClient.releaseTerminal(panelId, createdSessionId);
              setCanRestart(true);
            } else {
              terminal.focus();
            }
          }
          if (event.type === "terminal.data") terminal.write(event.data);
          if (event.type === "terminal.exit") {
            terminal.writeln(`\r\n${formatTerminalExit(event.exit)}`);
            runtimeClient.releaseTerminal(panelId, createdSessionId);
            setCanRestart(true);
          }
          if (event.type === "runtime.error") terminal.writeln(`\r\n${event.message}`);
        });
      })
      .catch((error: unknown) => {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
          terminal.writeln(`\r\nRuntime error: ${String(error)}`);
        }
      });

    const input = terminal.onData((data) => {
      if (sessionId) runtimeClient.sendTerminalInput(sessionId, data);
    });
    let resizeFrame: number | undefined;
    const resize = new ResizeObserver(() => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        fit.fit();
        if (sessionId && terminal.cols > 0 && terminal.rows > 0) {
          runtimeClient.resizeTerminal(sessionId, terminal.cols, terminal.rows);
        }
      });
    });
    resize.observe(container);

    return () => {
      disposed = true;
      abortController.abort();
      input.dispose();
      resize.disconnect();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      unsubscribe?.();
      terminal.dispose();
    };
  }, [panelId, terminalLifecycle]);

  return (
    <div className="relative h-full w-full bg-[#09090b]">
      <div ref={containerRef} className="h-full w-full overflow-hidden px-3 pt-2 pb-3" />
      {canRestart ? (
        <button
          type="button"
          className="absolute top-3 right-4 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
          onClick={() => setTerminalLifecycle((value) => value + 1)}
        >
          Restart terminal
        </button>
      ) : null}
    </div>
  );
};
