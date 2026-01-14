/**
 * useWorkflow Hook
 * 
 * Manages workflow state for the compose canvas including:
 * - Nodes and edges state (ReactFlow)
 * - Workflow metadata (name, description)
 * - Agent IDs and prices computation
 * - Warp status checking for external agents
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import {
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    Edge,
    Node,
    MarkerType,
} from "@xyflow/react";
import { useToast } from "@/hooks/use-toast";
import { useOnchainAgents } from "@/hooks/use-onchain";
import { useWorkflowBuilder, useWorkflowExecution } from "@/hooks/use-services";
import { computeExternalAgentHash, getWarpContract } from "@/lib/contracts";
import { readContract } from "thirdweb";
import type { Agent, AgentRegistryId, AGENT_REGISTRIES } from "@/lib/agents";
import type { WorkflowStep, ConnectorTool } from "@/lib/services";
import type { StepNodeData, AgentNodeData } from "@/components/compose/nodes";

let nodeId = 0;
const getNodeId = () => `step_${nodeId++}`;

export interface UseWorkflowOptions {
    onWarpRequired?: (agent: Agent) => void;
}

export function useWorkflow(options: UseWorkflowOptions = {}) {
    const { onWarpRequired } = options;
    const { toast } = useToast();
    const [, setLocation] = useLocation();

    // ReactFlow state
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const reactFlowInstanceRef = useRef<any>(null);

    // Workflow metadata
    const { workflow } = useWorkflowBuilder();
    const [workflowName, setWorkflowName] = useState("");
    const [workflowDescription, setWorkflowDescription] = useState("");
    const [inputJson, setInputJson] = useState("{}");

    // Fetch onchain agents for prices
    const { data: onchainAgents } = useOnchainAgents();

    // Execution state
    const { isRunning } = useWorkflowExecution();

    // Precompute onchain agent prices map for O(1) lookups
    const onchainPriceById = useMemo(() => {
        const m = new Map<number, bigint>();
        for (const a of onchainAgents ?? []) {
            m.set(a.id, BigInt(Math.floor(parseFloat(a.licensePrice) * 1_000_000)));
        }
        return m;
    }, [onchainAgents]);

    // Memoized onInit callback for ReactFlow
    const onInit = useCallback((instance: any) => {
        reactFlowInstanceRef.current = instance;
    }, []);

    // Extract agent IDs and prices from workflow nodes
    const { workflowAgentIds, agentPrices } = useMemo(() => {
        const ids: number[] = [];
        const prices = new Map<number, bigint>();

        nodes.forEach((node) => {
            if (node.type === "agentNode") {
                const nodeData = node.data as AgentNodeData;
                const agent = nodeData.agent;

                // For manowar native agents, use the preserved onchainAgentId
                // For warped external agents, use warpedAgentId
                let agentId: number | null = null;

                if (agent.registry === "manowar") {
                    // Manowar native agent - use the preserved numeric ID
                    agentId = agent.onchainAgentId || null;

                    // Fallback: parse from prefixed id ("manowar-123")
                    if (!agentId && agent.id.startsWith("manowar-")) {
                        agentId = parseInt(agent.id.replace("manowar-", "")) || null;
                    }
                } else if (agent.warpedAgentId) {
                    // External agent that has been warped - use warped ID
                    agentId = agent.warpedAgentId;
                }

                if (agentId && agentId > 0) {
                    ids.push(agentId);

                    // Get price from precomputed map for O(1) lookup
                    if (agent.pricePerRequest) {
                        const priceWei = BigInt(Math.floor(parseFloat(agent.pricePerRequest) * 1_000_000));
                        prices.set(agentId, priceWei);
                    } else {
                        const cachedPrice = onchainPriceById.get(agentId);
                        if (cachedPrice) {
                            prices.set(agentId, cachedPrice);
                        }
                    }
                }
            }
        });

        return { workflowAgentIds: ids, agentPrices: prices };
    }, [nodes, onchainPriceById]);

    // Build workflow from nodes
    const currentWorkflow = useMemo(() => {
        const steps: WorkflowStep[] = nodes.map((node) => ({
            ...(node.data as StepNodeData).step,
            id: node.id,
        }));

        return {
            id: workflow.id,
            name: workflowName || "Untitled Workflow",
            description: workflowDescription,
            steps,
        };
    }, [nodes, workflow.id, workflowName, workflowDescription]);

    // Edge connection handler
    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge({
            ...params,
            animated: true,
            style: { stroke: 'hsl(188 95% 43%)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(188 95% 43%)' }
        }, eds)),
        [setEdges],
    );

    // Drop handler for drag-drop from pickers
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const rf = reactFlowInstanceRef.current;
        if (!rf) return;

        const pluginData = e.dataTransfer.getData("application/compose-plugin");
        const agentData = e.dataTransfer.getData("application/compose-agent");
        const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });

        if (pluginData) {
            const server = JSON.parse(pluginData);
            const id = getNodeId();
            const step: WorkflowStep = {
                id,
                name: server.name,
                type: "connectorTool",
                connectorId: server.registryId,
                toolName: "execute",
                inputTemplate: {},
                saveAs: `steps.${server.slug || server.name.toLowerCase().replace(/\s+/g, "_")}`,
            };
            const newNode: Node = {
                id,
                type: "stepNode",
                position,
                data: { step, status: "pending" } as StepNodeData,
            };
            setNodes((nds) => [...nds, newNode]);
            toast({ title: "Plugin Added", description: `Added "${server.name}" to canvas` });
        } else if (agentData) {
            const agent = JSON.parse(agentData);
            const id = getNodeId();
            const step: WorkflowStep = {
                id,
                name: agent.name,
                type: "connectorTool",
                connectorId: agent.registry,
                toolName: agent.protocols?.[0]?.name || "default",
                inputTemplate: { agentAddress: agent.address },
                saveAs: `steps.${agent.name.toLowerCase().replace(/\s+/g, "_")}`,
            };
            const newNode: Node = {
                id,
                type: "agentNode",
                position,
                data: { agent, step, status: "pending" } as AgentNodeData,
            };
            setNodes((nds) => [...nds, newNode]);
            toast({ title: "Agent Added", description: `Added "${agent.name}" to canvas` });
        }
    }, [setNodes, toast]);

    // Drag over handler
    const onDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }, []);

    // Check if external agent has been warped
    const checkExternalWarpStatus = useCallback(async (registry: string, address: string): Promise<boolean> => {
        try {
            const externalHash = computeExternalAgentHash(registry, address);
            const warpContract = getWarpContract();
            const warpedId = await readContract({
                contract: warpContract,
                method: "function getWarpedAgentId(bytes32 externalHash) view returns (uint256)",
                params: [externalHash],
            });
            return Number(warpedId) > 0;
        } catch (error) {
            console.error("Failed to check warp status:", error);
            return false;
        }
    }, []);

    // Add step from connector picker
    const handleAddStep = useCallback((connectorId: string, tool: ConnectorTool) => {
        const id = getNodeId();
        const step: WorkflowStep = {
            id,
            name: tool.name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
            type: "connectorTool",
            connectorId,
            toolName: tool.name,
            inputTemplate: {},
            saveAs: `steps.${tool.name}`,
        };

        // Horizontal flow: position nodes left-to-right
        const newNode: Node = {
            id,
            type: "stepNode",
            position: { x: nodes.length * 320 + 100, y: 150 },
            data: { step, status: "pending" } as StepNodeData,
        };

        setNodes((nds) => [...nds, newNode]);

        toast({
            title: "Step Added",
            description: `Added "${step.name}" to workflow`,
        });
    }, [nodes.length, setNodes, toast]);

    // Add step from agent registry (with warp check)
    const handleAddAgentStep = useCallback(async (agent: Agent) => {
        const isManowar = agent.registry === "manowar";

        // External agents need to be warped first
        if (!isManowar) {
            const isWarped = await checkExternalWarpStatus(agent.registry, agent.address);
            if (!isWarped) {
                // Call the warp required callback instead of adding
                if (onWarpRequired) {
                    onWarpRequired(agent);
                }
                return;
            }
        }

        // Agent is native (manowar) or already warped - add to workflow
        const id = getNodeId();
        const protocolName = agent.protocols?.[0]?.name || "default";
        const step: WorkflowStep = {
            id,
            name: agent.name,
            type: "connectorTool",
            connectorId: agent.registry,
            toolName: protocolName,
            inputTemplate: { agentAddress: agent.address },
            saveAs: `steps.${agent.name.toLowerCase().replace(/\s+/g, "_")}`,
        };

        // Use new agentNode type for agents
        const newNode: Node = {
            id,
            type: "agentNode",
            position: { x: nodes.length * 320 + 100, y: 150 },
            data: { agent, step, status: "pending" } as AgentNodeData,
        };

        setNodes((nds) => [...nds, newNode]);

        toast({
            title: "Agent Added",
            description: `Added "${agent.name}" to workflow`,
        });
    }, [nodes.length, setNodes, toast, checkExternalWarpStatus, onWarpRequired]);

    // Keyboard shortcuts for compose canvas
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Skip if user is typing in an input
            if ((e.target as HTMLElement).tagName === "INPUT" ||
                (e.target as HTMLElement).tagName === "TEXTAREA") return;

            // Delete/Backspace - remove selected nodes AND edges
            if (e.key === "Delete" || e.key === "Backspace") {
                const selectedNodes = nodes.filter(n => n.selected);
                const selectedEdges = edges.filter(e => e.selected);

                if (selectedNodes.length > 0 || selectedEdges.length > 0) {
                    e.preventDefault();

                    // Remove selected nodes and any edges connected to them
                    if (selectedNodes.length > 0) {
                        setNodes(nds => nds.filter(n => !n.selected));
                        setEdges(eds => eds.filter(ed =>
                            !selectedNodes.some(n => n.id === ed.source || n.id === ed.target)
                        ));
                    }

                    // Remove selected edges
                    if (selectedEdges.length > 0) {
                        setEdges(eds => eds.filter(ed => !ed.selected));
                    }

                    const deletedCount = selectedNodes.length + selectedEdges.length;
                    const deletedItems = [
                        selectedNodes.length > 0 ? `${selectedNodes.length} step${selectedNodes.length > 1 ? "s" : ""}` : null,
                        selectedEdges.length > 0 ? `${selectedEdges.length} connection${selectedEdges.length > 1 ? "s" : ""}` : null,
                    ].filter(Boolean).join(" and ");

                    toast({
                        title: "Deleted",
                        description: `Removed ${deletedItems}`
                    });
                }
            }

            // Cmd/Ctrl+K - focus on search (find the input in the connector picker)
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                const searchInput = document.querySelector('[placeholder*="Search"]') as HTMLInputElement;
                if (searchInput) searchInput.focus();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [nodes, edges, setNodes, setEdges, toast]);

    // Check for agent selection from Agents page on mount
    useEffect(() => {
        const stored = sessionStorage.getItem("selectedAgent");
        if (stored) {
            try {
                const agentData = JSON.parse(stored);
                // Create a minimal agent object for the handler
                handleAddAgentStep({
                    id: agentData.id || agentData.address,
                    address: agentData.address,
                    name: agentData.name,
                    description: agentData.description || "",
                    registry: agentData.registry || "agentverse",
                    protocols: agentData.protocols || [],
                    avatarUrl: agentData.avatarUrl,
                    totalInteractions: 0,
                    recentInteractions: 0,
                    rating: 0,
                    status: "active",
                    type: "hosted",
                    featured: false,
                    verified: false,
                    category: agentData.category || "",
                    tags: agentData.tags || [],
                    owner: "",
                    createdAt: "",
                    updatedAt: "",
                });
                sessionStorage.removeItem("selectedAgent");
            } catch {
                // Ignore parse errors
            }
        }
    }, [handleAddAgentStep]);

    return {
        // ReactFlow state
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
        reactFlowInstanceRef,

        // Workflow metadata
        workflowName,
        setWorkflowName,
        workflowDescription,
        setWorkflowDescription,
        inputJson,
        setInputJson,

        // Computed values
        currentWorkflow,
        workflowAgentIds,
        agentPrices,
        isRunning,

        // Handlers
        handleAddStep,
        handleAddAgentStep,
        checkExternalWarpStatus,
    };
}
