/**
 * Multimodal Canvas Component
 * 
 * A fully self-contained chat interface with support for:
 * - Text, image, audio, video input/output
 * - File attachments with upload progress
 * - Audio recording
 * - Status indicators (paying, waiting, streaming)
 * - Per-message actions
 * - Session budget display
 * 
 * Used by: agent.tsx, manowar.tsx, playground.tsx
 */
import React, { useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessageItem, type ChatMessage } from "@/components/chat";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Bot,
    Loader2,
    Send,
    Play,
    Paperclip,
    Mic,
    MicOff,
    Music,
    Video,
    X,
    Layers,
    Trash2,
    BookOpen,
} from "lucide-react";

export interface AttachedFile {
    file: File;
    cid?: string;
    url?: string;
    preview?: string;
    uploading: boolean;
    type: "image" | "audio" | "video";
}

export interface MultimodalCanvasProps {
    // Core functionality
    messages: ChatMessage[];
    inputValue: string;
    onInputChange: (value: string) => void;
    onSend: () => void;
    sending: boolean;

    // Appearance
    variant?: "agent" | "manowar" | "playground";
    title?: string;
    icon?: React.ReactNode;
    emptyStateText?: string;
    emptyStateSubtext?: string;
    emptyStateIcon?: React.ReactNode;
    showHeader?: boolean;
    placeholder?: string;

    // Status
    status?: "idle" | "paying" | "waiting" | "streaming";
    error?: string | null;

    // Session
    sessionActive?: boolean;
    onStartSession?: () => void;

    // File attachments
    attachedFiles?: AttachedFile[];
    onFileSelect?: () => void;
    onRemoveFile?: (file: File) => void;
    fileInputRef?: React.RefObject<HTMLInputElement | null>;
    onFileInputChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;

    // Audio recording
    isRecording?: boolean;
    recordingSupported?: boolean;
    onStartRecording?: () => void;
    onStopRecording?: () => void;

    // Message actions
    showMessageActions?: boolean;
    onCopyMessage?: (content: string) => void;
    onRetryMessage?: (content: string) => void;
    onDeleteMessage?: (id: string) => void;
    onClearChat?: () => void;

    // Knowledge upload (agent-specific)
    onKnowledgeUpload?: () => void;

    // Scroll refs
    scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
    messagesEndRef?: React.RefObject<HTMLDivElement | null>;

    // Height control
    height?: string;
}

// Variant-specific styling
const variantConfig = {
    agent: {
        border: "border-cyan-500/30",
        headerBg: "bg-cyan-500/5",
        headerText: "text-cyan-400",
        headerIcon: <Bot className="w-4 h-4 text-cyan-400" />,
        sendButton: "bg-cyan-500 hover:bg-cyan-600 text-black",
        accentColor: "cyan",
    },
    manowar: {
        border: "border-fuchsia-500/30",
        headerBg: "bg-fuchsia-500/5",
        headerText: "text-fuchsia-400",
        headerIcon: <Layers className="w-4 h-4 text-fuchsia-400" />,
        sendButton: "bg-fuchsia-500 hover:bg-fuchsia-600 text-white",
        accentColor: "fuchsia",
    },
    playground: {
        border: "border-zinc-700",
        headerBg: "bg-zinc-900/50",
        headerText: "text-cyan-400",
        headerIcon: <Bot className="w-4 h-4 text-cyan-400" />,
        sendButton: "bg-cyan-500 hover:bg-cyan-600 text-black",
        accentColor: "cyan",
    },
};

