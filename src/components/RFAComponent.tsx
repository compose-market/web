/**
 * RFA (Request-For-Agent) Component
 * 
 * Simple form for creating an RFA (bounty request) for a missing agent.
 * Used in compose.tsx when the manowar creator needs an agent that doesn't exist.
 */
import { useState, useMemo } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useActiveAccount, useActiveWallet, useSendTransaction } from "thirdweb/react";
import { prepareContractCall, readContract } from "thirdweb";
import {
    getRFAContract,
    getContractAddress,
    RFA_CATEGORIES,
    RFA_BOUNTY_LIMITS,
    encodeSkillAsBytes32,
    usdcToWei,
} from "@/lib/contracts";
import { getContract } from "thirdweb";
import { thirdwebClient, paymentChain } from "../lib/chains";
import {
    DollarSign,
    Loader2,
    FileSearch,
    Sparkles,
    AlertCircle,
    CheckCircle2,
    Info,
} from "lucide-react";
import { useChain } from "@/contexts/ChainContext";

// =============================================================================
// Form Schema
// =============================================================================

const rfaFormSchema = z.object({
    description: z.string().min(20, "Description must be at least 20 characters").max(500),
    category: z.string().min(1, "Please select a category"),
    offerAmount: z.number().min(RFA_BOUNTY_LIMITS.MIN_BOUNTY).max(RFA_BOUNTY_LIMITS.MAX_BOUNTY),
});

type RFAFormValues = z.infer<typeof rfaFormSchema>;

// =============================================================================
// Props
// =============================================================================

interface RFAComponentProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    manowarId: number;
    manowarTitle?: string;
    onSuccess?: (rfaId: number) => void;
}

// =============================================================================
// USDC Contract Helper - Now uses dynamic chain configuration
// =============================================================================

import { getUsdcContractForChain } from "../lib/chains";

// =============================================================================
// Component
// =============================================================================

