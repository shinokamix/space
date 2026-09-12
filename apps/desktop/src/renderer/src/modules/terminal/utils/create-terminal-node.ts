import type { XYPosition } from "@xyflow/react";

import type { TerminalNode } from "@/modules/terminal/types/terminal";

export const createTerminalNode = (position: XYPosition): TerminalNode => ({
  id: crypto.randomUUID(),
  type: "terminal",
  position,
  data: { title: "Terminal" },
  style: { height: 380, width: 640 },
});
