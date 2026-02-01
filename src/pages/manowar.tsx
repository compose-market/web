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
import { useActiveWallet, useActiveAccount } from "thirdweb/react";
import { inferencePriceWei, isCronosChain } from "@/lib/chains";
import { createPaymentFetch } from "@/lib/payment";
import { useChain } from "@/contexts/ChainContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session.tsx";
import { SessionBudgetDialog } from "@/components/session";
import { useOnchainManowarByIdentifier, fetchAgentByWalletAddress } from "@/hooks/use-onchain";
import { MultimodalCanvas, type ChatMessage } from "@/components/chat";
import { useChat } from "@/hooks/use-chat";
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
    const account = useActiveAccount();
    const { paymentChainId } = useChain();
    const { sessionActive, budgetRemaining, recordUsage, composeKeyToken } = useSession();

    // Chat state from shared hook (includes messages, attachments, and recording)
    const manowarWallet = manowar?.walletAddress;
    const chat = useChat({
        conversationId: `manowar-${manowarWallet || 'unknown'}`,
        onError: (err) => setChatError(err),
    });
    const { messages, setMessages, scrollContainerRef, messagesEndRef,
        streamedTextRef, currentAssistantIdRef, handleJsonResponse,
        updateAssistantMessage, scheduleStreamUpdate, flushStreamContent,
        // Attachments
        attachedFiles, fileInputRef, handleFileSelect, handleRemoveFile, clearFiles,
        // Recording
        isRecording, recordingSupported, startRecording, stopRecording,
    } = chat;
    const [inputValue, setInputValue] = useState("");
    const [sending, setSending] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    const [chatStatus, setChatStatus] = useState<"idle" | "paying" | "waiting" | "streaming">("idle");

    // Session dialog
    const [showSessionDialog, setShowSessionDialog] = useState(false);

    // Mobile card sheet
    const [mobileCardOpen, setMobileCardOpen] = useState(false);

    // Auto-register manowar with backend if not registered
    const autoRegisterManowar = useCallback(async (): Promise<boolean> => {
        if (!manowar || !manowar.walletAddress) return false;

        try {
            const response = await fetch(`${MANOWAR_URL}/manowar/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    // Use walletAddress as primary identifier - manowarId only for on-chain reference
                    walletAddress: manowar.walletAddress,
                    manowarId: manowar.id, // for backward compat display only
                    // IPFS URI to manowarCard
                    manowarCardUri: manowar.manowarCardUri,
                    dnaHash: manowar.dnaHash,
                    title: manowar.title || "",
                    description: manowar.description || "",
                    image: manowar.image,
                    creator: manowar.creator,
                    hasCoordinator: manowar.hasCoordinator,
                    coordinatorModel: manowar.coordinatorModel,
                    totalPrice: manowar.totalPrice,
                    // Send agent wallet addresses (unique identifiers from IPFS metadata)
                    // Basic numeric agentIds can conflict across contract deployments
                    agentWalletAddresses: manowar.metadata?.agents?.map(a => a.walletAddress).filter(Boolean) || [],
                }),
            });

            if (response.ok || response.status === 409) {
                console.log(`[manowar] Auto-registered manowar ${manowar.walletAddress}`);

                // Also register each component agent so orchestrator can delegate to them
                const agents = manowar.metadata?.agents || [];
                for (const agentCard of agents) {
                    if (!agentCard.walletAddress) continue;
                    try {
                        // Fetch the full on-chain agent data of the agentCardUri
                        const onchainAgent = await fetchAgentByWalletAddress(agentCard.walletAddress);
                        if (!onchainAgent) {
                            console.warn(`[manowar] Component agent ${agentCard.walletAddress.slice(0, 10)}... not found on-chain`);
                            continue;
                        }

                        const agentRes = await fetch(`${MANOWAR_URL}/agent/register`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                walletAddress: onchainAgent.walletAddress,
                                dnaHash: onchainAgent.dnaHash,
                                name: onchainAgent.metadata?.name || agentCard.name || `Agent ${agentCard.walletAddress.slice(0, 8)}`,
                                description: onchainAgent.metadata?.description || agentCard.description || "",
                                agentCardUri: onchainAgent.agentCardUri, // From blockchain
                                creator: onchainAgent.creator,
                                model: onchainAgent.metadata?.model || agentCard.model,
                                plugins: onchainAgent.metadata?.plugins?.map((p) => p.registryId) || [],
                            }),
                        });
                        if (agentRes.ok || agentRes.status === 409) {
                            console.log(`[manowar] Registered component agent ${agentCard.walletAddress.slice(0, 10)}...`);
                        }
                    } catch (err) {
                        console.warn(`[manowar] Failed to register component agent:`, err);
                    }
                }

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

        if (!wallet || !account) {
            toast({ title: "Connect wallet", description: "Please connect your wallet to execute workflow", variant: "destructive" });
            return;
        }

        // Cronos requires active session for payments
        if (isCronosChain(paymentChainId) && (!sessionActive || budgetRemaining <= 0)) {
            toast({
                title: "Session Required",
                description: "Cronos payments require an active session. Please create one to continue.",
                variant: "destructive"
            });
            setShowSessionDialog(true);
            return;
        }

        const attached = attachedFiles[0];
        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: inputValue.trim(),
            timestamp: Date.now(),
            type: attached?.type || "text",
            // Use IPFS URL (attached.url) instead of local preview (attached.preview)
            // This ensures the displayed attachment matches what's sent to the model
            imageUrl: attached?.type === "image" ? attached.url : undefined,
            audioUrl: attached?.type === "audio" ? attached.url : undefined,
            videoUrl: attached?.type === "video" ? attached.url : undefined,
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue("");
        clearFiles();
        setSending(true);
        setChatError(null);
        setChatStatus("paying");

        // Create assistant placeholder
        const assistantId = crypto.randomUUID();
        setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "", timestamp: Date.now() }]);

        try {
            setChatStatus("waiting");

            // Chain-aware payment: routes to Cronos x402 or ThirdWeb based on selected chain
            const fetchWithPayment = createPaymentFetch({
                chainId: paymentChainId,
                account,
                wallet,
                maxValue: BigInt(10_000), // $0.01 - matches MANOWAR_PRICES.ORCHESTRATION
            });

            // Use Pinata URL for attachments (not base64)
            // The file is already uploaded by useFileAttachment hook
            let attachmentUrl: string | undefined;
            let attachmentType: "image" | "audio" | "video" | undefined;
            if (attached && attached.url) {
                attachmentUrl = attached.url;
                attachmentType = attached.type;
            }

            const makeChatRequest = async (): Promise<Response> => {
                // Persistent thread ID scoped to user and manowar workflow
                const userAddress = wallet.getAccount()?.address;
                const threadKey = `manowar-thread-${userAddress}-${manowar.walletAddress}`;
                let threadId = sessionStorage.getItem(threadKey);
                if (!threadId) {
                    threadId = `manowar-${manowar.walletAddress}-user-${userAddress}-${crypto.randomUUID()}`;
                    sessionStorage.setItem(threadKey, threadId);
                }

                const headers: Record<string, string> = {
                    "Content-Type": "application/json",
                };

                if (userAddress) {
                    headers["x-session-user-address"] = userAddress;
                }

                // Add session headers for x402 payment bypass
                if (sessionActive && budgetRemaining > 0) {
                    headers["x-session-active"] = "true";
                    headers["x-session-budget-remaining"] = budgetRemaining.toString();
                    // Use Compose Key for backend authentication (enables on-chain settlement)
                    if (composeKeyToken) {
                        headers["Authorization"] = `Bearer ${composeKeyToken}`;
                    }
                }

                // Build request body with Pinata URL for attachments
                const requestBody: Record<string, unknown> = {
                    message: userMessage.content,
                    threadId: threadId,
                };

                // Send Pinata URLs, not base64 data
                if (attachmentUrl && attachmentType) {
                    requestBody.attachment = {
                        type: attachmentType,
                        url: attachmentUrl,
                    };
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
                let buffer = "";
                let finalOutput = "";

                currentAssistantIdRef.current = assistantId;
                streamedTextRef.current = "";

                // Parse SSE events and use hook's streaming update
                const processSSEBuffer = (rawBuffer: string) => {
                    const lines = rawBuffer.split("\n");
                    let currentEvent = "";
                    let currentData = "";

                    for (const line of lines) {
                        if (line.startsWith("event:")) {
                            currentEvent = line.substring(6).trim();
                        } else if (line.startsWith("data:")) {
                            currentData = line.substring(5).trim();

                            // Process completed event
                            if (currentEvent && currentData) {
                                try {
                                    const data = JSON.parse(currentData);

                                    if (currentEvent === "start") {
                                        streamedTextRef.current = data.message || "Starting workflow...";
                                    } else if (currentEvent === "step" || currentEvent === "agent") {
                                        streamedTextRef.current = data.message || `Processing ${data.agentName || data.stepName}...`;
                                    } else if (currentEvent === "complete") {
                                        streamedTextRef.current = data.message || "Workflow complete!";
                                    } else if (currentEvent === "result") {
                                        // Final result - check if it's a multimodal JSON response
                                        finalOutput = data.output || "";

                                        // Try to parse output as JSON to check for multimodal data
                                        try {
                                            const parsed = typeof finalOutput === "string" ? JSON.parse(finalOutput) : finalOutput;
                                            // If it has type + url/data/base64, it's a multimodal response
                                            if (parsed && (parsed.url || parsed.data || parsed.base64) && parsed.type) {
                                                // Use handleJsonResponse to display properly (handles URL or uploads base64)
                                                handleJsonResponse(assistantId, parsed);
                                                streamedTextRef.current = `Generated ${parsed.type}...`;
                                            } else if (parsed && parsed.success === false && parsed.error) {
                                                streamedTextRef.current = `Error: ${parsed.error}`;
                                            } else {
                                                // Regular text output
                                                streamedTextRef.current = finalOutput;
                                            }
                                        } catch {
                                            // Not JSON, treat as regular text
                                            streamedTextRef.current = finalOutput;
                                        }
                                    } else if (currentEvent === "error") {
                                        streamedTextRef.current = `Error: ${data.error || "Unknown error"}`;
                                    }

                                    // Use hook's RAF-batched streaming update
                                    scheduleStreamUpdate(streamedTextRef.current);
                                } catch {
                                    // Invalid JSON, ignore
                                }
                            }
                        }
                    }
                };

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;
                    processSSEBuffer(buffer);
                }

                // Final flush and update
                flushStreamContent();

                // Only update content if handleJsonResponse hasn't already handled it
                // (handleJsonResponse will set imageUrl/audioUrl/videoUrl)
                const lastMessage = messages.find(m => m.id === assistantId);
                if (!lastMessage?.imageUrl && !lastMessage?.audioUrl && !lastMessage?.videoUrl) {
                    updateAssistantMessage(assistantId, { content: finalOutput || streamedTextRef.current || "Workflow completed" });
                }

                if (!finalOutput && !streamedTextRef.current) {
                    updateAssistantMessage(assistantId, { content: "No response received" });
                }
                recordUsage();
            } else {
                // Non-streaming response (image/audio/video/json) - use unified handler
                const { parseMultimodalResponse } = await import("@/lib/multimodal");
                const result = await parseMultimodalResponse(response, {
                    uploadToPinata: true,
                    conversationId: `manowar-${manowar.walletAddress}`,
                    // Handle async video polling
                    onVideoPolling: {
                        onProgress: (status, progress) => {
                            setMessages(prev =>
                                prev.map(m => m.id === assistantId ? {
                                    ...m,
                                    content: `Video generating... (${status}${progress ? ` - ${progress}%` : ""})`,
                                } : m)
                            );
                        },
                        onComplete: (url) => {
                            setMessages(prev =>
                                prev.map(m => m.id === assistantId ? {
                                    ...m,
                                    content: "Video generated:",
                                    type: "video",
                                    videoUrl: url,
                                } : m)
                            );
                            recordUsage();
                        },
                        onError: (error) => {
                            setMessages(prev =>
                                prev.map(m => m.id === assistantId ? {
                                    ...m,
                                    content: `Error: ${error}`,
                                } : m)
                            );
                        },
                    },
                });

                // Handle polling - don't update if polling in progress
                if (result.polling) {
                    console.log(`[manowar] Video job submitted, polling: ${result.jobId}`);
                    return;
                }

                if (result.success) {
                    setMessages(prev =>
                        prev.map(m => m.id === assistantId ? {
                            ...m,
                            content: result.content || `Generated ${result.type}:`,
                            type: result.type,
                            imageUrl: result.type === "image" ? result.url : undefined,
                            audioUrl: result.type === "audio" ? result.url : undefined,
                            videoUrl: result.type === "video" ? result.url : undefined,
                        } : m)
                    );
                    recordUsage();
                } else {
                    throw new Error(result.error || "Request failed");
                }
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
    }, [inputValue, sending, manowar, wallet, toast, attachedFiles, autoRegisterManowar, recordUsage, paymentChainId, sessionActive, budgetRemaining, composeKeyToken, setShowSessionDialog]);

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
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-3" onClick={() => history.back()}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                </Button>

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
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 h-7 px-2" onClick={() => history.back()}>
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                    <span className="hidden sm:inline">Back</span>
                </Button>

                <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-xs">
                    <Layers className="w-3 h-3 mr-1" />
                    Manowar {manowar.walletAddress?.slice(0, 6)}…{manowar.walletAddress?.slice(-4)}
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
