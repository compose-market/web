/**
 * Workflow Output Panel - Display multimodal workflow execution results
 * 
 * This component shows the output from Workflow executions in compose.tsx,
 * supporting images, audio, video, text, and step-by-step results.
 * 
 * Uses fuchsia brand color (Manowar theme) for consistency.
 */
import React, { memo } from "react";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
    CheckCircle2,
    XCircle,
    Loader2,
    Image as ImageIcon,
    Music,
    Video,
    FileText,
    DollarSign,
    Clock,
    Download,
    Copy,
    Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowStepResult {
    stepId: string;
    stepName: string;
    status: "pending" | "running" | "success" | "error";
    error?: string;
    output?: unknown;
}

export interface WorkflowExecutionResult {
    success: boolean;
    workflowId: string;
    status: string;
    steps: WorkflowStepResult[];
    output: Record<string, unknown> & {
        multimodal?: {
            output: string;
            outputType: "image" | "audio" | "video" | "text";
            fromAgent?: string;
        };
    };
    totalCostWei: string;
    error?: string;
    executionTime?: number;
}

interface WorkflowOutputPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    result: WorkflowExecutionResult | null;
    workflowName?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function getOutputType(output: unknown): "text" | "image" | "audio" | "video" | "json" {
    if (!output) return "text";

    if (typeof output === "string") {
        const lower = output.toLowerCase();
        // Check for common image formats and data URLs
        if (lower.startsWith("data:image/") ||
            lower.match(/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i) ||
            lower.includes("ipfs") && lower.match(/\.(png|jpg|jpeg|gif|webp)/i)) {
            return "image";
        }
        // Check for audio
        if (lower.startsWith("data:audio/") ||
            lower.match(/\.(mp3|wav|ogg|m4a|flac)(\?|$)/i)) {
            return "audio";
        }
        // Check for video
        if (lower.startsWith("data:video/") ||
            lower.match(/\.(mp4|webm|mov|avi)(\?|$)/i)) {
            return "video";
        }
        return "text";
    }

    if (typeof output === "object") {
        const obj = output as Record<string, unknown>;
        // Check for common multimodal response patterns
        if (obj.imageUrl || obj.image_url || obj.image) return "image";
        if (obj.audioUrl || obj.audio_url || obj.audio) return "audio";
        if (obj.videoUrl || obj.video_url || obj.video) return "video";
        return "json";
    }

    return "text";
}

function extractMediaUrl(output: unknown): string | null {
    if (typeof output === "string") return output;

    if (typeof output === "object" && output) {
        const obj = output as Record<string, unknown>;
        return (
            (obj.imageUrl as string) ||
            (obj.image_url as string) ||
            (obj.image as string) ||
            (obj.audioUrl as string) ||
            (obj.audio_url as string) ||
            (obj.audio as string) ||
            (obj.videoUrl as string) ||
            (obj.video_url as string) ||
            (obj.video as string) ||
            (obj.url as string) ||
            null
        );
    }

    return null;
}

function formatCost(weiString: string): string {
    const wei = parseInt(weiString) || 0;
    return `$${(wei / 1_000_000).toFixed(4)}`;
}

// =============================================================================
// Step Result Item
// =============================================================================

