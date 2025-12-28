/**
 * Manowar Workflow Page
 * 
 * Provides interactive chat/execution interface for Manowar workflows.
 * Fetches Manowar data -> Coordinator Agent -> Executes chat via Coordinator.
 * 
 * Layout: Chat on left, ManowarCard on right (matching agent.tsx pattern)
 * Uses shared MultimodalCanvas component and hooks for the chat interface.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { useParams } from "wouter";
import { Link } from "wouter";
import { useActiveWallet } from "thirdweb/react";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { thirdwebClient, INFERENCE_PRICE_WEI } from "@/lib/thirdweb";
import { createNormalizedFetch } from "@/lib/payment";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { useOnchainManowarByIdentifier } from "@/hooks/use-onchain";
import { fileToDataUrl } from "@/lib/pinata";
import { MultimodalCanvas } from "@/components/canvas";
import { type ChatMessage } from "@/components/chat";
import { useChat } from "@/hooks/use-chat";
import { useFileAttachment } from "@/hooks/use-attachment";
import { useAudioRecording } from "@/hooks/use-recording";
import { ManowarCard, ManowarCardSkeleton } from "@/components/manowar-card";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    ArrowLeft,
    Shield,
    Layers,
    IdCard,
} from "lucide-react";

const MANOWAR_URL = (import.meta.env.VITE_MANOWAR_URL || "https://manowar.compose.market").replace(/\/+$/, "");

export default function ManowarPage() {
    const params = useParams<{ id: string }>();
    const manowarIdentifier = params.id || null;

    // Use identifier-based lookup (supports both wallet address and numeric ID)
    const { data: manowar, isLoading, error: manowarError } = useOnchainManowarByIdentifier(manowarIdentifier);

    // Coordinator exists if hasCoordinator is true
    const hasCoordinator = !!manowar?.hasCoordinator;

    const { toast } = useToast();
    const wallet = useActiveWallet();
    const { sessionActive, budgetRemaining, recordUsage } = useSession();

    // Chat state from shared hook
    const chat = useChat();
    const { messages, setMessages, scrollContainerRef, messagesEndRef,
        streamedTextRef, currentAssistantIdRef } = chat;
    const [inputValue, setInputValue] = useState("");
    const [sending, setSending] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    const [chatStatus, setChatStatus] = useState<"idle" | "paying" | "waiting" | "streaming">("idle");

    // Session dialog
    const [showSessionDialog, setShowSessionDialog] = useState(false);

    // Mobile card sheet
    const [mobileCardOpen, setMobileCardOpen] = useState(false);

    // Local RAF ref for streaming updates
    const rafRef = useRef<number | null>(null);

    // File attachment from shared hook
    const manowarWallet = manowar?.walletAddress;
    const fileAttachment = useFileAttachment({
        conversationId: `manowar-${manowarWallet || 'unknown'}`,
        onError: (err) => setChatError(err),
    });
    const { attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile } = fileAttachment;

    // Audio recording from shared hook
    const recording = useAudioRecording({
        conversationId: `manowar-${manowarWallet || 'unknown'}`,
        onRecordingComplete: (file) => {
            fileAttachment.attachedFiles.length === 0 &&
                fileAttachment.handleFileSelect({ target: { files: [file.file] } } as unknown as React.ChangeEvent<HTMLInputElement>);
        },
        onError: (err) => setChatError(err),
    });
    const { isRecording, recordingSupported, startRecording, stopRecording } = recording;

    // Auto-register manowar with backend if not registered
    const autoRegisterManowar = useCallback(async (): Promise<boolean> => {
        if (!manowar || !manowar.walletAddress) return false;

        try {
            const response = await fetch(`${MANOWAR_URL}/manowar/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    manowarId: manowar.id,
                    walletAddress: manowar.walletAddress,
                    dnaHash: manowar.dnaHash,
                    title: manowar.title || `Manowar #${manowar.id}`,
                    description: manowar.description || "",
                    image: manowar.image,
                    creator: manowar.creator,
                    hasCoordinator: manowar.hasCoordinator,
                    coordinatorModel: manowar.coordinatorModel,
                    totalPrice: manowar.totalPrice,
                    // Send agent wallet addresses (unique identifiers from IPFS metadata)
                    // NOT numeric agentIds which can conflict across contract deployments
                    agentWalletAddresses: manowar.metadata?.agents?.map(a => a.walletAddress).filter(Boolean) || [],
                }),
            });

            if (response.ok || response.status === 409) {
                console.log(`[manowar] Auto-registered manowar ${manowar.walletAddress}`);
                return true;
            }

            console.warn(`[manowar] Auto-registration failed:`, await response.text());
            return false;
        } catch (err) {
            console.error(`[manowar] Auto-registration error:`, err);
            return false;
        }
    }, [manowar]);

    // Pre-register manowar when page loads
    useEffect(() => {
        if (manowar?.walletAddress) {
            autoRegisterManowar().then((ok) => {
                if (!ok) {
                    console.warn("[manowar] Pre-registration failed, will retry on 404");
                }
            });
        }
    }, [manowar?.walletAddress, autoRegisterManowar]);

    // Send chat message with x402 payment
    const handleSendMessage = useCallback(async () => {
        if (attachedFiles.some(f => f.uploading)) return;
        if ((!inputValue.trim() && attachedFiles.length === 0) || sending || !manowar) return;

        if (!wallet) {
            toast({ title: "Connect wallet", description: "Please connect your wallet to execute workflow", variant: "destructive" });
            return;
        }

        const attached = attachedFiles[0];
        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: inputValue.trim(),
            timestamp: Date.now(),
            type: attached?.type || "text",
            imageUrl: attached?.type === "image" ? attached.preview : undefined,
            audioUrl: attached?.type === "audio" ? attached.preview : undefined,
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue("");
        fileAttachment.clearFiles();
        setSending(true);
        setChatError(null);
        setChatStatus("paying");

        // Create assistant placeholder
        const assistantId = crypto.randomUUID();
        setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "", timestamp: Date.now() }]);

        try {
            setChatStatus("waiting");

            const normalizedFetch = createNormalizedFetch();
            const fetchWithPayment = wrapFetchWithPayment(
                normalizedFetch,
                thirdwebClient,
                wallet,
                { maxValue: BigInt(10_000) } // $0.01 - matches MANOWAR_PRICES.ORCHESTRATION
            );

            // Pre-compute attachment base64 data
            let attachmentBase64: string | undefined;
            let attachmentType: "image" | "audio" | undefined;
            if (attached && attached.file) {
                const base64Data = await fileToDataUrl(attached.file);
                attachmentBase64 = base64Data.split(",")[1];
                attachmentType = attached.type;
            }

            const makeChatRequest = async (): Promise<Response> => {
                // Persistent thread ID scoped to user and manowar workflow
                const userAddress = wallet.getAccount()?.address;
                const threadKey = `manowar-thread-${userAddress}-${manowar.id}`;
                let threadId = sessionStorage.getItem(threadKey);
                if (!threadId) {
                    threadId = `manowar-${manowar.id}-user-${userAddress}-${crypto.randomUUID()}`;
                    sessionStorage.setItem(threadKey, threadId);
                }

                const headers: Record<string, string> = {
                    "Content-Type": "application/json",
                };

                if (userAddress) {
                    headers["x-session-user-address"] = userAddress;
                }

                // Build request body with optional file attachment
                const requestBody: Record<string, unknown> = {
                    message: userMessage.content,
                    threadId: threadId,
                };

                if (attachmentBase64) {
                    if (attachmentType === "image") {
                        requestBody.image = attachmentBase64;
                    } else if (attachmentType === "audio") {
                        requestBody.audio = attachmentBase64;
                    }
                }

                // Use the /manowar/:id/chat endpoint - prefer wallet address for routing
                const manowarIdentifier = manowar.walletAddress || manowar.id.toString();
                return fetchWithPayment(`${MANOWAR_URL}/manowar/${manowarIdentifier}/chat`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(requestBody),
                });
            };

            let response = await makeChatRequest();

            // If manowar not found (404), auto-register and retry once
            if (response.status === 404) {
                console.log(`[manowar] Manowar not registered, auto-registering...`);
                const registered = await autoRegisterManowar();
                if (registered) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    response = await makeChatRequest();
                }
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Execution failed: ${response.status}`);
            }

            // Handle streaming response - same pattern as agent.tsx
            const contentType = response.headers.get("content-type") || "";

            if (contentType.includes("text/event-stream") || contentType.includes("text/plain")) {
                const reader = response.body?.getReader();
                if (!reader) throw new Error("No response body");

                setChatStatus("streaming");
                const decoder = new TextDecoder();
                let fullResponse = "";

                currentAssistantIdRef.current = assistantId;
                streamedTextRef.current = "";

                const updateAssistantMessage = (content: string) => {
                    setMessages(prev => {
                        const next = [...prev];
                        const last = next[next.length - 1];
                        if (last?.id === assistantId) {
                            next[next.length - 1] = { ...last, content };
                            return next;
                        }
                        const idx = next.findIndex(m => m.id === assistantId);
                        if (idx >= 0) next[idx] = { ...next[idx], content };
                        return next;
                    });
                };

                const flushStreamedContent = () => {
                    rafRef.current = null;
                    updateAssistantMessage(streamedTextRef.current);
                };

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    fullResponse += chunk;
                    streamedTextRef.current = fullResponse;

                    if (rafRef.current === null) {
                        rafRef.current = requestAnimationFrame(flushStreamedContent);
                    }
                }

                if (rafRef.current !== null) {
                    cancelAnimationFrame(rafRef.current);
                    rafRef.current = null;
                }
                updateAssistantMessage(fullResponse);

                if (!fullResponse) {
                    setMessages(prev =>
                        prev.map(m => m.id === assistantId ? { ...m, content: "No response received" } : m)
                    );
                }
                recordUsage();
            } else if (contentType.includes("image")) {
                const blob = await response.blob();
                const imageUrl = URL.createObjectURL(blob);
                setMessages(prev =>
                    prev.map(m => m.id === assistantId ? { ...m, content: "Generated image:", imageUrl, type: "image" } : m)
                );
                recordUsage();
            } else if (contentType.includes("audio")) {
                const blob = await response.blob();
                const audioUrl = URL.createObjectURL(blob);
                setMessages(prev =>
                    prev.map(m => m.id === assistantId ? { ...m, content: "Generated audio:", audioUrl, type: "audio" } : m)
                );
                recordUsage();
            } else if (contentType.includes("video")) {
                const blob = await response.blob();
                const videoUrl = URL.createObjectURL(blob);
                setMessages(prev =>
                    prev.map(m => m.id === assistantId ? { ...m, content: "Generated video:", videoUrl, type: "video" } : m)
                );
                recordUsage();
            } else {
                // JSON response - handle multimodal results with base64 data
                const data = await response.json();

                if (data.success && data.data && data.type && data.type !== "text") {
                    const base64Data = data.data;
                    const mimeType = data.mimeType || (data.type === "image" ? "image/png" : data.type === "audio" ? "audio/wav" : "video/mp4");

                    const byteArray = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                    const blob = new Blob([byteArray], { type: mimeType });
                    const blobUrl = URL.createObjectURL(blob);

                    if (data.type === "image") {
                        setMessages(prev =>
                            prev.map(m => m.id === assistantId ? { ...m, content: `Generated image:`, imageUrl: blobUrl, type: "image" } : m)
                        );
                    } else if (data.type === "audio") {
                        setMessages(prev =>
                            prev.map(m => m.id === assistantId ? { ...m, content: `Generated audio:`, audioUrl: blobUrl, type: "audio" } : m)
                        );
                    } else if (data.type === "video") {
                        setMessages(prev =>
                            prev.map(m => m.id === assistantId ? { ...m, content: `Generated video:`, videoUrl: blobUrl, type: "video" } : m)
                        );
                    }
                } else if (!data.success && data.error) {
                    throw new Error(data.error);
                } else {
                    const content = data.output || data.message || data.content || JSON.stringify(data);
                    setMessages(prev =>
                        prev.map(m => m.id === assistantId ? { ...m, content } : m)
                    );
                }
                recordUsage();
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            setChatError(errorMsg);
            setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${errorMsg}` } : m)
            );
        } finally {
            setSending(false);
            setChatStatus("idle");
        }
    }, [inputValue, sending, manowar, wallet, toast, attachedFiles, autoRegisterManowar, recordUsage]);

    const copyEndpoint = () => {
        toast({
            title: "Copied!",
            description: "Manowar endpoint copied to clipboard",
        });
    };

    if (isLoading) {
        return (
            <div className="flex flex-col h-[calc(100vh-120px)]">
                <div className="shrink-0 mb-3 flex items-center justify-between">
                    <Skeleton className="h-8 w-32" />
                    <Skeleton className="h-6 w-24" />
                </div>
                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2">
                        <Skeleton className="h-full w-full rounded-lg" />
                    </div>
                    <div className="lg:col-span-1 hidden lg:block">
                        <ManowarCardSkeleton />
                    </div>
                </div>
            </div>
        );
    }

    if (manowarError || !manowar) {
        return (
            <div className="flex flex-col h-[calc(100vh-120px)]">
                <Link href="/my-assets">
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-3">
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back
                    </Button>
                </Link>

                <div className="flex-1 flex items-center justify-center border border-dashed border-red-500/30 rounded-lg">
                    <div className="text-center">
                        <Shield className="w-10 h-10 mx-auto text-red-400/50 mb-3" />
                        <p className="text-red-400 font-mono">Manowar not found</p>
                        <p className="text-muted-foreground text-xs mt-1">This workflow may not exist.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-120px)]">
            {/* Compact Header */}
            <div className="shrink-0 mb-3 flex items-center justify-between">
                <Link href="/my-assets">
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 h-7 px-2">
                        <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                        <span className="hidden sm:inline">Back</span>
                    </Button>
                </Link>

                <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
                    <Layers className="w-3 h-3 mr-1" />
                    Manowar #{manowar.id}
                </Badge>

                {/* Mobile Card Button - only visible on mobile */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="lg:hidden text-muted-foreground hover:text-fuchsia-400 h-7 w-7 p-0 ml-2"
                    onClick={() => setMobileCardOpen(true)}
                    aria-label="View workflow details"
                >
                    <IdCard className="w-4 h-4" />
                </Button>
            </div>

            {/* Main Layout: Chat on Left, Card on Right */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Chat Section (2/3 width on desktop, full on mobile) */}
                <div className="lg:col-span-2 min-h-0 flex flex-col">
                    {!hasCoordinator ? (
                        <div className="flex-1 flex items-center justify-center border border-dashed border-yellow-500/30 rounded-lg bg-yellow-500/5">
                            <div className="text-center p-6">
                                <Layers className="w-10 h-10 mx-auto text-yellow-400/50 mb-3" />
                                <p className="text-yellow-400 font-mono">No Coordinator Assigned</p>
                                <p className="text-muted-foreground text-sm mt-2 max-w-md">
                                    This workflow does not have a coordinator model. It cannot be executed interactively.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <MultimodalCanvas
                            variant="manowar"
                            title={`Execute ${manowar.title || `Manowar #${manowar.id}`}`}
                            messages={messages}
                            inputValue={inputValue}
                            onInputChange={setInputValue}
                            onSend={handleSendMessage}
                            sending={sending}
                            status={chatStatus}
                            error={chatError}
                            sessionActive={sessionActive}
                            onStartSession={() => setShowSessionDialog(true)}
                            attachedFiles={attachedFiles}
                            onFileSelect={() => fileInputRef.current?.click()}
                            onRemoveFile={handleRemoveFile}
                            fileInputRef={fileInputRef}
                            onFileInputChange={handleFileSelect}
                            isRecording={isRecording}
                            recordingSupported={recordingSupported}
                            onStartRecording={startRecording}
                            onStopRecording={stopRecording}
                            scrollContainerRef={scrollContainerRef}
                            messagesEndRef={messagesEndRef}
                            showMessageActions
                            onCopyMessage={(content) => {
                                navigator.clipboard.writeText(content);
                                toast({ title: "Copied!", description: "Message copied to clipboard" });
                            }}
                            onRetryMessage={(content) => {
                                setInputValue(content);
                                toast({ title: "Retry", description: "Message loaded for re-sending" });
                            }}
                            onDeleteMessage={(id) => setMessages(prev => prev.filter(m => m.id !== id))}
                            height="h-full"
                            emptyStateText="Ready to execute workflow."
                            emptyStateSubtext={`Input will be sent to Coordinator: ${manowar.coordinatorModel || "Model"}`}
                        />
                    )}
                </div>

                {/* Manowar Card (1/3 width on desktop, hidden on mobile) */}
                <div className="lg:col-span-1 hidden lg:flex flex-col min-h-0">
                    <ManowarCard
                        manowar={manowar}
                        onCopyEndpoint={copyEndpoint}
                    />
                </div>
            </div>

            {/* Session Budget Dialog */}
            <SessionBudgetDialog open={showSessionDialog} onOpenChange={setShowSessionDialog} showTrigger={false} />

            {/* Mobile Card Sheet */}
            <Sheet open={mobileCardOpen} onOpenChange={setMobileCardOpen}>
                <SheetContent side="right" className="w-[340px] sm:w-[400px] p-0 overflow-y-auto">
                    <SheetHeader className="p-4 border-b border-sidebar-border">
                        <SheetTitle className="font-display text-fuchsia-400 flex items-center gap-2">
                            <IdCard className="w-4 h-4" />
                            Workflow Details
                        </SheetTitle>
                    </SheetHeader>
                    <div className="p-4">
                        <ManowarCard
                            manowar={manowar}
                            onCopyEndpoint={copyEndpoint}
                        />
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
