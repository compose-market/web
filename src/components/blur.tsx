/**
 * Generation Canvas
 * 
 * Animated skeleton/placeholder shown during media generation.
 * Displays blur effect with pulsing animation and optional progress indicator.
 */
import { cn } from "@/lib/utils";
import { Loader2, ImageIcon, Music, Video } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

export interface GenerationCanvasProps {
    type: "image" | "video" | "audio";
    progress?: number;          // 0-100 percentage
    status?: string;            // "Queued", "Processing", etc.
    estimatedTime?: number;     // seconds remaining
    className?: string;
}

// =============================================================================
// Generation Canvas Component
// =============================================================================

export function GenerationCanvas({
    type,
    progress,
    status,
    estimatedTime,
    className,
}: GenerationCanvasProps) {
    const getIcon = () => {
        switch (type) {
            case "image": return <ImageIcon className="w-8 h-8" />;
            case "audio": return <Music className="w-8 h-8" />;
            case "video": return <Video className="w-8 h-8" />;
        }
    };

    const getLabel = () => {
        switch (type) {
            case "image": return "Generating image";
            case "audio": return "Generating audio";
            case "video": return "Generating video";
        }
    };

    const aspectRatio = type === "image" ? "aspect-square" : type === "video" ? "aspect-video" : "";

    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-lg bg-zinc-900/80",
                aspectRatio,
                type === "audio" ? "h-16 w-full" : "w-64",
                className
            )}
        >
            {/* Animated blur gradient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-fuchsia-500/10 to-cyan-500/10 animate-pulse" />

            {/* Shimmer effect */}
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />

            {/* Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400">
                <div className="relative">
                    {getIcon()}
                    <Loader2 className="w-4 h-4 absolute -bottom-1 -right-1 animate-spin text-cyan-400" />
                </div>

                <span className="text-xs font-medium">
                    {status || getLabel()}...
                </span>

                {/* Progress bar */}
                {progress !== undefined && progress > 0 && (
                    <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all duration-300"
                            style={{ width: `${Math.min(100, progress)}%` }}
                        />
                    </div>
                )}

                {/* Progress text */}
                {(progress !== undefined || estimatedTime !== undefined) && (
                    <span className="text-[10px] text-zinc-500">
                        {progress !== undefined && `${Math.round(progress)}%`}
                        {progress !== undefined && estimatedTime !== undefined && " · "}
                        {estimatedTime !== undefined && `~${estimatedTime}s remaining`}
                    </span>
                )}
            </div>
        </div>
    );
}