const StepResultItem = memo(function StepResultItem({
    step
}: {
    step: WorkflowStepResult
}) {
    const outputType = getOutputType(step.output);
    const mediaUrl = extractMediaUrl(step.output);

    const statusIcon = {
        pending: <Clock className="w-4 h-4 text-muted-foreground" />,
        running: <Loader2 className="w-4 h-4 text-fuchsia-400 animate-spin" />,
        success: <CheckCircle2 className="w-4 h-4 text-green-500" />,
        error: <XCircle className="w-4 h-4 text-red-500" />,
    };

    const outputIcon: Record<string, React.ReactNode> = {
        text: <FileText className="w-3 h-3" />,
        image: <ImageIcon className="w-3 h-3" />,
        audio: <Music className="w-3 h-3" />,
        video: <Video className="w-3 h-3" />,
        json: <FileText className="w-3 h-3" />,
    };

    return (
        <div className="space-y-2 p-3 rounded-md bg-sidebar-accent/50 border border-sidebar-border">
            {/* Step Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {statusIcon[step.status]}
                    <span className="font-mono text-sm font-medium">{step.stepName}</span>
                </div>
                {step.output !== undefined && step.output !== null && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                        {outputIcon[outputType]}
                        {outputType.toUpperCase()}
                    </Badge>
                )}
            </div>

            {/* Error */}
            {step.error && (
                <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 font-mono">
                    {step.error}
                </div>
            )}

            {/* Output Preview */}
            {step.output !== undefined && step.output !== null && step.status === "success" && (
                <div className="mt-2">
                    {/* Image Output */}
                    {outputType === "image" && mediaUrl && (
                        <div className="relative group">
                            <img
                                src={mediaUrl}
                                alt={`Output from ${step.stepName}`}
                                className="rounded-md max-w-full max-h-64 object-contain border border-sidebar-border"
                            />
                            <Button
                                size="sm"
                                variant="ghost"
                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
                                onClick={() => window.open(mediaUrl, "_blank")}
                            >
                                <Download className="w-3 h-3" />
                            </Button>
                        </div>
                    )}

                    {/* Audio Output */}
                    {outputType === "audio" && mediaUrl && (
                        <audio controls className="w-full h-10">
                            <source src={mediaUrl} />
                        </audio>
                    )}

                    {/* Video Output */}
                    {outputType === "video" && mediaUrl && (
                        <video controls className="rounded-md max-w-full max-h-64">
                            <source src={mediaUrl} />
                        </video>
                    )}

                    {/* Text Output */}
                    {outputType === "text" && typeof step.output === "string" && (
                        <div className="relative group">
                            <pre className="text-xs font-mono bg-black/30 rounded px-2 py-1.5 overflow-auto max-h-32 whitespace-pre-wrap">
                                {step.output}
                            </pre>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                                onClick={() => navigator.clipboard.writeText(step.output as string)}
                            >
                                <Copy className="w-3 h-3" />
                            </Button>
                        </div>
                    )}

                    {/* JSON Output */}
                    {outputType === "json" && (
                        <div className="relative group">
                            <pre className="text-xs font-mono bg-black/30 rounded px-2 py-1.5 overflow-auto max-h-32">
                                {JSON.stringify(step.output, null, 2)}
                            </pre>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                                onClick={() => navigator.clipboard.writeText(JSON.stringify(step.output, null, 2))}
                            >
                                <Copy className="w-3 h-3" />
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

// =============================================================================
// Main Output Panel
// =============================================================================

export const WorkflowOutputPanel = memo(function WorkflowOutputPanel({
    open,
    onOpenChange,
    result,
    workflowName = "Workflow",
}: WorkflowOutputPanelProps) {
    if (!result) return null;

    const successCount = result.steps.filter(s => s.status === "success").length;
    const errorCount = result.steps.filter(s => s.status === "error").length;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                className="bg-card border-sidebar-border w-full sm:max-w-lg"
                side="right"
            >
                <SheetHeader className="pb-4">
                    <SheetTitle className="font-display text-lg text-fuchsia-400 flex items-center gap-2">
                        <Layers className="w-5 h-5" />
                        Execution Results
                    </SheetTitle>
                    <SheetDescription className="text-sm">
                        {workflowName}
                    </SheetDescription>
                </SheetHeader>

                {/* Summary Bar */}
                <div className="flex items-center gap-3 py-3 px-3 rounded-md bg-sidebar-accent/50 border border-sidebar-border mb-4">
                    <Badge
                        variant="outline"
                        className={cn(
                            "font-mono",
                            result.success
                                ? "border-green-500/50 text-green-400"
                                : "border-red-500/50 text-red-400"
                        )}
                    >
                        {result.success ? "SUCCESS" : "FAILED"}
                    </Badge>

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        <span>{successCount}</span>
                    </div>

                    {errorCount > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <XCircle className="w-3 h-3 text-red-500" />
                            <span>{errorCount}</span>
                        </div>
                    )}

                    <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                        <DollarSign className="w-3 h-3" />
                        <span className="font-mono">{formatCost(result.totalCostWei)}</span>
                    </div>
                </div>

                {/* Error Message */}
                {result.error && (
                    <div className="mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                        {result.error}
                    </div>
                )}

                <Separator className="mb-4" />

                {/* Multimodal Output - The Final Result */}
                {result.output?.multimodal && (
                    <div className="mb-4 p-4 rounded-md bg-gradient-to-b from-fuchsia-500/10 to-transparent border border-fuchsia-500/30">
                        <div className="flex items-center gap-2 mb-3">
                            {result.output.multimodal.outputType === "image" && <ImageIcon className="w-4 h-4 text-fuchsia-400" />}
                            {result.output.multimodal.outputType === "audio" && <Music className="w-4 h-4 text-fuchsia-400" />}
                            {result.output.multimodal.outputType === "video" && <Video className="w-4 h-4 text-fuchsia-400" />}
                            <span className="font-mono text-sm font-medium text-fuchsia-400">Final Output</span>
                            {result.output.multimodal.fromAgent && (
                                <span className="text-xs text-muted-foreground">from {result.output.multimodal.fromAgent}</span>
                            )}
                        </div>

                        {/* Image Output */}
                        {result.output.multimodal.outputType === "image" && (
                            <div className="relative group">
                                <img
                                    src={result.output.multimodal.output.startsWith("data:")
                                        ? result.output.multimodal.output
                                        : `data:image/png;base64,${result.output.multimodal.output}`}
                                    alt="Generated output"
                                    className="rounded-md max-w-full max-h-80 object-contain border border-sidebar-border"
                                />
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
                                    onClick={() => {
                                        const src = result.output.multimodal!.output.startsWith("data:")
                                            ? result.output.multimodal!.output
                                            : `data:image/png;base64,${result.output.multimodal!.output}`;
                                        window.open(src, "_blank");
                                    }}
                                >
                                    <Download className="w-3 h-3" />
                                </Button>
                            </div>
                        )}

                        {/* Audio Output */}
                        {result.output.multimodal.outputType === "audio" && (
                            <audio controls className="w-full">
                                <source src={result.output.multimodal.output.startsWith("data:")
                                    ? result.output.multimodal.output
                                    : `data:audio/wav;base64,${result.output.multimodal.output}`} />
                            </audio>
                        )}

                        {/* Video Output */}
                        {result.output.multimodal.outputType === "video" && (
                            <video controls className="rounded-md max-w-full max-h-80">
                                <source src={result.output.multimodal.output.startsWith("data:")
                                    ? result.output.multimodal.output
                                    : `data:video/mp4;base64,${result.output.multimodal.output}`} />
                            </video>
                        )}
                    </div>
                )}

                {/* Step Results */}
                <ScrollArea className="h-[calc(100vh-280px)]">
                    <div className="space-y-3 pr-4">
                        {result.steps.map((step) => (
                            <StepResultItem key={step.stepId} step={step} />
                        ))}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
});

export default WorkflowOutputPanel;
