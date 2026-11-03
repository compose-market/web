/**
 * Conversation thread identity.
 *
 * One implementation of the sessionStorage-backed thread ID that scopes a
 * conversation to (user, counterpart). The agent page and the workflow page
 * previously carried private copies of this machinery.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ThreadKey {
    /** sessionStorage key holding the thread ID. */
    key: string;
    /** Prefix for freshly generated thread IDs. */
    idPrefix: string;
}

function readWatchableRun(key: string, expectedThreadId: string | null): { threadId: string; rootRunId: string } | null {
    const raw = sessionStorage.getItem(`${key}:watch`);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { threadId?: unknown; rootRunId?: unknown };
        const threadId = typeof parsed.threadId === "string" ? parsed.threadId.trim() : "";
        const rootRunId = typeof parsed.rootRunId === "string" ? parsed.rootRunId.trim() : "";
        if (!threadId || !rootRunId) return null;
        if (expectedThreadId && threadId !== expectedThreadId) return null;
        return { threadId, rootRunId };
    } catch {
        return null;
    }
}

export function useConversationThread(keyFactory: () => ThreadKey | null) {
    const threadIdRef = useRef<string | null>(null);
    const rootRunIdRef = useRef<string | null>(null);
    const [threadId, setThreadId] = useState<string | null>(null);
    const [rootRunId, setRootRunId] = useState<string | null>(null);
    const [restoredRun, setRestoredRun] = useState<{ threadId: string; rootRunId: string } | null>(null);

    // Sync refs and reactive state from sessionStorage whenever the thread key resolves/changes.
    // Only restore runs explicitly marked as watchable (active plan or pending connector gate),
    // never ordinary single-turn chats whose rootRunId has no persisted plan state.
    useEffect(() => {
        const thread = keyFactory();
        if (!thread) {
            threadIdRef.current = null;
            rootRunIdRef.current = null;
            setThreadId(null);
            setRootRunId(null);
            setRestoredRun(null);
            return;
        }
        const storedThread = sessionStorage.getItem(thread.key);
        const storedRoot = sessionStorage.getItem(`${thread.key}:root`);
        threadIdRef.current = storedThread;
        rootRunIdRef.current = storedRoot;
        setThreadId(storedThread);
        setRootRunId(storedRoot);
        setRestoredRun(readWatchableRun(thread.key, storedThread));
    }, [keyFactory]);

    const markWatchableRun = useCallback((runId: string, activeThreadId?: string | null): void => {
        const thread = keyFactory();
        const cleanRun = runId.trim();
        const cleanThread = (activeThreadId ?? threadIdRef.current)?.trim() || "";
        if (!thread || !cleanRun || !cleanThread) return;
        sessionStorage.setItem(`${thread.key}:watch`, JSON.stringify({ threadId: cleanThread, rootRunId: cleanRun }));
    }, [keyFactory]);

    const clearWatchableRun = useCallback((): void => {
        const thread = keyFactory();
        if (thread) {
            sessionStorage.removeItem(`${thread.key}:watch`);
        }
        setRestoredRun(null);
    }, [keyFactory]);

    const resetConversationThread = useCallback((): string | null => {
        const thread = keyFactory();
        if (!thread) {
            threadIdRef.current = null;
            rootRunIdRef.current = null;
            setThreadId(null);
            setRootRunId(null);
            setRestoredRun(null);
            return null;
        }
        sessionStorage.removeItem(thread.key);
        sessionStorage.removeItem(`${thread.key}:root`);
        sessionStorage.removeItem(`${thread.key}:watch`);
        const nextThreadId = `${thread.idPrefix}-${crypto.randomUUID()}`;
        sessionStorage.setItem(thread.key, nextThreadId);
        const nextRootRunId = `root-${crypto.randomUUID()}`;
        sessionStorage.setItem(`${thread.key}:root`, nextRootRunId);
        threadIdRef.current = nextThreadId;
        rootRunIdRef.current = nextRootRunId;
        setThreadId(nextThreadId);
        setRootRunId(nextRootRunId);
        setRestoredRun(null);
        return nextThreadId;
    }, [keyFactory]);

    const ensureConversationThread = useCallback((): string => {
        const thread = keyFactory();
        if (!thread) {
            throw new Error("Unable to initialize conversation thread");
        }

        if (threadIdRef.current && sessionStorage.getItem(thread.key) === threadIdRef.current) {
            return threadIdRef.current;
        }

        const storedThreadId = sessionStorage.getItem(thread.key);
        if (storedThreadId) {
            threadIdRef.current = storedThreadId;
            setThreadId(storedThreadId);
            return storedThreadId;
        }

        const createdThreadId = resetConversationThread();
        if (!createdThreadId) {
            throw new Error("Unable to initialize conversation thread");
        }
        return createdThreadId;
    }, [keyFactory, resetConversationThread]);

    /**
     * Mint a fresh per-turn root run id while keeping the conversation threadId
     * stable across turns, so receipts and plan lifecycles stay scoped strictly
     * to the turn that triggered them (never bleeding receipts across turns).
     */
    const createTurnRunId = useCallback((): string => {
        const thread = keyFactory();
        if (!thread) {
            throw new Error("Unable to initialize conversation thread");
        }
        ensureConversationThread();
        const nextRunId = `root-${crypto.randomUUID()}`;
        sessionStorage.setItem(`${thread.key}:root`, nextRunId);
        rootRunIdRef.current = nextRunId;
        setRootRunId(nextRunId);
        return nextRunId;
    }, [keyFactory, ensureConversationThread]);

    /**
     * Current active root run id for the latest turn in this conversation.
     */
    const ensureConversationRootRun = useCallback((): string => {
        const thread = keyFactory();
        if (!thread) {
            throw new Error("Unable to initialize conversation thread");
        }
        if (rootRunIdRef.current && sessionStorage.getItem(`${thread.key}:root`) === rootRunIdRef.current) {
            return rootRunIdRef.current;
        }
        const storedRoot = sessionStorage.getItem(`${thread.key}:root`);
        if (storedRoot) {
            rootRunIdRef.current = storedRoot;
            setRootRunId(storedRoot);
            return storedRoot;
        }
        ensureConversationThread();
        const created = rootRunIdRef.current ?? sessionStorage.getItem(`${thread.key}:root`);
        if (!created) {
            throw new Error("Unable to initialize conversation root run");
        }
        return created;
    }, [keyFactory, ensureConversationThread]);

    const selectConversationThread = useCallback((nextThreadId: string, nextRootRunId?: string | null): void => {
        const thread = keyFactory();
        const cleanThread = nextThreadId.trim();
        if (!cleanThread) return;
        const cleanRoot = nextRootRunId?.trim() || `root-${crypto.randomUUID()}`;
        if (thread) {
            sessionStorage.setItem(thread.key, cleanThread);
            sessionStorage.setItem(`${thread.key}:root`, cleanRoot);
            sessionStorage.removeItem(`${thread.key}:watch`);
        }
        threadIdRef.current = cleanThread;
        rootRunIdRef.current = cleanRoot;
        setThreadId(cleanThread);
        setRootRunId(cleanRoot);
        setRestoredRun(null);
    }, [keyFactory]);

    return {
        threadId,
        rootRunId,
        restoredRun,
        threadIdRef,
        rootRunIdRef,
        markWatchableRun,
        clearWatchableRun,
        resetConversationThread,
        selectConversationThread,
        ensureConversationThread,
        ensureConversationRootRun,
        createTurnRunId,
    };
}
