/**
 * Lyria Audio Player
 * 
 * Real-time PCM audio playback component for Lyria WebSocket streaming.
 * Handles continuous audio chunks and plays them seamlessly using Web Audio API.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square, Music2, Volume2 } from "lucide-react";
import type { LyriaAudioChunk } from "@/hooks/use-lyria";

interface LyriaAudioPlayerProps {
  audioQueue: LyriaAudioChunk[];
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onConsumeQueue: (count: number) => void;
  config?: {
    bpm?: number;
    temperature?: number;
    scale?: string;
  };
}

export function LyriaAudioPlayer({
  audioQueue,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  onConsumeQueue,
  config,
}: LyriaAudioPlayerProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const [volume, setVolume] = useState(0.8);
  const gainNodeRef = useRef<GainNode | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const playbackStartTimeRef = useRef<number>(0);
  const playbackIntervalRef = useRef<number | null>(null);

  // Initialize audio context on first user interaction
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000, // Match Lyria's sample rate
      });
      
      // Create gain node for volume control
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = volume;
      gainNodeRef.current.connect(audioContextRef.current.destination);
      
      nextPlayTimeRef.current = audioContextRef.current.currentTime;
    }
    return audioContextRef.current;
  }, [volume]);

  // Convert base64 PCM to AudioBuffer
  const decodePCMChunk = useCallback((chunk: LyriaAudioChunk): Float32Array => {
    // Decode base64
    const binaryString = atob(chunk.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Convert PCM16 to Float32
    // PCM16 is signed 16-bit little-endian
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    
    for (let i = 0; i < pcm16.length; i++) {
      // Convert -32768 to 32767 range to -1.0 to 1.0
      float32[i] = pcm16[i] / 32768;
    }
    
    return float32;
  }, []);

  // Schedule audio chunks for playback
  const scheduleAudioChunks = useCallback(() => {
    const audioContext = audioContextRef.current;
    if (!audioContext || audioQueue.length === 0) return;

    for (const chunk of audioQueue) {
      try {
        // Decode PCM data
        const floatData = decodePCMChunk(chunk);
        
        // Create audio buffer
        const buffer = audioContext.createBuffer(
          chunk.channels,
          floatData.length / chunk.channels,
          chunk.sampleRate
        );
        
        // Fill buffer (interleaved to planar)
        for (let channel = 0; channel < chunk.channels; channel++) {
          const channelData = buffer.getChannelData(channel);
          for (let i = 0; i < channelData.length; i++) {
            channelData[i] = floatData[i * chunk.channels + channel];
          }
        }
        
        // Create source and connect
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNodeRef.current!);
        
        // Schedule playback
        const currentTime = audioContext.currentTime;
        const playTime = Math.max(nextPlayTimeRef.current, currentTime);
        
        source.start(playTime);
        
        // Update next play time
        nextPlayTimeRef.current = playTime + buffer.duration;
        
        // Clean up when done
        source.onended = () => {
          source.disconnect();
        };
      } catch (err) {
        console.error("[LyriaAudioPlayer] Error scheduling chunk:", err);
      }
    }

    onConsumeQueue(audioQueue.length);
  }, [audioQueue, decodePCMChunk, onConsumeQueue]);

  // Update volume when changed
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  // Schedule new chunks when queue updates
  useEffect(() => {
    if (isPlaying && audioQueue.length > 0) {
      const audioContext = initAudioContext();
      if (audioContext.state === "suspended") {
        void audioContext.resume();
      }
      scheduleAudioChunks();
    }
  }, [audioQueue, isPlaying, initAudioContext, scheduleAudioChunks]);

  // Handle play/pause
  useEffect(() => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;
    
    if (isPlaying) {
      if (audioContext.state === "suspended") {
        void audioContext.resume();
      }
      scheduleAudioChunks();
      playbackStartTimeRef.current = Date.now();
    } else {
      // Don't suspend - let current audio finish
    }
  }, [isPlaying, scheduleAudioChunks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
      if (playbackIntervalRef.current !== null) {
        window.clearInterval(playbackIntervalRef.current);
      }
    };
  }, []);

  // Update playback time
  useEffect(() => {
    if (isPlaying) {
      const intervalId = window.setInterval(() => {
        if (playbackStartTimeRef.current) {
          setPlaybackTime((Date.now() - playbackStartTimeRef.current) / 1000);
        }
      }, 250);
      playbackIntervalRef.current = intervalId;
    } else {
      if (playbackIntervalRef.current !== null) {
        window.clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    }

    return () => {
      if (playbackIntervalRef.current !== null) {
        window.clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    };
  }, [isPlaying]);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col gap-3 p-4 border border-purple-500/30 rounded-lg bg-purple-500/5">
      {/* Header */}
      <div className="flex items-center gap-2 text-purple-400">
        <Music2 className="w-4 h-4" />
        <span className="text-sm font-mono">Lyria RealTime</span>
        {config && (
          <span className="text-xs text-purple-400/60 ml-auto">
            {config.bpm} BPM | {config.temperature?.toFixed(1)} temp
            {config.scale ? ` | ${config.scale}` : ""}
          </span>
        )}
      </div>
      
      {/* Playback Controls */}
      <div className="flex items-center gap-2">
        {!isPlaying ? (
          <Button
            size="sm"
            onClick={() => {
              initAudioContext();
              onPlay();
            }}
            className="bg-purple-500 hover:bg-purple-600 text-white"
          >
            <Play className="w-4 h-4 mr-1" />
            Play
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onPause}
            variant="outline"
            className="border-purple-500/50 text-purple-400"
          >
            <Pause className="w-4 h-4 mr-1" />
            Pause
          </Button>
        )}
        
        <Button
          size="sm"
          onClick={() => {
            onStop();
            nextPlayTimeRef.current = audioContextRef.current?.currentTime || 0;
            setPlaybackTime(0);
          }}
          variant="outline"
          className="border-red-500/50 text-red-400 hover:bg-red-500/10"
        >
          <Square className="w-4 h-4 mr-1" />
          Stop
        </Button>
        
        <div className="flex-1" />
        
        {/* Volume Control */}
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-purple-400" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-20 h-1 bg-purple-500/30 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>
      
      {/* Status Bar */}
      <div className="flex items-center justify-between text-xs text-purple-400/60">
        <span>{audioQueue.length} chunks queued</span>
        <span>{isPlaying ? `Playing ${formatTime(playbackTime)}` : "Ready"}</span>
      </div>
      
      {/* Visualizer Placeholder */}
      <div className="h-8 bg-purple-500/10 rounded flex items-center justify-center">
        {isPlaying ? (
          <div className="flex items-center gap-1">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-purple-400 rounded-full animate-pulse"
                style={{
                  height: `${Math.random() * 20 + 8}px`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        ) : (
          <span className="text-xs text-purple-400/40">Audio visualization</span>
        )}
      </div>
    </div>
  );
}
