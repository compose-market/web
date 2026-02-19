/**
 * WebSocket Hook for Session Events
 * 
 * Connects to backend WebSocket for real-time session expiration notifications.
 * 
 * Production: wss://ws.compose.market
 * Development: ws://localhost:3000/ws (via Vite proxy)
 * 
 * @module hooks/useWs
 */

import { useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

const WS_URL = import.meta.env.VITE_WS_LAMBDA_URL || 
    (import.meta.env.PROD 
        ? "wss://ws.compose.market" 
        : "ws://localhost:3000/ws");

export interface SessionExpiredEvent {
    action: "session-expired";
    userAddress: string;
    chainId: number;
    message: string;
    timestamp: number;
}

export function useWs(userAddress: string | undefined, chainId: number) {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectRef = useRef<NodeJS.Timeout | null>(null);
    const { toast } = useToast();

    const connect = useCallback(() => {
        if (!userAddress || wsRef.current?.readyState === WebSocket.OPEN) return;

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("[ws] Connected");
            ws.send(JSON.stringify({
                action: "subscribe",
                userAddress,
                chainId,
            }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.action === "session-expired") {
                    console.log("[ws] Session expired notification");
                    toast({
                        title: "Session Expired",
                        description: data.message || "Session expired, create a new session to use our services",
                        variant: "destructive",
                    });

                    window.dispatchEvent(new CustomEvent("session-expired", { detail: data }));
                }
            } catch (err) {
                console.error("[ws] Parse error:", err);
            }
        };

        ws.onclose = () => {
            console.log("[ws] Disconnected");
            wsRef.current = null;

            if (reconnectRef.current) {
                clearTimeout(reconnectRef.current);
            }
            reconnectRef.current = setTimeout(() => {
                connect();
            }, 3000);
        };

        ws.onerror = (err) => {
            console.error("[ws] Error:", err);
        };
    }, [userAddress, chainId, toast]);

    const disconnect = useCallback(() => {
        if (reconnectRef.current) {
            clearTimeout(reconnectRef.current);
            reconnectRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    }, []);

    useEffect(() => {
        connect();
        return () => disconnect();
    }, [connect, disconnect]);

    return { connect, disconnect };
}