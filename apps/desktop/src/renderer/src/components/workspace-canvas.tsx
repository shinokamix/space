import { applyEdgeChanges, applyNodeChanges, Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useWorkspaceStore } from "@/store/workspace";

export const WorkspaceCanvas = () => {
  const { edges, nodes, setEdges, setNodes } = useWorkspaceStore();

  return (
    <ReactFlow
      colorMode="dark"
      edges={edges}
      fitView
      nodes={nodes}
      onEdgesChange={(changes) => setEdges(applyEdgeChanges(changes, edges))}
      onNodesChange={(changes) => setNodes(applyNodeChanges(changes, nodes))}
    >
      <Background color="#3f3f46" gap={22} />
      <Controls />
    </ReactFlow>
  );
};
