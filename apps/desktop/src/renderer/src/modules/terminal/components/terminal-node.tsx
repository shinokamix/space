import type { NodeProps } from "@xyflow/react";
import { cn } from "cn";
import { TerminalSquare } from "lucide-react";

import { Terminal } from "@/modules/terminal/components/terminal";
import type { TerminalNode as TerminalNodeType } from "@/modules/terminal/types/terminal";

export const TerminalNode = ({ data, id, selected }: NodeProps<TerminalNodeType>) => (
  <article
    aria-label={data.title}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-xl border bg-zinc-950 shadow-2xl shadow-black/40",
      selected ? "border-zinc-500" : "border-zinc-800",
    )}
  >
    <header className="flex h-10 shrink-0 cursor-grab items-center gap-2 border-b border-zinc-800 px-3 active:cursor-grabbing">
      <TerminalSquare aria-hidden="true" className="size-4 text-zinc-500" />
      <span className="text-xs font-medium text-zinc-300">{data.title}</span>
    </header>
    <div className="nodrag nowheel min-h-0 flex-1">
      <Terminal panelId={id} />
    </div>
  </article>
);
