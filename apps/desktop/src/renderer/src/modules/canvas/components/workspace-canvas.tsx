import { applyNodeChanges, Background, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import { useRef } from "react";

import "@xyflow/react/dist/style.css";
import { CanvasContextMenu } from "@/modules/canvas/components/canvas-context-menu";
import { useCanvasContextMenu } from "@/modules/canvas/hooks/use-canvas-context-menu";
import { useCanvasStore } from "@/modules/canvas/store/canvas-store";
import type { CanvasNode } from "@/modules/canvas/types/canvas";
import { TerminalNodeComponent } from "@/modules/terminal";

const nodeTypes = { terminal: TerminalNodeComponent };

export const WorkspaceCanvas = () => {
  const addNode = useCanvasStore((state) => state.addNode);
  const nodes = useCanvasStore((state) => state.nodes);
  const setNodes = useCanvasStore((state) => state.setNodes);
  const flow = useRef<ReactFlowInstance<CanvasNode>>(null);
  const { buttonRef, closeMenu, menu, openMenu } = useCanvasContextMenu();

  const createTerminal = () => {
    if (!menu) return;
    addNode({ position: menu.canvasPosition, type: "terminal" });
    closeMenu();
  };

  return (
    <section aria-label="Workspace canvas" className="relative h-full w-full">
      <ReactFlow<CanvasNode>
        colorMode="dark"
        nodeTypes={nodeTypes}
        nodes={nodes}
        onInit={(instance) => {
          flow.current = instance;
        }}
        onMoveStart={closeMenu}
        onNodeClick={closeMenu}
        onNodesChange={(changes) => setNodes(applyNodeChanges(changes, nodes))}
        onPaneClick={closeMenu}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const instance = flow.current;
          if (!instance) return;
          openMenu({
            canvasPosition: instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            screenPosition: { x: event.clientX, y: event.clientY },
          });
        }}
        panOnScroll
        selectionOnDrag={false}
      >
        <Background color="#27272a" gap={24} size={1} />
      </ReactFlow>

      {menu ? (
        <CanvasContextMenu buttonRef={buttonRef} menu={menu} onCreateTerminal={createTerminal} />
      ) : null}
    </section>
  );
};
