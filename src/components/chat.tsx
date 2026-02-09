/**
 * Unified Chat Component
 * 
 * Consolidates:
 * - MultimodalCanvas (chat container with input, attachments, recording)
 * - ChatMessageItem (message bubbles with actions)
 * - MarkdownRenderer (rich content with Mermaid, LaTeX, code)
 * 
 * Used by: agent.tsx, manowar.tsx, playground.tsx
 */
import React, { useState, useEffect, memo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Bot,
    User,
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
    Copy,
    Check,
    RefreshCw,
    ExternalLink,
    ChevronDown,
    ChevronUp,
    Image as ImageIcon,
    Wrench,
    Terminal,
} from "lucide-react";
import mermaid from "mermaid";
import "katex/dist/katex.min.css";
import { GenerationCanvas } from "@/components/blur";
import { LyriaAudioPlayer } from "@/components/lyria-player";
import { useLyriaWebSocket } from "@/hooks/use-lyria";

// Initialize Mermaid with dark theme
mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
        primaryColor: "#06b6d4",
        primaryTextColor: "#fff",
        primaryBorderColor: "#0891b2",
        lineColor: "#64748b",
        secondaryColor: "#6366f1",
        tertiaryColor: "#1e1e1e",
        background: "#1e1e1e",
        mainBkg: "#1e1e1e",
        nodeBorder: "#0891b2",
    },
});

// =============================================================================
// Types - Import from single source of truth
// =============================================================================

import { type ChatMessage, type AttachedFile } from "@/lib/api";

// Re-export for convenience
export type { ChatMessage, AttachedFile };

// =============================================================================
// Tag Parsing (Think & Invoke)
// =============================================================================

type BlockType = 'text' | 'think' | 'invoke';

interface ContentBlock {
    type: BlockType;
    content: string;
    toolName?: string;
    params?: Record<string, any>;
}

function parseBlocks(raw: string): ContentBlock[] {
    if (!raw) return [];

    const blocks: ContentBlock[] = [];
    // Regex matches <think>...</think> OR <invoke>...</invoke>
    // Capture groups: 1=think content, 2=invoke content
    const regex = /(?:<think>([\s\S]*?)<\/think>)|(?:<invoke>([\s\S]*?)<\/invoke>)/gi;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(raw)) !== null) {
        // Add preceding text if any
        if (match.index > lastIndex) {
            const text = raw.substring(lastIndex, match.index).trim();
            if (text) blocks.push({ type: 'text', content: text });
        }

        if (match[1]) { // <think>
            blocks.push({ type: 'think', content: match[1].trim() });
        } else if (match[2]) { // <invoke>
            const invokeContent = match[2].trim();
            const lines = invokeContent.split('\n');
            const toolName = lines[0]?.trim() || "Unknown Tool";

            // Extract params
            const params: Record<string, any> = {};
            // Simple XML-like param extraction: <key>value</key>
            const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/gi;
            let paramMatch;
            while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
                try {
                    // Try parsing as JSON first (for complex objects)
                    params[paramMatch[1]] = JSON.parse(paramMatch[2]);
                } catch {
                    // Fallback to string
                    params[paramMatch[1]] = paramMatch[2].trim();
                }
            }

            blocks.push({
                type: 'invoke',
                content: invokeContent,
                toolName,
                params
            });
        }

        lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < raw.length) {
        const text = raw.substring(lastIndex).trim();
        if (text) blocks.push({ type: 'text', content: text });
    }

    return blocks;
}

// =============================================================================
// Block Components
// =============================================================================

function ThinkBlock({ content }: { content: string }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="mb-3 border border-zinc-700/50 rounded-lg overflow-hidden bg-zinc-900/50">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
                title="Toggle Chain of Thought"
            >
                <span className="flex items-center gap-2 font-medium">
                    <span className="text-cyan-500">💭</span>
                    Chain of Thought
                </span>
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {isOpen && (
                <div className="px-3 py-2 border-t border-zinc-700/50 text-xs text-zinc-500 italic whitespace-pre-wrap leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
                    {content}
                </div>
            )}
        </div>
    );
}

