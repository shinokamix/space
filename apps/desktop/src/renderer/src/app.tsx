import { useEffect } from "react";
import { CircleDot, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/terminal-panel";
import { WorkspaceCanvas } from "@/components/workspace-canvas";
import { useWorkspaceStore } from "@/store/workspace";

const runtimeUrl = import.meta.env.VITE_RUNTIME_URL ?? "http://127.0.0.1:4310";

export const App = () => {
  const { runtimeStatus, setRuntimeStatus } = useWorkspaceStore();

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${runtimeUrl}/health`, { signal: controller.signal })
      .then((response) => setRuntimeStatus(response.ok ? "online" : "offline"))
      .catch(() => setRuntimeStatus("offline"));
    return () => controller.abort();
  }, [setRuntimeStatus]);

  return (
    <main className="grid h-screen grid-rows-[52px_minmax(0,1fr)_280px] bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 [-webkit-app-region:drag]">
        <div className="flex items-center gap-3 pl-16">
          <span className="text-sm font-semibold tracking-wide">SPACE</span>
          <span className="h-4 w-px bg-zinc-700" />
          <span className="text-xs text-zinc-500">untitled workspace</span>
        </div>
        <div className="flex items-center gap-3 [-webkit-app-region:no-drag]">
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            <CircleDot
              className={
                runtimeStatus === "online" ? "size-3 text-emerald-400" : "size-3 text-amber-400"
              }
            />
            runtime {runtimeStatus}
          </span>
          <Button>
            <Play className="size-3.5" /> Run
          </Button>
        </div>
      </header>
      <section aria-label="Workspace canvas" className="min-h-0">
        <WorkspaceCanvas />
      </section>
      <section aria-label="Terminal" className="min-h-0 border-t border-zinc-800">
        <TerminalPanel />
      </section>
    </main>
  );
};
