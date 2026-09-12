import type { CanvasNode, CreateCanvasNodeInput } from "@/modules/canvas/types/canvas";
import { createTerminalNode } from "@/modules/terminal";

export const createCanvasNode = ({ position, type }: CreateCanvasNodeInput): CanvasNode => {
  switch (type) {
    case "terminal":
      return createTerminalNode(position);
  }
};
