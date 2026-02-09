/**
 * Lyria RealTime WebSocket Hook
 * 
 * Handles real-time music generation via WebSocket connection to socket server.
 * Connects to ws://localhost:4004/lyria (or production socket server)
 * 
 * Protocol:
 * 1. Connect to WebSocket
 * 2. Send { type: "connect" } to start Lyria session
 * 3. Send { type: "prompt", prompt: "..." } or { type: "prompt", weightedPrompts: [...] }
 * 4. Send { type: "config", config: { bpm, temperature, scale } }
 * 5. Send { type: "play" } to start generation
 * 6. Receive { type: "audio", data: "base64_pcm", format: "pcm16", sampleRate: 48000, channels: 2 }
 * 7. Send { type: "pause" }, { type: "stop" }, { type: "reset" } to control
 * 8. Send { type: "disconnect" } or close WebSocket to end
 */

import { useState, useRef, useCallback, useEffect } from "react";

// =============================================================================
// Types
// =============================================================================

export interface WeightedPrompt {
  text: string;
  weight: number;
}

export interface LyriaConfig {
  bpm?: number;
  temperature?: number;
  scale?: string;
  audioFormat?: string;
  sampleRateHz?: number;
}

export interface LyriaAudioChunk {
  type: "audio";
  data: string; // Base64-encoded PCM16 data
  format: "pcm16";
  sampleRate: number;
  channels: number;
}

export interface LyriaMessage {
  type: string;
  [key: string]: any;
}

export type LyriaConnectionState = 
  | "idle"
  | "connecting"
  | "connected"
  | "ready"
  | "playing"
  | "paused"
  | "error"
  | "closed";

export interface UseLyriaWebSocketReturn {
  // Connection state
  state: LyriaConnectionState;
  sessionId: string | null;
  error: string | null;
  
  // Audio data
  audioQueue: LyriaAudioChunk[];
  currentConfig: LyriaConfig;
  
  // Actions
  connect: () => void;
  disconnect: () => void;
  setPrompt: (prompt: string) => void;
  setWeightedPrompts: (prompts: WeightedPrompt[]) => void;
  setConfig: (config: LyriaConfig) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  reset: () => void;
  
  // Clear audio queue (call after consuming audio)
  clearAudioQueue: () => void;
}

// =============================================================================
// Configuration
// =============================================================================

// Use the configured socket URL from environment, append /lyria path
const SOCKET_URL = `${import.meta.env.VITE_SOCKET_URL}/lyria`;

// =============================================================================
// Hook
// =============================================================================

