/**
 * Session Events Hook (SSE)
 *
 * Uses Cloud Run-native Server-Sent Events for one-way session updates.
 *
 * @module hooks/useWs
 */

import { useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { API_BASE_URL } from "@/lib/api";

const SESSION_EVENTS_URL = `${API_BASE_URL}/api/session/events`;
const RECONNECT_MS = 3000;

export interface SessionExpiredEvent {
    action: "session-expired";
    userAddress: string;
    chainId: number;
    message: string;
    reason?: string;
    expiresAt?: number | null;
    timestamp: number;
}

export function useWs(userAddress: string | undefined, chainId: number) {
    const sourceRef = useRef<EventSource | null>(null);
    const reconnectRef = useRef<NodeJS.Timeout | null>(null);
    const { toast } = useToast();

    const disconnect = useCallback(() => {
        if (reconnectRef.current) {
            clearTimeout(reconnectRef.current);
            reconnectRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.close();
            sourceRef.current = null;
        }
    }, []);

    const connect = useCallback(() => {
        if (!userAddress || sourceRef.current) return;

        const params = new URLSearchParams({
            userAddress,
            chainId: String(chainId),
        });
        const source = new EventSource(`${SESSION_EVENTS_URL}?${params.toString()}`);
        sourceRef.current = source;

        source.onopen = () => {
            console.log("[session-events] Connected");
        };

        source.addEventListener("session-expired", (event: MessageEvent<string>) => {
            try {
                const data = JSON.parse(event.data) as SessionExpiredEvent;

                if (data.action === "session-expired") {
                    console.log("[session-events] Session expired notification");
                    toast({
                        title: "Session Expired",
                        description: data.message || "Session expired, create a new session to use our services",
                        variant: "destructive",
                    });

                    window.dispatchEvent(new CustomEvent("session-expired", { detail: data }));
                    disconnect();
                }
            } catch (err) {
                console.error("[session-events] Parse error:", err);
            }
        });

        source.addEventListener("session-active", (event: MessageEvent<string>) => {
            try {
                const data = JSON.parse(event.data) as {
                    userAddress: string;
                    chainId: number;
                    expiresAt?: number;
                    budgetRemaining?: number | string;
                    sessionId?: string;
                    duration?: number;
                    timestamp?: number;
                };

                window.dispatchEvent(new CustomEvent("session-active", { detail: data }));
            } catch (err) {
                console.error("[session-events] Active parse error:", err);
            }
        });

        source.onerror = () => {
            if (source.readyState === EventSource.CLOSED) {
                source.close();
                sourceRef.current = null;
                if (reconnectRef.current) {
                    clearTimeout(reconnectRef.current);
                }
                reconnectRef.current = setTimeout(() => {
                    connect();
                }, RECONNECT_MS);
            }
        };
    }, [userAddress, chainId, toast, disconnect]);

    useEffect(() => {
        if (!userAddress) return;
        connect();
        return () => disconnect();
    }, [userAddress, connect, disconnect]);

    return { connect, disconnect };
}
