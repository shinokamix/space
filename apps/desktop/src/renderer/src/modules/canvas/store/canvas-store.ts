import { create } from "zustand";

import type { CanvasNode, CreateCanvasNodeInput } from "@/modules/canvas/types/canvas";
import { createCanvasNode } from "@/modules/canvas/utils/create-canvas-node";

interface CanvasState {
  addNode: (input: CreateCanvasNodeInput) => void;
  nodes: CanvasNode[];
  setNodes: (nodes: CanvasNode[]) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  addNode: (input) =>
    set(({ nodes }) => ({
      nodes: [...nodes, createCanvasNode(input)],
    })),
  nodes: [],
  setNodes: (nodes) => set({ nodes }),
}));
