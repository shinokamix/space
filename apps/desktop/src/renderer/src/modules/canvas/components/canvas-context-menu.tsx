import { TerminalSquare } from "lucide-react";
import type { RefObject } from "react";

import type { CanvasContextMenuState } from "@/modules/canvas/types/canvas";

interface CanvasContextMenuProps {
  buttonRef: RefObject<HTMLButtonElement | null>;
  menu: CanvasContextMenuState;
  onCreateTerminal: () => void;
}

export const CanvasContextMenu = ({
  buttonRef,
  menu,
  onCreateTerminal,
}: CanvasContextMenuProps) => (
  <div
    className="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl shadow-black/50"
    role="menu"
    style={{
      left: Math.min(menu.screenPosition.x, window.innerWidth - 188),
      top: Math.min(menu.screenPosition.y, window.innerHeight - 52),
    }}
  >
    <button
      ref={buttonRef}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-zinc-200 outline-none hover:bg-zinc-800 focus:bg-zinc-800"
      onClick={onCreateTerminal}
      role="menuitem"
      type="button"
    >
      <TerminalSquare aria-hidden="true" className="size-4 text-zinc-400" />
      Terminal
    </button>
  </div>
);