export function RFAComponent({
    open,
    onOpenChange,
    manowarId,
    manowarTitle,
    onSuccess,
}: RFAComponentProps) {
    const { toast } = useToast();
    const wallet = useActiveWallet();
    const account = useActiveAccount();
    const { mutateAsync: sendTransaction, isPending } = useSendTransaction();
    const { paymentChainId } = useChain();

    const [step, setStep] = useState<"form" | "approving" | "creating">("form");

    const form = useForm<RFAFormValues>({
        resolver: zodResolver(rfaFormSchema),
        defaultValues: {
            description: "",
            category: "",
            offerAmount: RFA_BOUNTY_LIMITS.DEFAULT_BOUNTY,
        },
    });

    const offerAmount = form.watch("offerAmount");
    const category = form.watch("category");

    // Calculate bounty breakdown
    const bountyBreakdown = useMemo(() => {
        const basic = RFA_BOUNTY_LIMITS.BASIC_BOUNTY;
        const bonus = Math.max(0, offerAmount - basic);
        return { basic, bonus };
    }, [offerAmount]);

    // Get category label
    const categoryLabel = useMemo(() => {
        return RFA_CATEGORIES.find(c => c.id === category)?.label || "";
    }, [category]);

    // Reset form when dialog closes
    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen) {
            form.reset();
            setStep("form");
        }
        onOpenChange(isOpen);
    };

    // Handle form submission
    const onSubmit = async (values: RFAFormValues) => {
        if (!wallet || !account) {
            toast({
                title: "Wallet Not Connected",
                description: "Please connect your wallet to create an RFA",
                variant: "destructive",
            });
            return;
        }

        try {
            const rfaContract = getRFAContract();
            const usdcContract = getUsdcContractForChain(paymentChainId);
            const rfaAddress = getContractAddress("RFA");

            // Convert offer amount to USDC wei (6 decimals)
            const offerAmountWei = usdcToWei(values.offerAmount);

            // Encode category as bytes32 skill
            const requiredSkills = [encodeSkillAsBytes32(values.category)];

            // Generate title from category
            const title = `${categoryLabel} Agent Request`;

            // Step 1: Check and approve USDC
            setStep("approving");

            // Check current allowance
            const currentAllowance = await readContract({
                contract: usdcContract,
                method: "function allowance(address owner, address spender) view returns (uint256)",
                params: [account.address, rfaAddress],
            }) as bigint;

            if (currentAllowance < offerAmountWei) {
                // Need approval
                const approvalTx = prepareContractCall({
                    contract: usdcContract,
                    method: "function approve(address spender, uint256 amount) returns (bool)",
                    params: [rfaAddress, offerAmountWei],
                });
                await sendTransaction(approvalTx);
            }

            // Step 2: Create RFA
            setStep("creating");

            const createTx = prepareContractCall({
                contract: rfaContract,
                method: "function createRFA(uint256 manowarId, string title, string description, bytes32[] requiredSkills, uint256 offerAmount) returns (uint256 rfaId)",
                params: [
                    BigInt(manowarId),
                    title,
                    values.description,
                    requiredSkills,
                    offerAmountWei,
                ],
            });

            const result = await sendTransaction(createTx);

            toast({
                title: "RFA Created!",
                description: (
                    <div className="space-y-1">
                        <p>Agent request published with ${values.offerAmount.toFixed(2)} USDC bounty.</p>
                        <p className="text-xs text-muted-foreground">
                            Bounty hunters can now submit agents for your request.
                        </p>
                    </div>
                ),
            });

            // Reset and close
            form.reset();
            setStep("form");
            onOpenChange(false);

            // Call success callback (RFA ID would come from event, for now just signal success)
            onSuccess?.(0);

        } catch (error) {
            console.error("RFA creation error:", error);
            setStep("form");
            toast({
                title: "Failed to Create RFA",
                description: error instanceof Error ? error.message : "Unknown error occurred",
                variant: "destructive",
            });
        }
    };

    const isProcessing = step !== "form" || isPending;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-lg bg-card border-cyan-500/30">
                <DialogHeader>
                    <DialogTitle className="font-display text-lg flex items-center gap-2">
                        <FileSearch className="w-5 h-5 text-cyan-400" />
                        Request an Agent
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                        Create a bounty request for a missing agent in your Manowar workflow.
                        {manowarTitle && (
                            <span className="block mt-1 font-mono text-cyan-400">
                                For: {manowarTitle}
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
                        {/* Description */}
                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-mono text-muted-foreground">
                                        WHAT DO YOU NEED?
                                    </FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Describe the agent you need in plain language. What should it do? What capabilities does it need?"
                                            className="bg-background/50 border-sidebar-border resize-none min-h-[100px]"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription className="text-[10px]">
                                        Be specific about the agent's purpose and required capabilities.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Category */}
                        <FormField
                            control={form.control}
                            name="category"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-mono text-muted-foreground">
                                        CATEGORY
                                    </FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="bg-background/50 border-sidebar-border">
                                                <SelectValue placeholder="Select agent category" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {RFA_CATEGORIES.map((cat) => (
                                                <SelectItem key={cat.id} value={cat.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{cat.label}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {cat.description}
                                                        </span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Offer Amount */}
                        <FormField
                            control={form.control}
                            name="offerAmount"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                                        <DollarSign className="w-3 h-3" />
                                        BOUNTY AMOUNT (USDC)
                                    </FormLabel>
                                    <FormControl>
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-4">
                                                <Slider
                                                    min={RFA_BOUNTY_LIMITS.MIN_BOUNTY}
                                                    max={RFA_BOUNTY_LIMITS.MAX_BOUNTY}
                                                    step={0.05}
                                                    value={[field.value]}
                                                    onValueChange={([val]) => field.onChange(val)}
                                                    className="flex-1"
                                                />
                                                <div className="w-20">
                                                    <Input
                                                        type="number"
                                                        step="0.05"
                                                        min={RFA_BOUNTY_LIMITS.MIN_BOUNTY}
                                                        max={RFA_BOUNTY_LIMITS.MAX_BOUNTY}
                                                        value={field.value}
                                                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                                        className="bg-background/50 border-sidebar-border text-center font-mono"
                                                    />
                                                </div>
                                            </div>

                                            {/* Bounty breakdown */}
                                            <div className="p-3 rounded-sm bg-cyan-500/5 border border-cyan-500/20">
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="text-muted-foreground">Basic bounty:</span>
                                                    <span className="font-mono text-green-400">
                                                        ${bountyBreakdown.basic.toFixed(2)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between text-xs mt-1">
                                                    <span className="text-muted-foreground">README bonus (optional):</span>
                                                    <span className="font-mono text-cyan-400">
                                                        +${bountyBreakdown.bonus.toFixed(2)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between text-sm font-bold mt-2 pt-2 border-t border-sidebar-border">
                                                    <span>Total escrowed:</span>
                                                    <span className="font-mono text-cyan-400">
                                                        ${field.value.toFixed(2)} USDC
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </FormControl>
                                    <FormDescription className="text-[10px] flex items-start gap-1">
                                        <Info className="w-3 h-3 mt-0.5 shrink-0" />
                                        <span>
                                            Basic bounty is paid for filling the agent form.
                                            README bonus is earned when the bounty hunter provides quality documentation.
                                        </span>
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Wallet status */}
                        <div className="pt-2">
                            {!wallet && (
                                <div className="flex items-center gap-2 p-2 rounded-sm bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-xs">
                                    <AlertCircle className="w-3 h-3" />
                                    Connect wallet to create RFA
                                </div>
                            )}
                            {wallet && account && (
                                <div className="flex items-center gap-2 p-2 rounded-sm bg-green-500/10 border border-green-500/30 text-green-200 text-xs">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span className="font-mono">{account.address.slice(0, 6)}...{account.address.slice(-4)}</span>
                                    <span className="text-green-300/70">• Gas sponsored</span>
                                </div>
                            )}
                        </div>
                    </form>
                </Form>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isProcessing}>
                        Cancel
                    </Button>
                    <Button
                        onClick={form.handleSubmit(onSubmit)}
                        disabled={!wallet || isProcessing}
                        className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                {step === "approving" ? "Approving USDC..." : "Creating RFA..."}
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Create Request (${offerAmount.toFixed(2)})
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