export function MultimodalCanvas({
    messages,
    inputValue,
    onInputChange,
    onSend,
    sending,
    variant = "agent",
    title,
    icon,
    emptyStateText = "Start a conversation",
    emptyStateSubtext,
    emptyStateIcon,
    showHeader = true,
    placeholder,
    status = "idle",
    error,
    sessionActive = false,
    onStartSession,
    attachedFiles = [],
    onFileSelect,
    onRemoveFile,
    fileInputRef,
    onFileInputChange,
    isRecording = false,
    recordingSupported = true,
    onStartRecording,
    onStopRecording,
    showMessageActions = true,
    onCopyMessage,
    onRetryMessage,
    onDeleteMessage,
    onClearChat,
    onKnowledgeUpload,
    scrollContainerRef,
    messagesEndRef,
    height = "h-64",
}: MultimodalCanvasProps) {
    const config = variantConfig[variant];

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
        }
    }, [onSend]);

    const canSend = !sending && (inputValue.trim() || attachedFiles.length > 0);
    const isUploading = attachedFiles.some(f => f.uploading);

    return (
        <div className={cn(
            "border rounded-lg bg-background/50 overflow-hidden flex flex-col",
            config.border,
            variant === "manowar" && "shadow-[0_0_30px_-5px_hsl(292_85%_55%/0.1)]",
            !showHeader && "border-0 rounded-none bg-transparent",
            height // Apply height to outer container for flex layouts
        )}>
            {/* Header - optional */}
            {showHeader && (
                <div className={cn(
                    "p-3 border-b border-sidebar-border flex items-center shrink-0",
                    config.headerBg
                )}>
                    <div className="flex items-center gap-2">
                        {icon || config.headerIcon}
                        <span className={cn("text-sm font-mono", config.headerText)}>
                            {title || "Chat"}
                        </span>
                    </div>
                </div>
            )}

            {/* Messages - flex-1 to fill available space, min-h-0 to allow shrinking */}
            <div
                ref={scrollContainerRef}
                className="flex-1 min-h-0 p-4 overflow-y-auto"
            >
                {messages.length === 0 ? (
                    <div className="text-center text-muted-foreground text-sm py-8">
                        {emptyStateIcon || (variant === "manowar" ? (
                            <Play className={cn("w-12 h-12 mx-auto mb-4 opacity-50", config.headerText)} />
                        ) : (
                            <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        ))}
                        <p>{emptyStateText}</p>
                        {emptyStateSubtext && (
                            <p className="text-xs mt-1 text-muted-foreground/70">{emptyStateSubtext}</p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {messages.map((msg) => (
                            <ChatMessageItem
                                key={msg.id}
                                message={msg}
                                variant={variant}
                                showActions={showMessageActions}
                                onCopy={onCopyMessage}
                                onRetry={onRetryMessage}
                                onDelete={onDeleteMessage}
                            />
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Status Line */}
            {status !== "idle" && (
                <div className="shrink-0 px-3 py-2 border-t border-dashed border-sidebar-border bg-sidebar-accent/30 flex items-center gap-2 text-xs font-mono">
                    <Loader2 className={cn("w-3 h-3 animate-spin", config.headerText)} />
                    <span className="text-muted-foreground">
                        {status === "paying" && (
                            <><span className="text-yellow-400">Paying...</span> Processing x402 payment</>
                        )}
                        {status === "waiting" && (
                            <><span className="text-orange-400">Waiting...</span> Awaiting response</>
                        )}
                        {status === "streaming" && (
                            <><span className={config.headerText}>Streaming...</span> Receiving response</>
                        )}
                    </span>
                </div>
            )}

            {/* Input */}
            <div className="shrink-0 p-3 border-t border-sidebar-border">
                {error && (
                    <div className="text-xs text-red-400 mb-2 p-2 bg-red-500/10 rounded">
                        {error}
                    </div>
                )}

                {/* Attachment Preview */}
                {attachedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {attachedFiles.map((file, index) => (
                            <div key={file.file.name + index} className="relative group">
                                <div className="h-12 w-12 rounded-md overflow-hidden bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                                    {file.type === "image" ? (
                                        <img
                                            src={file.preview}
                                            alt="Preview"
                                            className="h-full w-full object-cover"
                                        />
                                    ) : file.type === "video" ? (
                                        file.preview ? (
                                            <video
                                                src={file.preview}
                                                className="h-full w-full object-cover"
                                                muted
                                            />
                                        ) : (
                                            <Video className="h-6 w-6 text-pink-500" />
                                        )
                                    ) : (
                                        <Music className="h-6 w-6 text-zinc-500" />
                                    )}
                                    {file.uploading && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                                        </div>
                                    )}
                                </div>
                                {onRemoveFile && (
                                    <button
                                        onClick={() => onRemoveFile(file.file)}
                                        className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-2">
                    {/* Clear chat button */}
                    {onClearChat && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClearChat}
                            disabled={sending}
                            className="text-zinc-400 hover:text-white shrink-0"
                            title="Clear chat"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    )}

                    {/* Paperclip attachment */}
                    {onFileSelect && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onFileSelect}
                            disabled={sending || isRecording}
                            className={cn(
                                "text-zinc-400 shrink-0 cursor-pointer",
                                `hover:text-${config.accentColor}-400`
                            )}
                            title="Attach file"
                        >
                            <Paperclip className="w-4 h-4" />
                        </Button>
                    )}

                    {/* Microphone */}
                    {onStartRecording && onStopRecording && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={isRecording ? onStopRecording : onStartRecording}
                            disabled={sending || !recordingSupported}
                            className={cn(
                                "shrink-0 transition-colors cursor-pointer",
                                isRecording
                                    ? "text-red-500 hover:text-red-400 animate-pulse"
                                    : cn("text-zinc-400", `hover:text-${config.accentColor}-400`)
                            )}
                            title={isRecording ? "Stop recording" : "Record audio"}
                        >
                            {isRecording ? (
                                <MicOff className="w-4 h-4" />
                            ) : (
                                <Mic className="w-4 h-4" />
                            )}
                        </Button>
                    )}

                    {/* Knowledge Upload - icon only with tooltip */}
                    {onKnowledgeUpload && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={onKnowledgeUpload}
                                        disabled={sending}
                                        className={cn(
                                            "shrink-0 cursor-pointer text-zinc-400",
                                            `hover:text-${config.accentColor}-400`
                                        )}
                                    >
                                        <BookOpen className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Upload Knowledge</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}

                    <Textarea
                        placeholder={placeholder || (variant === "manowar" ? "Enter workflow parameters or instruction..." : "Type your message...")}
                        value={inputValue}
                        onChange={(e) => onInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        className={cn(
                            "resize-none flex-1",
                            variant === "manowar" && "font-mono text-sm"
                        )}
                        disabled={sending}
                    />

                    <Button
                        onClick={onSend}
                        disabled={!canSend || isUploading}
                        className={config.sendButton}
                    >
                        {sending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : variant === "manowar" ? (
                            <Play className="w-4 h-4" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                    </Button>
                </div>

                {/* Hidden file input */}
                {fileInputRef && onFileInputChange && (
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={onFileInputChange}
                        accept="image/*,audio/*,video/*"
                        className="hidden"
                    />
                )}
            </div>
        </div>
    );
}
