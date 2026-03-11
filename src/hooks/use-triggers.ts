/**
 * useTriggers - React Query hooks for trigger/hook management
 * 
 * Follows the same pattern as use-model.ts for consistency.
 * Provides query hooks with caching and mutation hooks for CRUD.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useCallback } from "react";
import {
    fetchTriggers,
    fetchHooks,
    createTrigger,
    updateTrigger,
    deleteTrigger,
    toggleTrigger,
    testTrigger,
    parseNLToCron,
    createHook,
    updateHook,
    deleteHook,
    type TriggerDefinition,
    type HookDefinition,
    type NLParseResult,
} from "@/lib/triggers";

// =============================================================================
// Types
// =============================================================================

export interface UseTriggersOptions {
    workflowWallet: string | null;
    enabled?: boolean;
    filterEnabled?: boolean; // only show enabled triggers
    filterType?: TriggerDefinition["type"];
}

export interface UseTriggersReturn {
    triggers: TriggerDefinition[];
    filteredTriggers: TriggerDefinition[];
    isLoading: boolean;
    isRefetching: boolean;
    error: Error | null;
    forceRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

export interface UseHooksOptions {
    workflowWallet: string | null;
    enabled?: boolean;
    filterEnabled?: boolean;
    filterType?: HookDefinition["type"];
}

export interface UseHooksReturn {
    hooks: HookDefinition[];
    filteredHooks: HookDefinition[];
    isLoading: boolean;
    isRefetching: boolean;
    error: Error | null;
    forceRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

// =============================================================================
// Constants
// =============================================================================

const STALE_TIME = 5 * 60 * 1000; // 5 minutes (triggers update more frequently than models)
const TRIGGERS_KEY = "workflow-triggers";
const HOOKS_KEY = "workflow-hooks";

// =============================================================================
// Trigger Hooks
// =============================================================================

export function useTriggers(options: UseTriggersOptions): UseTriggersReturn {
    const { workflowWallet, enabled = true, filterEnabled, filterType } = options;
    const queryClient = useQueryClient();

    const queryKey = [TRIGGERS_KEY, workflowWallet];

    const {
        data: triggers = [],
        isLoading,
        isFetching,
        error,
        dataUpdatedAt,
    } = useQuery<TriggerDefinition[], Error>({
        queryKey,
        queryFn: () => fetchTriggers(workflowWallet!),
        staleTime: STALE_TIME,
        gcTime: STALE_TIME * 2,
        enabled: enabled && workflowWallet !== null,
    });

    const filteredTriggers = useMemo(() => {
        let result = triggers;

        if (filterEnabled !== undefined) {
            result = result.filter((t) => t.enabled === filterEnabled);
        }

        if (filterType) {
            result = result.filter((t) => t.type === filterType);
        }

        // Temporal-backed triggers may omit nextRun; fall back to newest-first.
        result = [...result].sort((a, b) => {
            const aNext = a.nextRun;
            const bNext = b.nextRun;
            if (typeof aNext === "number" && typeof bNext === "number") {
                return aNext - bNext;
            }
            if (typeof aNext === "number") return -1;
            if (typeof bNext === "number") return 1;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        return result;
    }, [triggers, filterEnabled, filterType]);

    const forceRefresh = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey });
    }, [queryClient, queryKey]);

    const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

    return {
        triggers,
        filteredTriggers,
        isLoading,
        isRefetching: isFetching && !isLoading,
        error: error || null,
        forceRefresh,
        lastUpdated,
    };
}

export function useTrigger(
    workflowWallet: string | null,
    triggerId: string | null
): TriggerDefinition | null {
    const { triggers } = useTriggers({ workflowWallet, enabled: !!workflowWallet && !!triggerId });
    return useMemo(() => {
        if (!triggerId) return null;
        return triggers.find((t) => t.id === triggerId) || null;
    }, [triggers, triggerId]);
}

// =============================================================================
// Trigger Mutations
// =============================================================================

export function useCreateTrigger(workflowWallet: string) {
    const queryClient = useQueryClient();
    const queryKey = [TRIGGERS_KEY, workflowWallet];

    return useMutation({
        mutationFn: (trigger: Omit<TriggerDefinition, "id" | "createdAt" | "updatedAt" | "memoryId">) =>
            createTrigger(workflowWallet, trigger),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });
}

export function useUpdateTrigger(workflowWallet: string) {
    const queryClient = useQueryClient();
    const queryKey = [TRIGGERS_KEY, workflowWallet];

    return useMutation({
        mutationFn: ({ triggerId, updates }: { triggerId: string; updates: Partial<TriggerDefinition> }) =>
            updateTrigger(workflowWallet, triggerId, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });
}

export function useDeleteTrigger(workflowWallet: string) {
    const queryClient = useQueryClient();
    const queryKey = [TRIGGERS_KEY, workflowWallet];

    return useMutation({
        mutationFn: (triggerId: string) => deleteTrigger(workflowWallet, triggerId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });
}

export function useToggleTrigger(workflowWallet: string) {
    const queryClient = useQueryClient();
    const queryKey = [TRIGGERS_KEY, workflowWallet];

    return useMutation({
        mutationFn: ({ triggerId, enabled }: { triggerId: string; enabled: boolean }) =>
            toggleTrigger(workflowWallet, triggerId, enabled),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });
}

export function useTestTrigger(workflowWallet: string) {
    return useMutation({
        mutationFn: ({ triggerId, input }: { triggerId: string; input?: Record<string, unknown> }) =>
            testTrigger(workflowWallet, triggerId, input),
    });
}

// =============================================================================
// NL Parse Hook
// =============================================================================

export function useParseNLToCron() {
    return useMutation<NLParseResult, Error, { nlDescription: string; timezone?: string }>({
        mutationFn: ({ nlDescription, timezone }) => parseNLToCron(nlDescription, timezone),
    });
}

// =============================================================================
// Hook Hooks (lifecycle)
// =============================================================================

export function useHooks(options: UseHooksOptions): UseHooksReturn {
    const { workflowWallet, enabled = true, filterEnabled, filterType } = options;
    const queryClient = useQueryClient();

    const queryKey = [HOOKS_KEY, workflowWallet];

    const {
        data: hooks = [],
        isLoading,
        isFetching,
        error,
        dataUpdatedAt,
    } = useQuery<HookDefinition[], Error>({
        queryKey,
        queryFn: () => fetchHooks(workflowWallet!),
        staleTime: STALE_TIME,
        gcTime: STALE_TIME * 2,
        enabled: enabled && workflowWallet !== null,
    });

    const filteredHooks = useMemo(() => {
        let result = hooks;

        if (filterEnabled !== undefined) {
            result = result.filter((h) => h.enabled === filterEnabled);
        }

        if (filterType) {
            result = result.filter((h) => h.type === filterType);
        }

        // Sort by priority (lower first)
        result = [...result].sort((a, b) => a.priority - b.priority);

        return result;
    }, [hooks, filterEnabled, filterType]);

    const forceRefresh = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey });
    }, [queryClient, queryKey]);

    const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

    return {
        hooks,
        filteredHooks,
        isLoading,
        isRefetching: isFetching && !isLoading,
        error: error || null,
        forceRefresh,
        lastUpdated,
    };
}

export function useHook(
    workflowWallet: string | null,
    hookId: string | null
): HookDefinition | null {
    const { hooks } = useHooks({ workflowWallet, enabled: !!workflowWallet && !!hookId });
    return useMemo(() => {
        if (!hookId) return null;
        return hooks.find((h) => h.id === hookId) || null;
    }, [hooks, hookId]);
}

// =============================================================================
// Hook Mutations
// =============================================================================

export function useCreateHook(workflowWallet: string) {
    const queryClient = useQueryClient();
    const queryKey = [HOOKS_KEY, workflowWallet];

    return useMutation({
        mutationFn: (hook: Omit<HookDefinition, "id" | "createdAt">) =>
            createHook(workflowWallet, hook),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });
}

export function useUpdateHook(workflowWallet: string) {
    const queryClient = useQueryClient();
    const queryKey = [HOOKS_KEY, workflowWallet];

    return useMutation({
        mutationFn: ({ hookId, updates }: { hookId: string; updates: Partial<HookDefinition> }) =>
            updateHook(workflowWallet, hookId, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });
}

export function useDeleteHook(workflowWallet: string) {
    const queryClient = useQueryClient();
    const queryKey = [HOOKS_KEY, workflowWallet];

    return useMutation({
        mutationFn: (hookId: string) => deleteHook(workflowWallet, hookId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });
}
