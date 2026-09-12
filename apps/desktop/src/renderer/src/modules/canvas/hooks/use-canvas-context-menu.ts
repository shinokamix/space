import { useEffect, useRef, useState } from "react";

import type { CanvasContextMenuState } from "@/modules/canvas/types/canvas";

export const useCanvasContextMenu = () => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<CanvasContextMenuState | null>(null);

  useEffect(() => {
    if (!menu) return;
    buttonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menu]);

  return {
    buttonRef,
    closeMenu: () => setMenu(null),
    menu,
    openMenu: setMenu,
  };
};
