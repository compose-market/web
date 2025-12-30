/**
 * Trigger & Hook Library
 * 
 * Universal, reusable types and API functions for workflow triggers and hooks.
 * Follows the same pattern as models.ts for consistency.
 */

const API_BASE = import.meta.env.VITE_API_URL || "";

// =============================================================================
// Types (mirrored from backend for frontend use)
// =============================================================================

export type TriggerType = "cron" | "webhook" | "event" | "manual";

export type RecurrenceInterval = "minutes" | "hours" | "days" | "weeks" | "months";

export interface RecurrenceRule {
    enabled: boolean;
    intervalSize: number;
    intervalType: RecurrenceInterval;
}

export interface TriggerDefinition {
    id: string;
    manowarWallet: string;
    name: string;
    type: TriggerType;
    nlDescription: string;
    cronExpression?: string;
    cronReadable?: string;
    timezone: string;
    enabled: boolean;
    recurrence?: RecurrenceRule;
    webhookUrl?: string;
    eventPattern?: string;
    inputTemplate?: Record<string, unknown>;
    lastRun?: number;
    nextRun?: number;
    createdAt: number;
    updatedAt: number;
    memoryId?: string;
}

export type HookType =
    | "pre-execution"
    | "post-step"
    | "on-error"
    | "on-complete"
    | "on-context-cleanup"
    | "on-restart";

export type HookActionType = "notify" | "webhook" | "agent" | "memory" | "log";

export interface HookAction {
    type: HookActionType;
    webhookUrl?: string;
    agentId?: number | string;
    notifyChannel?: string;
    memoryOperation?: "save" | "search" | "summarize";
    config?: Record<string, unknown>;
}

export interface HookDefinition {
    id: string;
    manowarWallet: string;
    name: string;
    type: HookType;
    condition?: string;
    stepFilter?: string[];
    action: HookAction;
    enabled: boolean;
    priority: number;
    createdAt: number;
}

// NL to Cron parse result
export interface NLParseResult {
    success: boolean;
    cronExpression?: string;
    cronReadable?: string;
    error?: string;
}

// =============================================================================
// Common Templates (for UI quick-select)
// =============================================================================

export const TRIGGER_TEMPLATES: Record<string, { nlDescription: string; cronExpression: string; cronReadable: string }> = {
    "every-hour": {
        nlDescription: "every hour",
        cronExpression: "0 * * * *",
        cronReadable: "Every hour, on the hour",
    },
    "daily-9am": {
        nlDescription: "every day at 9 AM",
        cronExpression: "0 9 * * *",
        cronReadable: "Every day at 9:00 AM",
    },
    "weekdays-9am": {
        nlDescription: "every weekday at 9 AM",
        cronExpression: "0 9 * * 1-5",
        cronReadable: "Weekdays at 9:00 AM",
    },
    "weekly-monday-9am": {
        nlDescription: "every Monday at 9 AM",
        cronExpression: "0 9 * * 1",
        cronReadable: "Every Monday at 9:00 AM",
    },
};

export const HOOK_TEMPLATES: Record<string, Partial<HookDefinition>> = {
    "notify-on-complete": {
        name: "Notify on Complete",
        type: "on-complete",
        action: { type: "log" },
        enabled: true,
        priority: 100,
    },
    "save-on-complete": {
        name: "Save Results",
        type: "on-complete",
        action: { type: "memory", memoryOperation: "save" },
        enabled: true,
        priority: 50,
    },
    "log-on-error": {
        name: "Log Errors",
        type: "on-error",
        action: { type: "log" },
        enabled: true,
        priority: 10,
    },
    "summarize-on-cleanup": {
        name: "Summarize Context",
        type: "on-context-cleanup",
        action: { type: "memory", memoryOperation: "summarize" },
        enabled: true,
        priority: 1,
    },
};

// =============================================================================
// API Functions
// =============================================================================

/**
 * Parse natural language to cron expression using LLM
 */
export async function parseNLToCron(nlDescription: string, timezone?: string): Promise<NLParseResult> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/triggers/parse`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nlDescription, timezone }),
        });
        if (!res.ok) {
            const error = await res.json().catch(() => ({ error: "Parse failed" }));
            return { success: false, error: error.error || `HTTP ${res.status}` };
        }
        const data = await res.json();
        return {
            success: true,
            cronExpression: data.cronExpression,
            cronReadable: data.cronReadable,
        };
    } catch (error) {
        console.error("[triggers] NL parse failed:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Fetch triggers for a Manowar workflow
 */
export async function fetchTriggers(manowarWallet: string): Promise<TriggerDefinition[]> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/triggers`);
        if (!res.ok) throw new Error(`Failed to fetch triggers: ${res.status}`);
        const data = await res.json();
        return data.triggers || [];
    } catch (error) {
        console.error("[triggers] Failed to fetch:", error);
        return [];
    }
}

