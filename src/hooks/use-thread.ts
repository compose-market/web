/**
 * Conversation thread identity.
 *
 * One implementation of the sessionStorage-backed thread ID that scopes a
 * conversation to (user, counterpart). The agent page and the workflow page
 * previously carried private copies of this machinery.
 */

import { useCallback, useRef } from "react";

export interface ThreadKey {
    /** sessionStorage key holding the thread ID. */
    key: string;
    /** Prefix for freshly generated thread IDs. */
    idPrefix: string;
}

export function useConversationThread(keyFactory: () => ThreadKey | null) {
    const threadIdRef = useRef<string | null>(null);
    const rootRunIdRef = useRef<string | null>(null);

    const resetConversationThread = useCallback((): string | null => {
        const thread = keyFactory();
        if (!thread) {
            threadIdRef.current = null;
            rootRunIdRef.current = null;
            return null;
        }
        sessionStorage.removeItem(thread.key);
        sessionStorage.removeItem(`${thread.key}:root`);
        const nextThreadId = `${thread.idPrefix}-${crypto.randomUUID()}`;
        sessionStorage.setItem(thread.key, nextThreadId);
        const nextRootRunId = `root-${crypto.randomUUID()}`;
        sessionStorage.setItem(`${thread.key}:root`, nextRootRunId);
        threadIdRef.current = nextThreadId;
        rootRunIdRef.current = nextRootRunId;
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
            return storedThreadId;
        }

        const createdThreadId = resetConversationThread();
        if (!createdThreadId) {
            throw new Error("Unable to initialize conversation thread");
        }
        return createdThreadId;
    }, [keyFactory, resetConversationThread]);

    /**
     * Stable root run id for the conversation: one runstate namespace for
     * every turn of the thread (archive, conclave, watch). The runtime
     * adopts this as x-run-id/rootRunId and mints a fresh child runId per
     * turn, so replayed proposals and watch subscriptions stay attached.
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
            return storedRoot;
        }
        ensureConversationThread();
        const created = rootRunIdRef.current ?? sessionStorage.getItem(`${thread.key}:root`);
        if (!created) {
            throw new Error("Unable to initialize conversation root run");
        }
        return created;
    }, [keyFactory, ensureConversationThread]);

    return { threadIdRef, rootRunIdRef, resetConversationThread, ensureConversationThread, ensureConversationRootRun };
}
