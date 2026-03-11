import { useCallback, useMemo, useState, type DragEvent } from "react";
import {
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnInit,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { Agent } from "@/lib/agents";
import type { ConnectorTool, WorkflowStep } from "@/lib/services";
import type {
  AgentNodeData,
  HookNodeData,
  StepNodeData,
  TriggerNodeData,
} from "@/components/compose/nodes";

export type ComposeNode = Node<StepNodeData | AgentNodeData | TriggerNodeData | HookNodeData>;

interface UseWorkflowOptions {
  onWarpRequired?: (agent: Agent) => void;
}

type WorkflowSummary = {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
};

function createConnectorNode(
  connectorId: string,
  tool: ConnectorTool,
  position: { x: number; y: number },
): ComposeNode {
  const id = `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const step: WorkflowStep = {
    id,
    name: tool.name || connectorId,
    type: "connectorTool",
    connectorId,
    toolName: tool.name || "execute",
    inputTemplate: {},
    saveAs: `step_${id}`,
  };

  return {
    id,
    type: "stepNode",
    position,
    data: {
      step,
      connector: { name: connectorId, registryId: connectorId },
      tool,
      status: "pending",
    },
  };
}

function createAgentNode(
  agent: Agent,
  position: { x: number; y: number },
): ComposeNode {
  const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const step = {
    id,
    name: agent.name,
    type: "connectorTool",
    connectorId: agent.registry,
    toolName: "chat",
    inputTemplate: {
      agentAddress: agent.address,
    },
    saveAs: `agent_${id}`,
  } satisfies WorkflowStep;

  return {
    id,
    type: "agentNode",
    position,
    data: {
      agent,
      step,
      status: "pending",
    },
  };
}

export function useWorkflow(options: UseWorkflowOptions = {}) {
  const [workflowId] = useState(() => `workflow-${Date.now()}`);
  const [workflowName, setWorkflowName] = useState("Untitled Workflow");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [inputJson, setInputJson] = useState("{}");
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<ComposeNode, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<ComposeNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const getDropPosition = useCallback((x?: number, y?: number) => {
    if (typeof x === "number" && typeof y === "number" && reactFlowInstance) {
      return reactFlowInstance.screenToFlowPosition({ x, y });
    }

    return {
      x: 180 + nodes.length * 32,
      y: 120 + nodes.length * 96,
    };
  }, [nodes.length, reactFlowInstance]);

  const handleAddStep = useCallback((connectorId: string, tool: ConnectorTool) => {
    const position = getDropPosition();
    setNodes((current) => [...current, createConnectorNode(connectorId, tool, position)]);
  }, [getDropPosition, setNodes]);

  const handleAddAgentStep = useCallback((agent: Agent) => {
    if (agent.warpStatus === "must-warp") {
      options.onWarpRequired?.(agent);
      return;
    }

    const position = getDropPosition();
    setNodes((current) => [...current, createAgentNode(agent, position)]);
  }, [getDropPosition, options, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({
      ...connection,
      type: "smoothstep",
      animated: true,
    }, current));
  }, [setEdges]);

  const onInit = useCallback<OnInit<ComposeNode, Edge>>((instance) => {
    setReactFlowInstance(instance);
  }, []);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    const pluginPayload = event.dataTransfer.getData("application/compose-plugin");
    if (pluginPayload) {
      const plugin = JSON.parse(pluginPayload) as { registryId: string; name: string; description?: string };
      setNodes((current) => [
        ...current,
        createConnectorNode(
          plugin.registryId,
          {
            name: "execute",
            description: plugin.description || `Execute ${plugin.name}`,
            inputSchema: { type: "object", properties: {} },
          },
          getDropPosition(event.clientX, event.clientY),
        ),
      ]);
      return;
    }

    const agentPayload = event.dataTransfer.getData("application/compose-agent");
    if (agentPayload) {
      const agent = JSON.parse(agentPayload) as Agent;
      if (agent.warpStatus === "must-warp") {
        options.onWarpRequired?.(agent);
        return;
      }

      setNodes((current) => [
        ...current,
        createAgentNode(agent, getDropPosition(event.clientX, event.clientY)),
      ]);
    }
  }, [getDropPosition, options, setNodes]);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const currentWorkflow = useMemo<WorkflowSummary>(() => ({
    id: workflowId,
    name: workflowName,
    description: workflowDescription,
    steps: nodes
      .filter((node) => node.type === "stepNode" || node.type === "agentNode")
      .map((node) => (node.data as StepNodeData | AgentNodeData).step),
  }), [nodes, workflowDescription, workflowId, workflowName]);

  const workflowAgentIds = useMemo(() => (
    nodes
      .filter((node): node is Node<AgentNodeData> => node.type === "agentNode")
      .map((node) => node.data.agent.onchainAgentId)
      .filter((agentId): agentId is number => typeof agentId === "number")
  ), [nodes]);

  const agentPrices = useMemo(() => {
    const prices = new Map<number, bigint>();

    for (const node of nodes) {
      if (node.type !== "agentNode") {
        continue;
      }

      const { agent } = node.data as AgentNodeData;
      if (typeof agent.onchainAgentId !== "number" || !agent.pricePerRequest) {
        continue;
      }

      const numeric = Number(agent.pricePerRequest);
      if (!Number.isFinite(numeric) || numeric < 0) {
        continue;
      }

      prices.set(agent.onchainAgentId, BigInt(Math.round(numeric * 1_000_000)));
    }

    return prices;
  }, [nodes]);

  return {
    nodes,
    setNodes,
    onNodesChange,
    edges,
    setEdges,
    onEdgesChange,
    onConnect,
    onInit,
    onDrop,
    onDragOver,
    workflowName,
    setWorkflowName,
    workflowDescription,
    setWorkflowDescription,
    inputJson,
    setInputJson,
    currentWorkflow,
    workflowAgentIds,
    agentPrices,
    handleAddStep,
    handleAddAgentStep,
  };
}
