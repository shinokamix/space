import type { XYPosition } from "@xyflow/react";

import type { TerminalNode } from "@/modules/terminal";

export type CanvasNode = TerminalNode;
export type CanvasNodeType = "terminal";

export interface CanvasContextMenuState {
  canvasPosition: XYPosition;
  screenPosition: XYPosition;
}

export interface CreateCanvasNodeInput {
  position: XYPosition;
  type: CanvasNodeType;
}
