import type { Edge, Node } from "@xyflow/react";
import { create } from "zustand";

import type { RuntimeStatus } from "@/lib/runtime-client";

interface WorkspaceState {
  edges: Edge[];
  nodes: Node[];
  runtimeStatus: RuntimeStatus;
  setEdges: (edges: Edge[]) => void;
  setNodes: (nodes: Node[]) => void;
  setRuntimeStatus: (status: RuntimeStatus) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  nodes: [
    { id: "runtime", position: { x: 80, y: 100 }, data: { label: "Runtime" }, type: "input" },
    { id: "terminal", position: { x: 360, y: 100 }, data: { label: "Terminal" }, type: "output" },
  ],
  edges: [{ id: "runtime-terminal", source: "runtime", target: "terminal", animated: true }],
  runtimeStatus: "connecting",
  setEdges: (edges) => set({ edges }),
  setNodes: (nodes) => set({ nodes }),
  setRuntimeStatus: (runtimeStatus) => set({ runtimeStatus }),
}));