function InvokeBlock({ toolName, params }: { toolName: string; params?: Record<string, any> }) {
    const [isOpen, setIsOpen] = useState(false);

    // Clean tool name (remove Mcp: prefix for display)
    const displayName = toolName.replace(/^Mcp:/i, '');

    return (
        <div className="mb-3 border border-fuchsia-500/20 rounded-lg overflow-hidden bg-fuchsia-500/5">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-fuchsia-300 hover:text-fuchsia-200 hover:bg-fuchsia-500/10 transition-colors"
                title="Toggle Tool Usage"
            >
                <span className="flex items-center gap-2 font-medium">
                    <Wrench className="w-3.5 h-3.5" />
                    Used <span className="font-mono bg-fuchsia-500/20 px-1 py-0.5 rounded text-[10px]">{displayName}</span>
                </span>
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {isOpen && params && Object.keys(params).length > 0 && (
                <div className="px-3 py-2 border-t border-fuchsia-500/20 bg-black/20 text-xs font-mono text-zinc-400 overflow-x-auto animate-in fade-in slide-in-from-top-1 duration-200">
                    {Object.entries(params).map(([key, value]) => (
                        <div key={key} className="mb-1 last:mb-0">
                            <span className="text-fuchsia-500/70">{key}:</span>{' '}
                            <span className="text-zinc-300 whitespace-pre-wrap">
                                {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function EmbeddingBlock({ content }: { content: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    // Parse embedding content - try to prettify it
    let formattedContent = content;
    let dimensions = 0;
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            // Handle nested arrays (multiple embeddings)
            if (Array.isArray(parsed[0])) {
                dimensions = parsed[0].length;
                formattedContent = parsed.map((emb: number[], idx: number) =>
                    `[${idx}]:\n  ` + emb.map((v, i) => `[${i}]: ${v.toFixed(8)}`).join('\n  ')
                ).join('\n\n');
            } else {
                // Single embedding array
                dimensions = parsed.length;
                formattedContent = parsed.map((v: number, i: number) => `[${i}]: ${v.toFixed(8)}`).join('\n');
            }
        }
    } catch {
        // Keep original content if not valid JSON
    }

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-500/5">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                title="Toggle Embedding Vector"
            >
                <span className="flex items-center gap-2 font-medium">
                    <span className="text-emerald-500">📊</span>
                    Embedding Vector {dimensions > 0 && <span className="text-emerald-600">({dimensions} dimensions)</span>}
                </span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                        className="p-1 rounded hover:bg-emerald-500/20 transition-colors"
                        title="Copy raw embedding"
                    >
                        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
            </button>
            {isOpen && (
                <div className="px-3 py-2 border-t border-emerald-500/20 bg-black/30 animate-in fade-in slide-in-from-top-1 duration-200">
                    <pre className="text-xs font-mono text-emerald-300/80 overflow-auto max-h-80 whitespace-pre leading-relaxed">
                        {formattedContent}
                    </pre>
                </div>
            )}
        </div>
    );
}

// =============================================================================
// Mermaid Diagram
// =============================================================================

function MermaidDiagram({ code }: { code: string }) {
    const [svg, setSvg] = useState<string>("");
    const [error, setError] = useState<string>("");

    useEffect(() => {
        const renderDiagram = async () => {
            try {
                const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const { svg } = await mermaid.render(id, code);
                setSvg(svg);
                setError("");
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to render diagram");
            }
        };
        renderDiagram();
    }, [code]);

    if (error) {
        return (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 my-3">
                <p className="text-red-400 text-sm">Diagram error: {error}</p>
                <pre className="text-xs text-zinc-500 mt-2 overflow-auto">{code}</pre>
            </div>
        );
    }

    return (
        <div
            className="my-3 p-4 bg-zinc-900 rounded-lg overflow-auto flex justify-center"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

// =============================================================================
// Media Embedding
// =============================================================================

function MediaEmbed({ url }: { url: string }) {
    // YouTube
    const youtubeMatch = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    );
    if (youtubeMatch) {
        return (
            <div className="my-3 aspect-video rounded-lg overflow-hidden">
                <iframe
                    src={`https://www.youtube.com/embed/${youtubeMatch[1]}`}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />
            </div>
        );
    }

    // Vimeo
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
        return (
            <div className="my-3 aspect-video rounded-lg overflow-hidden">
                <iframe
                    src={`https://player.vimeo.com/video/${vimeoMatch[1]}`}
                    className="w-full h-full"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                />
            </div>
        );
    }

    // Direct video files
    if (/\.(mp4|webm|ogg)$/i.test(url)) {
        return (
            <video controls className="my-3 w-full rounded-lg">
                <source src={url} />
            </video>
        );
    }

    // Audio files
    if (/\.(mp3|wav|ogg|m4a)$/i.test(url)) {
        return (
            <audio controls className="my-3 w-full">
                <source src={url} />
            </audio>
        );
    }

    return null;
}

// =============================================================================
// Link Preview
// =============================================================================

function LinkPreview({ url, children }: { url: string; children: React.ReactNode }) {
    const media = MediaEmbed({ url });
    if (media) return media;

    return (
        <span className="inline">
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 inline-flex items-center gap-1"
            >
                {children}
                <ExternalLink className="w-3 h-3 inline" />
            </a>
        </span>
    );
}

// =============================================================================
// Code Block
// =============================================================================

function CodeBlock({
    inline,
    className,
    children,
    ...props
}: {
    inline?: boolean;
    className?: string;
    children?: React.ReactNode;
}) {
    const [copied, setCopied] = useState(false);
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const codeString = String(children).replace(/\n$/, "");

    const handleCopy = async () => {
        await navigator.clipboard.writeText(codeString);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (inline) {
        return (
            <code className="bg-zinc-800 text-cyan-300 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                {children}
            </code>
        );
    }

    if (language === "mermaid") {
        return <MermaidDiagram code={codeString} />;
    }

    return (
        <div className="relative group my-3">
            <div className="absolute right-2 top-2 flex items-center gap-2 z-10">
                {language && <span className="text-xs text-zinc-500 font-mono uppercase">{language}</span>}
                <button
                    onClick={handleCopy}
                    className="p-1.5 rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                    title="Copy code"
                >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
            </div>

            <SyntaxHighlighter
                style={oneDark}
                language={language || "text"}
                PreTag="div"
                customStyle={{
                    margin: 0,
                    borderRadius: "0.5rem",
                    padding: "1rem",
                    fontSize: "0.875rem",
                    background: "rgb(30 30 30)",
                }}
                {...props}
            >
                {codeString}
            </SyntaxHighlighter>
        </div>
    );
}

// =============================================================================
// Markdown Renderer
// =============================================================================

interface RendererProps {
    content: string;
    className?: string;
}

function MarkdownRendererInner({ content, className }: RendererProps) {
    if (!content) {
        return <span className="text-zinc-500">...</span>;
    }

    const blocks = parseBlocks(content);

    return (
        <div className={cn("renderer-content text-sm", className)}>
            {blocks.map((block, index) => (
                <React.Fragment key={index}>
                    {block.type === 'think' && <ThinkBlock content={block.content} />}

                    {block.type === 'invoke' && block.toolName && (
                        <InvokeBlock toolName={block.toolName} params={block.params} />
                    )}

                    {block.type === 'text' && (
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                code: CodeBlock as any,
                                h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 text-white">{children}</h1>,
                                h2: ({ children }) => <h2 className="text-lg font-semibold mt-3 mb-2 text-white">{children}</h2>,
                                h3: ({ children }) => <h3 className="text-base font-semibold mt-2 mb-1 text-white">{children}</h3>,
                                p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                                ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1 pl-2">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1 pl-2">{children}</ol>,
                                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                a: ({ href, children }) => href ? <LinkPreview url={href}>{children}</LinkPreview> : <span>{children}</span>,
                                img: ({ src, alt }) => <img src={src} alt={alt || "Image"} className="max-w-full rounded-lg my-2" loading="lazy" />,
                                table: ({ children }) => (
                                    <div className="overflow-x-auto my-3">
                                        <table className="w-full border-collapse border border-zinc-700 text-sm">{children}</table>
                                    </div>
                                ),
                                thead: ({ children }) => <thead className="bg-zinc-800">{children}</thead>,
                                th: ({ children }) => <th className="border border-zinc-700 px-3 py-2 text-left font-semibold text-white">{children}</th>,
                                td: ({ children }) => <td className="border border-zinc-700 px-3 py-2">{children}</td>,
                                tr: ({ children }) => <tr className="even:bg-zinc-800/50">{children}</tr>,
                                blockquote: ({ children }) => <blockquote className="border-l-4 border-cyan-500 pl-4 my-2 italic text-zinc-400">{children}</blockquote>,
                                hr: () => <hr className="border-zinc-700 my-4" />,
                                strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                                em: ({ children }) => <em className="italic">{children}</em>,
                                del: ({ children }) => <del className="line-through text-zinc-500">{children}</del>,
                            }}
                        >
                            {block.content}
                        </ReactMarkdown>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);

// =============================================================================
// Chat Message Item
// =============================================================================

export interface ChatMessageItemProps {
    message: ChatMessage;
    variant?: "agent" | "manowar" | "playground";
    showActions?: boolean;
    onCopy?: (content: string) => void;
    onRetry?: (content: string) => void;
    onDelete?: (id: string) => void;
    assistantAvatar?: React.ReactNode;
}

const messageVariantStyles = {
    agent: {
        user: "bg-fuchsia-500/20 text-fuchsia-100",
        userAvatar: "bg-fuchsia-500/20 text-fuchsia-400",
        assistant: "bg-sidebar-accent text-foreground",
        assistantAvatar: "bg-cyan-500/20 text-cyan-400",
    },
    manowar: {
        user: "bg-cyan-500/20 text-cyan-100",
        userAvatar: "bg-cyan-500/20 text-cyan-400",
        assistant: "bg-sidebar-accent text-foreground font-mono text-sm",
        assistantAvatar: "bg-fuchsia-500/20 text-fuchsia-400",
    },
    playground: {
        user: "bg-cyan-600 text-white",
        userAvatar: "bg-zinc-700 text-zinc-300",
        assistant: "bg-zinc-800 text-zinc-100",
        assistantAvatar: "bg-cyan-500/20 text-cyan-400",
    },
};

function ChatMessageItemInner({
    message,
    variant = "agent",
    showActions = true,
    onCopy,
    onRetry,
    onDelete,
    assistantAvatar,
}: ChatMessageItemProps) {
    const styles = messageVariantStyles[variant];
    const isUser = message.role === "user";
    const isLoading = !message.content && message.role === "assistant";

    const getAssistantIcon = () => {
        if (assistantAvatar) return assistantAvatar;
        switch (message.type) {
            case "image": return <ImageIcon className="h-4 w-4" />;
            case "audio": return <Music className="h-4 w-4" />;
            case "video": return <Video className="h-4 w-4" />;
            default: return <Bot className="h-4 w-4" />;
        }
    };

    return (
        <div className={cn("flex gap-3", isUser && "justify-end")}>
            {!isUser && (
                <Avatar className="w-8 h-8 shrink-0">
                    <AvatarFallback className={styles.assistantAvatar}>{getAssistantIcon()}</AvatarFallback>
                </Avatar>
            )}

            <div className={cn("max-w-[80%] p-3 rounded-lg relative group", isUser ? styles.user : styles.assistant)}>
                {showActions && (
                    <div className="absolute -top-8 right-0 hidden group-hover:flex items-center gap-1 bg-card/90 backdrop-blur-sm border border-sidebar-border rounded-md p-1 shadow-lg z-10">
                        {onCopy && (
                            <button
                                onClick={() => onCopy(message.content)}
                                className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
                                title="Copy message"
                            >
                                <Copy className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {isUser && onRetry && (
                            <button
                                onClick={() => onRetry(message.content)}
                                className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
                                title="Retry this message"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {onDelete && (
                            <button
                                onClick={() => onDelete(message.id)}
                                className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                                title="Delete message"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                )}

                {message.imageUrl && <img src={message.imageUrl} alt="Generated" className="rounded-lg max-w-full mb-2" />}
                {message.audioUrl && <audio controls className="w-full mb-2"><source src={message.audioUrl} /></audio>}
                {message.videoUrl && <video controls className="rounded-lg max-w-full mb-2"><source src={message.videoUrl} /></video>}

                {message.type === "embedding" ? (
                    <EmbeddingBlock content={message.content || "..."} />
                ) : isLoading ? (
                    // Show GenerationCanvas for media types, spinner for text
                    message.type === "image" || message.type === "audio" || message.type === "video" ? (
                        <GenerationCanvas
                            type={message.type}
                            status={message.content || undefined}
                        />
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-zinc-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Thinking...</span>
                        </div>
                    )
                ) : isUser ? (
                    <p className="whitespace-pre-wrap text-sm">{message.content || "..."}</p>
                ) : (
                    <MarkdownRenderer content={message.content || "..."} />
                )}
            </div>

            {isUser && (
                <Avatar className="w-8 h-8 shrink-0">
                    <AvatarFallback className={styles.userAvatar}><User className="w-4 h-4" /></AvatarFallback>
                </Avatar>
            )}
        </div>
    );
}

export const ChatMessageItem = memo(ChatMessageItemInner);

// =============================================================================
// Multimodal Canvas
// =============================================================================

export interface MultimodalCanvasProps {
    messages: ChatMessage[];
    inputValue: string;
    onInputChange: (value: string) => void;
    onSend: () => void;
    sending: boolean;
    variant?: "agent" | "manowar" | "playground";
    title?: string;
    icon?: React.ReactNode;
    emptyStateText?: string;
    emptyStateSubtext?: string;
    emptyStateIcon?: React.ReactNode;
    showHeader?: boolean;
    placeholder?: string;
    status?: "idle" | "paying" | "waiting" | "streaming";
    error?: string | null;
    sessionActive?: boolean;
    onStartSession?: () => void;
    attachedFiles?: AttachedFile[];
    onFileSelect?: () => void;
    onRemoveFile?: (file: File) => void;
    fileInputRef?: React.RefObject<HTMLInputElement | null>;
    onFileInputChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isRecording?: boolean;
    recordingSupported?: boolean;
    onStartRecording?: () => void;
    onStopRecording?: () => void;
    showMessageActions?: boolean;
    onCopyMessage?: (content: string) => void;
    onRetryMessage?: (content: string) => void;
    onDeleteMessage?: (id: string) => void;
    onClearChat?: () => void;
    onKnowledgeUpload?: () => void;
    scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
    messagesEndRef?: React.RefObject<HTMLDivElement | null>;
    height?: string;
    /** Selected model ID for Lyria detection */
    selectedModel?: string;
    /** Set messages for Lyria integration */
    setMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

const canvasVariantConfig = {
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
    selectedModel,
    setMessages,
}: MultimodalCanvasProps) {
    const config = canvasVariantConfig[variant];

    // ==========================================================================
    // Lyria RealTime Integration
    // ==========================================================================
    const isLyriaModel = selectedModel?.toLowerCase().includes("lyria");
    const lyria = useLyriaWebSocket();
    const [lyriaMessageId, setLyriaMessageId] = useState<string | null>(null);

    // Handle Lyria send - intercepts regular onSend for Lyria models
    const handleSend = useCallback(() => {
        if (isLyriaModel && setMessages) {
            // Create user message
            const userMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: "user",
                content: inputValue.trim(),
                timestamp: Date.now(),
                type: "text",
            };
            setMessages((prev) => [...prev, userMessage]);

            // Create assistant placeholder
            const assistantId = crypto.randomUUID();
            setLyriaMessageId(assistantId);
            setMessages((prev) => [
                ...prev,
                {
                    id: assistantId,
                    role: "assistant",
                    content: "🎵 Lyria RealTime Music Generation\n\nClick Play to start generating music...",
                    timestamp: Date.now(),
                    type: "audio",
                },
            ]);

            // Connect and configure Lyria
            if (lyria.state === "idle" || lyria.state === "closed" || lyria.state === "error") {
                lyria.connect();
            }
            lyria.setPrompt(inputValue.trim() || "ambient electronic music");

            // Clear input
            onInputChange("");
        } else {
            // Regular send for non-Lyria models
            onSend();
        }
    }, [isLyriaModel, setMessages, inputValue, onSend, onInputChange, lyria]);

    // Update Lyria message status based on connection state
    useEffect(() => {
        if (!isLyriaModel || !lyriaMessageId || !setMessages) return;

        let statusMessage = "";
        switch (lyria.state) {
            case "connecting":
                statusMessage = "🎵 Connecting to Lyria RealTime...";
                break;
            case "connected":
                statusMessage = "🎵 Connected! Waiting for session ready...";
                break;
            case "ready":
                statusMessage = `🎵 Lyria RealTime Ready\n\nPrompt: "${inputValue}"\n\nClick Play to start generating music`;
                break;
            case "playing":
                statusMessage = `🎵 Generating music...\n\n${lyria.audioQueue.length} audio chunks received`;
                break;
            case "paused":
                statusMessage = "🎵 Music generation paused";
                break;
            case "error":
                statusMessage = `🎵 Error: ${lyria.error || "Unknown error"}`;
                break;
            case "closed":
                statusMessage = "🎵 Lyria session closed";
                break;
        }

        if (statusMessage) {
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === lyriaMessageId ? { ...m, content: statusMessage } : m
                )
            );
        }
    }, [lyria.state, lyria.audioQueue.length, lyria.error, isLyriaModel, lyriaMessageId, setMessages, inputValue]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    const canSend = !sending && (inputValue.trim() || attachedFiles.length > 0);
    const isUploading = attachedFiles.some(f => f.uploading);

    return (
        <div className={cn(
            "border rounded-lg bg-background/50 overflow-hidden flex flex-col",
            config.border,
            variant === "manowar" && "shadow-[0_0_30px_-5px_hsl(292_85%_55%/0.1)]",
            !showHeader && "border-0 rounded-none bg-transparent",
            height
        )}>
            {showHeader && (
                <div className={cn("p-3 border-b border-sidebar-border flex items-center shrink-0", config.headerBg)}>
                    <div className="flex items-center gap-2">
                        {icon || config.headerIcon}
                        <span className={cn("text-sm font-mono", config.headerText)}>{title || "Chat"}</span>
                    </div>
                </div>
            )}

            <div ref={scrollContainerRef} className="flex-1 min-h-0 p-4 overflow-y-auto">
                {messages.length === 0 ? (
                    <div className="text-center text-muted-foreground text-sm py-8">
                        {emptyStateIcon || (variant === "manowar" ? (
                            <Play className={cn("w-12 h-12 mx-auto mb-4 opacity-50", config.headerText)} />
                        ) : (
                            <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        ))}
                        <p>{emptyStateText}</p>
                        {emptyStateSubtext && <p className="text-xs mt-1 text-muted-foreground/70">{emptyStateSubtext}</p>}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {messages.map((msg) => (
                            <React.Fragment key={msg.id}>
                                <ChatMessageItem
                                    message={msg}
                                    variant={variant}
                                    showActions={showMessageActions}
                                    onCopy={onCopyMessage}
                                    onRetry={onRetryMessage}
                                    onDelete={onDeleteMessage}
                                />
                                {/* Lyria Audio Player for Lyria messages */}
                                {isLyriaModel && msg.id === lyriaMessageId && (
                                    <LyriaAudioPlayer
                                        audioQueue={lyria.audioQueue}
                                        isPlaying={lyria.state === "playing"}
                                        onPlay={lyria.play}
                                        onPause={lyria.pause}
                                        onStop={() => {
                                            lyria.stop();
                                            if (setMessages) {
                                                setMessages((prev) =>
                                                    prev.map((m) =>
                                                        m.id === lyriaMessageId
                                                            ? { ...m, content: "🎵 Music generation stopped" }
                                                            : m
                                                    )
                                                );
                                            }
                                        }}
                                        onClearQueue={lyria.clearAudioQueue}
                                        config={lyria.currentConfig}
                                    />
                                )}
                            </React.Fragment>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {status !== "idle" && (
                <div className="shrink-0 px-3 py-2 border-t border-dashed border-sidebar-border bg-sidebar-accent/30 flex items-center gap-2 text-xs font-mono">
                    <Loader2 className={cn("w-3 h-3 animate-spin", config.headerText)} />
                    <span className="text-muted-foreground">
                        {status === "paying" && <><span className="text-yellow-400">Paying...</span> Processing x402 payment</>}
                        {status === "waiting" && <><span className="text-orange-400">Waiting...</span> Awaiting response</>}
                        {status === "streaming" && <><span className={config.headerText}>Streaming...</span> Receiving response</>}
                    </span>
                </div>
            )}

            <div className="shrink-0 p-3 border-t border-sidebar-border">
                {error && <div className="text-xs text-red-400 mb-2 p-2 bg-red-500/10 rounded">{error}</div>}

                {attachedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {attachedFiles.map((file, index) => (
                            <div key={file.file.name + index} className="relative group">
                                <div className="h-12 w-12 rounded-md overflow-hidden bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                                    {file.type === "image" ? (
                                        <img src={file.preview} alt="Preview" className="h-full w-full object-cover" />
                                    ) : file.type === "video" ? (
                                        file.preview ? <video src={file.preview} className="h-full w-full object-cover" muted /> : <Video className="h-6 w-6 text-pink-500" />
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
                    {onClearChat && (
                        <Button variant="ghost" size="icon" onClick={onClearChat} disabled={sending} className="text-zinc-400 hover:text-white shrink-0" title="Clear chat">
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    )}

                    {onFileSelect && (
                        <Button variant="ghost" size="icon" onClick={onFileSelect} disabled={sending || isRecording} className={cn("text-zinc-400 shrink-0 cursor-pointer", `hover:text-${config.accentColor}-400`)} title="Attach file">
                            <Paperclip className="w-4 h-4" />
                        </Button>
                    )}

                    {onStartRecording && onStopRecording && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={isRecording ? onStopRecording : onStartRecording}
                            disabled={sending || !recordingSupported}
                            className={cn("shrink-0 transition-colors cursor-pointer", isRecording ? "text-red-500 hover:text-red-400 animate-pulse" : cn("text-zinc-400", `hover:text-${config.accentColor}-400`))}
                            title={isRecording ? "Stop recording" : "Record audio"}
                        >
                            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        </Button>
                    )}

                    {onKnowledgeUpload && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={onKnowledgeUpload} disabled={sending} className={cn("shrink-0 cursor-pointer text-zinc-400", `hover:text-${config.accentColor}-400`)}>
                                        <BookOpen className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Upload Knowledge</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}

                    <Textarea
                        placeholder={placeholder || (variant === "manowar" ? "Enter workflow parameters or instruction..." : "Type your message...")}
                        value={inputValue}
                        onChange={(e) => onInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        className={cn("resize-none flex-1", variant === "manowar" && "font-mono text-sm")}
                        disabled={sending}
                    />

                    <Button onClick={handleSend} disabled={!canSend || isUploading} className={config.sendButton}>
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : variant === "manowar" ? <Play className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                    </Button>
                </div>

                {fileInputRef && onFileInputChange && (
                    <input type="file" ref={fileInputRef} onChange={onFileInputChange} accept="image/*,audio/*,video/*" className="hidden" />
                )}
            </div>
        </div>
    );
}
