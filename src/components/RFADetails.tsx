/**
 * RFA Details Component
 * 
 * Full detail view for an RFA (Request-For-Agent).
 * Shows RFA info, submissions, and actions for publishers/agent creators.
 */
import { useState, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { prepareContractCall } from "thirdweb";
import {
    useRFAData,
    useRFASubmissions,
    useOnchainAgent,
    type OnchainRFA,
    type RFASubmission,
} from "@/hooks/use-onchain";
import { useAgentsByCreator } from "@/hooks/use-onchain";
import {
    getRFAContract,
    RFA_CATEGORIES,
    RFA_BOUNTY_LIMITS,
    encodeSkillAsBytes32,
} from "@/lib/contracts";
import { getIpfsUrl } from "@/lib/pinata";
import {
    Loader2,
    FileSearch,
    CheckCircle,
    XCircle,
    Clock,
    User,
    Bot,
    Send,
    Award,
    AlertCircle,
} from "lucide-react";

// =============================================================================
// Props
// =============================================================================

interface RFADetailsProps {
    rfaId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode?: "dialog" | "sheet";
}

// =============================================================================
// Submission Item Component
// =============================================================================

function SubmissionItem({
    submission,
    isPublisher,
    onAccept,
    isAccepting,
}: {
    submission: RFASubmission;
    isPublisher: boolean;
    onAccept: (agentId: number) => void;
    isAccepting: boolean;
}) {
    const { data: agent, isLoading } = useOnchainAgent(submission.agentId);

    const initials = agent?.metadata?.name
        ?.split(" ")
        .map(w => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "AG";

    const avatarUrl = agent?.metadata?.image
        ? (agent.metadata.image.startsWith("ipfs://")
            ? getIpfsUrl(agent.metadata.image.replace("ipfs://", ""))
            : agent.metadata.image)
        : null;

    const submittedDate = new Date(submission.submittedAt * 1000);

    return (
        <div className="p-3 rounded-sm border border-sidebar-border bg-background/30 space-y-2">
            <div className="flex items-start gap-3">
                <Avatar className="w-10 h-10 border border-fuchsia-500/30">
                    <AvatarImage src={avatarUrl || undefined} alt={agent?.metadata?.name} />
                    <AvatarFallback className="bg-fuchsia-500/10 text-fuchsia-400 font-mono text-xs">
                        {initials}
                    </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-sm truncate">
                            {isLoading ? "Loading..." : agent?.metadata?.name || `Agent #${submission.agentId}`}
                        </span>
                        <Badge variant="outline" className="text-[9px] shrink-0">
                            #{submission.agentId}
                        </Badge>
                    </div>

                    {agent?.metadata?.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {agent.metadata.description}
                        </p>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {submission.creator.slice(0, 6)}...{submission.creator.slice(-4)}
                        </span>
                        <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {submittedDate.toLocaleDateString()}
                        </span>
                    </div>
                </div>

                {isPublisher && (
                    <Button
                        size="sm"
                        onClick={() => onAccept(submission.agentId)}
                        disabled={isAccepting}
                        className="bg-green-500 hover:bg-green-600 text-white text-xs"
                    >
                        {isAccepting ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <>
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Accept
                            </>
                        )}
                    </Button>
                )}
            </div>
        </div>
    );
}

// =============================================================================
// Submit Agent Dialog
// =============================================================================

function SubmitAgentSection({
    rfa,
    onSubmit,
    isSubmitting,
}: {
    rfa: OnchainRFA;
    onSubmit: (agentId: number) => void;
    isSubmitting: boolean;
}) {
    const account = useActiveAccount();
    const { data: myAgents, isLoading } = useAgentsByCreator(account?.address);
    const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!myAgents || myAgents.length === 0) {
        return (
            <div className="p-4 text-center space-y-2">
                <Bot className="w-8 h-8 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                    You don't have any agents to submit.
                </p>
                <Button variant="outline" size="sm" asChild>
                    <a href="/create-agent">Create an Agent</a>
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                Select one of your agents to submit for this bounty:
            </p>

            <ScrollArea className="h-32">
                <div className="space-y-2">
                    {myAgents.map((agent) => {
                        const isSelected = selectedAgentId === agent.id;
                        const avatarUrl = agent.metadata?.image
                            ? (agent.metadata.image.startsWith("ipfs://")
                                ? getIpfsUrl(agent.metadata.image.replace("ipfs://", ""))
                                : agent.metadata.image)
                            : null;

                        return (
                            <button
                                key={agent.id}
                                onClick={() => setSelectedAgentId(agent.id)}
                                className={`w-full p-2 rounded-sm border transition-all text-left ${isSelected
                                    ? "border-cyan-500 bg-cyan-500/10"
                                    : "border-sidebar-border hover:border-cyan-500/50"
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <Avatar className="w-6 h-6">
                                        <AvatarImage src={avatarUrl || undefined} />
                                        <AvatarFallback className="text-[10px]">
                                            {agent.metadata?.name?.slice(0, 2).toUpperCase() || "AG"}
                                        </AvatarFallback>
                                    </Avatar>
                                    <span className="font-mono text-xs truncate">
                                        {agent.metadata?.name || `Agent #${agent.id}`}
                                    </span>
                                    {isSelected && (
                                        <CheckCircle className="w-3 h-3 text-cyan-400 ml-auto shrink-0" />
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </ScrollArea>

            <Button
                onClick={() => selectedAgentId && onSubmit(selectedAgentId)}
                disabled={!selectedAgentId || isSubmitting}
                className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-bold"
            >
                {isSubmitting ? (
                    <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Submitting...
                    </>
                ) : (
                    <>
                        <Send className="w-4 h-4 mr-2" />
                        Submit Agent for ${rfa.offerAmountFormatted}
                    </>
                )}
            </Button>
        </div>
    );
}

// =============================================================================
// Main Component
// =============================================================================

export function RFADetails({ rfaId, open, onOpenChange, mode = "dialog" }: RFADetailsProps) {
    const { toast } = useToast();
    const account = useActiveAccount();
    const { mutateAsync: sendTransaction } = useSendTransaction();

    const { data: rfa, isLoading: isLoadingRFA } = useRFAData(rfaId);
    const { data: submissions, isLoading: isLoadingSubmissions, refetch: refetchSubmissions } = useRFASubmissions(rfaId);

    const [actionState, setActionState] = useState<"idle" | "accepting" | "cancelling" | "submitting">("idle");

    // Check if current user is publisher
    const isPublisher = useMemo(() => {
        if (!account || !rfa) return false;
        return account.address.toLowerCase() === rfa.publisher.toLowerCase();
    }, [account, rfa]);

    // Get category info
    const categoryInfo = useMemo(() => {
        if (!rfa) return null;
        const categoryHash = rfa.requiredSkills[0]?.toLowerCase();
        return (
            RFA_CATEGORIES.find(({ id }) => encodeSkillAsBytes32(id).toLowerCase() === categoryHash) ||
            RFA_CATEGORIES[RFA_CATEGORIES.length - 1]
        );
    }, [rfa]);

    // Format dates
    const createdDate = rfa ? new Date(rfa.createdAt * 1000) : null;

    // Handle accept agent
    const handleAcceptAgent = async (agentId: number) => {
        if (!rfaId) return;

        try {
            if (!account) {
                throw new Error("Wallet account unavailable");
            }
            setActionState("accepting");

            const contract = getRFAContract();
            const tx = prepareContractCall({
                contract,
                method: "function acceptAgent(uint256 rfaId, uint256 agentId)",
                params: [BigInt(rfaId), BigInt(agentId)],
            });

            await sendTransaction(tx);

            toast({
                title: "Agent Accepted!",
                description: "The bounty has been released to the agent creator.",
            });

            refetchSubmissions();
            onOpenChange(false);
        } catch (error) {
            console.error("Accept error:", error);
            toast({
                title: "Failed to Accept",
                description: error instanceof Error ? error.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setActionState("idle");
        }
    };

    // Handle cancel RFA
    const handleCancelRFA = async () => {
        if (!rfaId) return;

        try {
            if (!account) {
                throw new Error("Wallet account unavailable");
            }
            setActionState("cancelling");

            const contract = getRFAContract();
            const tx = prepareContractCall({
                contract,
                method: "function cancelRFA(uint256 rfaId)",
                params: [BigInt(rfaId)],
            });

            await sendTransaction(tx);

            toast({
                title: "RFA Cancelled",
                description: "Your escrowed funds have been refunded.",
            });

            onOpenChange(false);
        } catch (error) {
            console.error("Cancel error:", error);
            toast({
                title: "Failed to Cancel",
                description: error instanceof Error ? error.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setActionState("idle");
        }
    };

    // Handle submit agent
    const handleSubmitAgent = async (agentId: number) => {
        if (!rfaId) return;

        try {
            if (!account) {
                throw new Error("Wallet account unavailable");
            }
            setActionState("submitting");

            const contract = getRFAContract();
            const tx = prepareContractCall({
                contract,
                method: "function submitAgent(uint256 rfaId, uint256 agentId)",
                params: [BigInt(rfaId), BigInt(agentId)],
            });

            await sendTransaction(tx);

            toast({
                title: "Agent Submitted!",
                description: "Your agent has been submitted for this bounty.",
            });

            refetchSubmissions();
        } catch (error) {
            console.error("Submit error:", error);
            toast({
                title: "Failed to Submit",
                description: error instanceof Error ? error.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setActionState("idle");
        }
    };

    // Content
    const content = (
        <div className="space-y-4">
            {isLoadingRFA ? (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                </div>
            ) : !rfa ? (
                <div className="text-center py-8">
                    <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">RFA not found</p>
                </div>
            ) : (
                <>
                    {/* Status Badge */}
                    <div className="flex items-center gap-2">
                        <Badge
                            variant="outline"
                            className={`
                ${rfa.status === 'Open' ? 'border-green-500/50 text-green-400 bg-green-500/10' : ''}
                ${rfa.status === 'Fulfilled' ? 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10' : ''}
                ${rfa.status === 'Cancelled' ? 'border-red-500/50 text-red-400 bg-red-500/10' : ''}
              `}
                        >
                            {rfa.status === 'Open' && <Clock className="w-3 h-3 mr-1" />}
                            {rfa.status === 'Fulfilled' && <CheckCircle className="w-3 h-3 mr-1" />}
                            {rfa.status === 'Cancelled' && <XCircle className="w-3 h-3 mr-1" />}
                            {rfa.status}
                        </Badge>
                        {categoryInfo && (
                            <Badge variant="secondary" className="text-xs">
                                {categoryInfo.label}
                            </Badge>
                        )}
                    </div>

                    {/* Bounty Amount */}
                    <div className="p-4 rounded-sm bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10 border border-cyan-500/30">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Award className="w-5 h-5 text-cyan-400" />
                                <span className="text-sm text-muted-foreground">Bounty</span>
                            </div>
                            <span className="text-2xl font-bold font-mono text-cyan-400">
                                {rfa.offerAmountFormatted}
                            </span>
                        </div>
                        <div className="mt-2 text-[10px] text-muted-foreground">
                            Basic: ${RFA_BOUNTY_LIMITS.BASIC_BOUNTY.toFixed(2)} + README bonus: up to ${(parseFloat(rfa.offerAmount) - RFA_BOUNTY_LIMITS.BASIC_BOUNTY).toFixed(2)}
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <h4 className="text-xs font-mono text-muted-foreground mb-2">DESCRIPTION</h4>
                        <p className="text-sm">{rfa.description}</p>
                    </div>

                    {/* Meta info */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                            <span className="text-muted-foreground">Publisher:</span>
                            <p className="font-mono">
                                {rfa.publisher.slice(0, 6)}...{rfa.publisher.slice(-4)}
                            </p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Created:</span>
                            <p>{createdDate?.toLocaleDateString()}</p>
                        </div>
                    </div>

                    <Separator />

                    {/* Submissions */}
                    <div>
                        <h4 className="text-xs font-mono text-muted-foreground mb-2">
                            SUBMISSIONS ({submissions?.length || 0})
                        </h4>

                        {isLoadingSubmissions ? (
                            <div className="flex items-center gap-2 py-4">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm text-muted-foreground">Loading submissions...</span>
                            </div>
                        ) : submissions && submissions.length > 0 ? (
                            <ScrollArea className="h-40">
                                <div className="space-y-2 pr-2">
                                    {submissions.map((sub) => (
                                        <SubmissionItem
                                            key={`${sub.agentId}-${sub.submittedAt}`}
                                            submission={sub}
                                            isPublisher={isPublisher}
                                            onAccept={handleAcceptAgent}
                                            isAccepting={actionState === "accepting"}
                                        />
                                    ))}
                                </div>
                            </ScrollArea>
                        ) : (
                            <div className="text-center py-4">
                                <Bot className="w-6 h-6 mx-auto text-muted-foreground/30 mb-1" />
                                <p className="text-xs text-muted-foreground">No submissions yet</p>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    {rfa.status === 'Open' && (
                        <>
                            <Separator />

                            {isPublisher ? (
                                <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        As the publisher, you can cancel this RFA to get your escrow refunded.
                                    </p>
                                    <Button
                                        variant="outline"
                                        onClick={handleCancelRFA}
                                        disabled={actionState === "cancelling"}
                                        className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10"
                                    >
                                        {actionState === "cancelling" ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Cancelling...
                                            </>
                                        ) : (
                                            <>
                                                <XCircle className="w-4 h-4 mr-2" />
                                                Cancel RFA & Refund
                                            </>
                                        )}
                                    </Button>
                                </div>
                            ) : (
                                <SubmitAgentSection
                                    rfa={rfa}
                                    onSubmit={handleSubmitAgent}
                                    isSubmitting={actionState === "submitting"}
                                />
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );

    // Render as Dialog or Sheet
    if (mode === "sheet") {
        return (
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent className="bg-card border-sidebar-border">
                    <SheetHeader>
                        <SheetTitle className="font-display flex items-center gap-2">
                            <FileSearch className="w-5 h-5 text-cyan-400" />
                            {rfa?.title || "RFA Details"}
                        </SheetTitle>
                        <SheetDescription>
                            Request for Agent #{rfaId}
                        </SheetDescription>
                    </SheetHeader>
                    <div className="mt-4">{content}</div>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg bg-card border-cyan-500/30">
                <DialogHeader>
                    <DialogTitle className="font-display flex items-center gap-2">
                        <FileSearch className="w-5 h-5 text-cyan-400" />
                        {rfa?.title || "RFA Details"}
                    </DialogTitle>
                    <DialogDescription>
                        Request for Agent #{rfaId}
                    </DialogDescription>
                </DialogHeader>
                {content}
            </DialogContent>
        </Dialog>
    );
}
