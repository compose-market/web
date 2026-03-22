/**
 * React hooks for backend service integration
 */
import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  getConnectors,
  getConnectorTools,
  callConnectorTool,
  runWorkflow,
  validateWorkflow,
  downloadWorkflow,
  checkAllServicesHealth,
  type WorkflowDefinition,
  type WorkflowRunResult,
  type ExportOptions,
} from "@/lib/services";

// =============================================================================
// Connectors Hook
// =============================================================================

/**
 * Hook to fetch and manage available connectors
 */
export function useConnectors() {
  return useQuery({
    queryKey: ["connectors"],
    queryFn: getConnectors,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}

/**
 * Hook to fetch tools for a specific connector
 */
export function useConnectorTools(connectorId: string | null) {
  return useQuery({
    queryKey: ["connector-tools", connectorId],
    queryFn: () => (connectorId ? getConnectorTools(connectorId) : Promise.resolve([])),
    enabled: !!connectorId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to call a connector tool directly
 */
export function useConnectorCall() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const call = useCallback(
    async (connectorId: string, toolName: string, args: Record<string, unknown>) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await callConnectorTool(connectorId, toolName, args);
        setResult(res);
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { call, isLoading, error, result };
}

// =============================================================================
// Workflow Execution Hook
// =============================================================================

/**
 * Hook to execute workflows in the sandbox
 */
export function useWorkflowExecution() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<WorkflowRunResult["logs"]>([]);
  const [result, setResult] = useState<WorkflowRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (workflow: WorkflowDefinition, input: Record<string, unknown> = {}) => {
      setIsRunning(true);
      setError(null);
      setLogs([]);
      setResult(null);

      try {
        const res = await runWorkflow(workflow, input);
        setResult(res);
        setLogs(res.logs);
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        throw err;
      } finally {
        setIsRunning(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setIsRunning(false);
    setLogs([]);
    setResult(null);
    setError(null);
  }, []);

  return {
    execute,
    reset,
    isRunning,
    logs,
    result,
    error,
    success: result?.success ?? null,
    context: result?.context ?? null,
  };
}

/**
 * Hook to validate workflows without executing
 */
export function useWorkflowValidation() {
  return useMutation({
    mutationFn: validateWorkflow,
  });
}

// =============================================================================
// Export Hook
// =============================================================================

/**
 * Hook to export workflows as downloadable projects
 */
export function useWorkflowExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportAsZip = useCallback(async (options: ExportOptions) => {
    setIsExporting(true);
    setError(null);
    try {
      await downloadWorkflow(options);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      throw err;
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { exportAsZip, isExporting, error };
}

// =============================================================================
// Service Health Hook
// =============================================================================

/**
 * Hook to check health of all backend services
 */
export function useServicesHealth() {
  return useQuery({
    queryKey: ["services-health"],
    queryFn: checkAllServicesHealth,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

// =============================================================================
// Workflow Builder Hook
// =============================================================================

export interface WorkflowBuilderState {
  workflow: WorkflowDefinition;
  selectedStep: string | null;
}

/**
 * Hook for building workflows step by step
 */
export function useWorkflowBuilder(initialWorkflow?: Partial<WorkflowDefinition>) {
  const [workflow, setWorkflow] = useState<WorkflowDefinition>({
    id: initialWorkflow?.id || `wf-${Date.now()}`,
    name: initialWorkflow?.name || "New Workflow",
    description: initialWorkflow?.description || "",
    steps: initialWorkflow?.steps || [],
  });

  const addStep = useCallback(
    (step: Omit<WorkflowDefinition["steps"][0], "id">) => {
      setWorkflow((w) => ({
        ...w,
        steps: [
          ...w.steps,
          { ...step, id: `step-${w.steps.length + 1}` },
        ],
      }));
    },
    []
  );

  const updateStep = useCallback(
    (stepId: string, updates: Partial<WorkflowDefinition["steps"][0]>) => {
      setWorkflow((w) => ({
        ...w,
        steps: w.steps.map((s) =>
          s.id === stepId ? { ...s, ...updates } : s
        ),
      }));
    },
    []
  );

  const removeStep = useCallback((stepId: string) => {
    setWorkflow((w) => ({
      ...w,
      steps: w.steps.filter((s) => s.id !== stepId),
    }));
  }, []);

  const reorderSteps = useCallback((fromIndex: number, toIndex: number) => {
    setWorkflow((w) => {
      const steps = [...w.steps];
      const [removed] = steps.splice(fromIndex, 1);
      steps.splice(toIndex, 0, removed);
      return { ...w, steps };
    });
  }, []);

  const setMetadata = useCallback(
    (metadata: Pick<WorkflowDefinition, "name" | "description">) => {
      setWorkflow((w) => ({ ...w, ...metadata }));
    },
    []
  );

  const reset = useCallback(() => {
    setWorkflow({
      id: `wf-${Date.now()}`,
      name: "New Workflow",
      description: "",
      steps: [],
    });
  }, []);

  return {
    workflow,
    addStep,
    updateStep,
    removeStep,
    reorderSteps,
    setMetadata,
    reset,
    stepCount: workflow.steps.length,
    isValid: workflow.steps.length > 0 && workflow.name.length > 0,
  };
}