/**
 * Create a new trigger
 */
export async function createTrigger(
    manowarWallet: string,
    trigger: Omit<TriggerDefinition, "id" | "createdAt" | "updatedAt" | "memoryId">
): Promise<TriggerDefinition | null> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/triggers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(trigger),
        });
        if (!res.ok) throw new Error(`Failed to create trigger: ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error("[triggers] Failed to create:", error);
        return null;
    }
}

/**
 * Update an existing trigger
 */
export async function updateTrigger(
    manowarWallet: string,
    triggerId: string,
    updates: Partial<TriggerDefinition>
): Promise<TriggerDefinition | null> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/triggers/${triggerId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error(`Failed to update trigger: ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error("[triggers] Failed to update:", error);
        return null;
    }
}

/**
 * Delete a trigger
 */
export async function deleteTrigger(manowarWallet: string, triggerId: string): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/triggers/${triggerId}`, {
            method: "DELETE",
        });
        return res.ok;
    } catch (error) {
        console.error("[triggers] Failed to delete:", error);
        return false;
    }
}

/**
 * Toggle trigger enabled state
 */
export async function toggleTrigger(
    manowarWallet: string,
    triggerId: string,
    enabled: boolean
): Promise<boolean> {
    const result = await updateTrigger(manowarWallet, triggerId, { enabled });
    return result !== null;
}

/**
 * Test a trigger (execute immediately)
 */
export async function testTrigger(
    manowarWallet: string,
    triggerId: string,
    inputOverride?: Record<string, unknown>
): Promise<{ success: boolean; executionId?: string; error?: string }> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/triggers/${triggerId}/test`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: inputOverride }),
        });
        if (!res.ok) {
            const error = await res.json().catch(() => ({ error: "Test failed" }));
            return { success: false, error: error.error };
        }
        const data = await res.json();
        return { success: true, executionId: data.executionId };
    } catch (error) {
        console.error("[triggers] Test failed:", error);
        return { success: false, error: String(error) };
    }
}

// =============================================================================
// Hook API Functions
// =============================================================================

/**
 * Fetch hooks for a Manowar workflow
 */
export async function fetchHooks(manowarWallet: string): Promise<HookDefinition[]> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/hooks`);
        if (!res.ok) throw new Error(`Failed to fetch hooks: ${res.status}`);
        const data = await res.json();
        return data.hooks || [];
    } catch (error) {
        console.error("[hooks] Failed to fetch:", error);
        return [];
    }
}

/**
 * Create a new hook
 */
export async function createHook(
    manowarWallet: string,
    hook: Omit<HookDefinition, "id" | "createdAt">
): Promise<HookDefinition | null> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/hooks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(hook),
        });
        if (!res.ok) throw new Error(`Failed to create hook: ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error("[hooks] Failed to create:", error);
        return null;
    }
}

/**
 * Update an existing hook
 */
export async function updateHook(
    manowarWallet: string,
    hookId: string,
    updates: Partial<HookDefinition>
): Promise<HookDefinition | null> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/hooks/${hookId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error(`Failed to update hook: ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error("[hooks] Failed to update:", error);
        return null;
    }
}

/**
 * Delete a hook
 */
export async function deleteHook(manowarWallet: string, hookId: string): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/api/manowar/${manowarWallet}/hooks/${hookId}`, {
            method: "DELETE",
        });
        return res.ok;
    } catch (error) {
        console.error("[hooks] Failed to delete:", error);
        return false;
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get human-readable time until next trigger run
 */
export function getTimeUntilNextRun(nextRun: number | undefined): string {
    if (!nextRun) return "Not scheduled";
    const now = Date.now();
    const diff = nextRun - now;
    if (diff < 0) return "Overdue";
    if (diff < 60000) return "Less than a minute";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours`;
    return `${Math.floor(diff / 86400000)} days`;
}

/**
 * Get common timezones for trigger selection
 */
export const COMMON_TIMEZONES = [
    "UTC",
    "America/New_York",
    "America/Los_Angeles",
    "America/Chicago",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Australia/Sydney",
] as const;

/**
 * Get user's browser timezone
 */
export function getUserTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