export function useLyriaWebSocket(): UseLyriaWebSocketReturn {
  // Connection state
  const [state, setState] = useState<LyriaConnectionState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioQueue, setAudioQueue] = useState<LyriaAudioChunk[]>([]);
  const [currentConfig, setCurrentConfig] = useState<LyriaConfig>({
    bpm: 90,
    temperature: 1.0,
  });
  
  // Refs for WebSocket and pending prompts
  const wsRef = useRef<WebSocket | null>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const pendingWeightedPromptsRef = useRef<WeightedPrompt[] | null>(null);
  const pendingConfigRef = useRef<LyriaConfig | null>(null);
  
  // =============================================================================
  // WebSocket Message Handler
  // =============================================================================
  
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data) as LyriaMessage;
      
      switch (message.type) {
        case "session":
          setSessionId(message.sessionId || null);
          console.log("[Lyria] Session created:", message.sessionId);
          break;
          
        case "connected":
          setState("ready");
          console.log("[Lyria] Connected to Lyria RealTime");
          
          // Send pending prompts/config if any
          if (pendingPromptRef.current) {
            setPrompt(pendingPromptRef.current);
            pendingPromptRef.current = null;
          } else if (pendingWeightedPromptsRef.current) {
            setWeightedPrompts(pendingWeightedPromptsRef.current);
            pendingWeightedPromptsRef.current = null;
          }
          
          if (pendingConfigRef.current) {
            setConfig(pendingConfigRef.current);
            pendingConfigRef.current = null;
          }
          break;
          
        case "audio":
          // Add audio chunk to queue
          const audioChunk: LyriaAudioChunk = {
            type: "audio",
            data: message.data,
            format: message.format || "pcm16",
            sampleRate: message.sampleRate || 48000,
            channels: message.channels || 2,
          };
          setAudioQueue(prev => [...prev, audioChunk]);
          break;
          
        case "status":
          console.log("[Lyria] Status update:", message);
          break;
          
        case "ack":
          console.log("[Lyria] Acknowledged:", message.action);
          if (message.action === "play") {
            setState("playing");
          } else if (message.action === "pause") {
            setState("paused");
          } else if (message.action === "stop") {
            setState("ready");
            setAudioQueue([]);
          } else if (message.action === "config" && message.config) {
            setCurrentConfig(message.config);
          }
          break;
          
        case "error":
          console.error("[Lyria] Error:", message.message);
          setError(message.message || "Unknown error");
          setState("error");
          break;
          
        case "closed":
          console.log("[Lyria] Stream closed");
          setState("closed");
          break;
          
        default:
          console.log("[Lyria] Unknown message type:", message.type, message);
      }
    } catch (err) {
      console.error("[Lyria] Failed to parse message:", err);
    }
  }, []);
  
  // =============================================================================
  // Actions
  // =============================================================================
  
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("[Lyria] Already connected");
      return;
    }
    
    setState("connecting");
    setError(null);
    
    try {
      const ws = new WebSocket(SOCKET_URL);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log("[Lyria] WebSocket connected");
        setState("connected");
        
        // Send connect message to start Lyria session
        ws.send(JSON.stringify({ type: "connect" }));
      };
      
      ws.onmessage = handleMessage;
      
      ws.onerror = (event) => {
        console.error("[Lyria] WebSocket error:", event);
        setError("WebSocket connection failed");
        setState("error");
      };
      
      ws.onclose = () => {
        console.log("[Lyria] WebSocket closed");
        setState("closed");
        wsRef.current = null;
      };
    } catch (err) {
      console.error("[Lyria] Failed to connect:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setState("error");
    }
  }, [handleMessage]);
  
  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "disconnect" }));
      ws.close();
    }
    wsRef.current = null;
    setState("idle");
    setSessionId(null);
    setAudioQueue([]);
    setError(null);
  }, []);
  
  const setPrompt = useCallback((prompt: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pendingPromptRef.current = prompt;
      return;
    }
    
    ws.send(JSON.stringify({
      type: "prompt",
      prompt,
    }));
  }, []);
  
  const setWeightedPrompts = useCallback((prompts: WeightedPrompt[]) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pendingWeightedPromptsRef.current = prompts;
      return;
    }
    
    ws.send(JSON.stringify({
      type: "prompt",
      weightedPrompts: prompts,
    }));
  }, []);
  
  const setConfig = useCallback((config: LyriaConfig) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pendingConfigRef.current = config;
      return;
    }
    
    ws.send(JSON.stringify({
      type: "config",
      config,
    }));
    
    setCurrentConfig(prev => ({ ...prev, ...config }));
  }, []);
  
  const play = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "play" }));
    }
  }, []);
  
  const pause = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "pause" }));
    }
  }, []);
  
  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    setAudioQueue([]);
  }, []);
  
  const reset = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "reset" }));
    }
    setAudioQueue([]);
  }, []);
  
  const clearAudioQueue = useCallback(() => {
    setAudioQueue([]);
  }, []);
  
  // =============================================================================
  // Cleanup on unmount
  // =============================================================================
  
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);
  
  return {
    state,
    sessionId,
    error,
    audioQueue,
    currentConfig,
    connect,
    disconnect,
    setPrompt,
    setWeightedPrompts,
    setConfig,
    play,
    pause,
    stop,
    reset,
    clearAudioQueue,
  };
}
