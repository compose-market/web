/**
 * Warp Agent Form Component
 * Pre-fills data from external agent and calls Warp contract to mint
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRightLeft,
  Upload,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  DollarSign,
  Globe,
  User,
  ArrowLeft,
  RefreshCw,
  Check,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveAccount, useSendTransaction, useAdminWallet } from "thirdweb/react";
import { prepareContractCall } from "thirdweb";
import { submitCronosTransaction, encodeContractCall } from "@/lib/cronos/aa";
import {
  getWarpContractForChain,
  usdcToWei,
  computeExternalAgentHash,
  deriveAgentWalletAddress,
  getContractAddressForChain,
} from "@/lib/contracts";
import {
  uploadAgentAvatar,
  uploadAgentCard,
  getIpfsUri,
  getIpfsUrl,
  fileToDataUrl,
  isPinataConfigured,
  type AgentCard,
} from "@/lib/pinata";
import { CHAIN_IDS, CHAIN_CONFIG, isCronosChain } from "@/lib/chains";
import { useChain } from "@/contexts/ChainContext";
import { AGENT_REGISTRIES, type AgentRegistryId } from "@/lib/agents";

// =============================================================================
// Types
// =============================================================================

export interface WarpAgentData {
  id: string;
  address: string;
  name: string;
  description: string;
  registry: AgentRegistryId;
  avatarUrl?: string | null;
  protocols?: Array<{ name: string; version: string }>;
  tags?: string[];
  category?: string;
}

// =============================================================================
// Form Schema
// =============================================================================

const warpFormSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().min(10),
  licensePrice: z.string(),
  licenses: z.string().optional(),
  originalCreator: z.string().optional(),
});

type WarpFormValues = z.infer<typeof warpFormSchema>;

// =============================================================================
// Component
// =============================================================================

interface WarpAgentFormProps {
  agent: WarpAgentData;
  onBack: () => void;
}

export function WarpAgentForm({ agent, onBack }: WarpAgentFormProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const account = useActiveAccount();
  const adminWallet = useAdminWallet();
  const { paymentChainId } = useChain();
  const { mutateAsync: sendTransaction, isPending: isSending } = useSendTransaction();

  // Avatar upload state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(agent.avatarUrl || null);
  const [mintStep, setMintStep] = useState<"idle" | "uploading" | "minting" | "done">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Avatar generation state
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [generationCount, setGenerationCount] = useState(0);
  const [generatedAvatarUrl, setGeneratedAvatarUrl] = useState<string | null>(null);
  const MAX_GENERATIONS = 3;

  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingValues, setPendingValues] = useState<WarpFormValues | null>(null);

  const registryInfo = AGENT_REGISTRIES[agent.registry];
  const initials = agent.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const form = useForm<WarpFormValues>({
    resolver: zodResolver(warpFormSchema),
    defaultValues: {
      name: agent.name,
      description: agent.description || "",
      licensePrice: "0.01",
      licenses: "",
      originalCreator: "",
    },
  });

  // Handle avatar file selection
  const handleAvatarSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid file type",
          description: "Please select an image file",
          variant: "destructive",
        });
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Maximum file size is 5MB",
          variant: "destructive",
        });
        return;
      }

      setAvatarFile(file);
      const dataUrl = await fileToDataUrl(file);
      setAvatarPreview(dataUrl);
      // Clear generated avatar state when user uploads their own
      setGeneratedAvatarUrl(null);
    },
    [toast]
  );

  // Handle AI avatar generation
  const API_URL = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");

  const handleGenerateAvatar = useCallback(async () => {
    // Check generation limit
    if (generationCount >= MAX_GENERATIONS) {
      toast({
        title: "Generation limit reached",
        description: `You can generate up to ${MAX_GENERATIONS} avatars per session. Upload your own image instead.`,
        variant: "destructive",
      });
      return;
    }

    // Validate name and description
    const title = form.getValues("name");
    const description = form.getValues("description");

    console.log("[generate-avatar] Form values:", { title, description });

    if (!title?.trim()) {
      toast({
        title: "Name required",
        description: "You should add Name + Description before generating an avatar",
        variant: "destructive",
      });
      return;
    }

    if (!description?.trim()) {
      toast({
        title: "Description required",
        description: "You should add Name + Description before generating an avatar",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingAvatar(true);
    try {
      const response = await fetch(`${API_URL}/api/generate-avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Generation failed");
      }

      const { imageUrl } = await response.json();

      // Convert base64 data URL to File object for IPFS upload
      const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return new File([blob], filename, { type: blob.type });
      };

      const avatarFileName = `${title.replace(/\s+/g, "_")}_avatar.png`;
      const generatedFile = await dataUrlToFile(imageUrl, avatarFileName);

      setGeneratedAvatarUrl(imageUrl);
      setAvatarPreview(imageUrl);
      setAvatarFile(generatedFile); // SET the file for IPFS upload on warp!
      setGenerationCount(prev => prev + 1);

      toast({
        title: "Avatar generated!",
        description: `Generation ${generationCount + 1}/${MAX_GENERATIONS}`,
      });
    } catch (error) {
      console.error("[generate-avatar] Error:", error);
      toast({
        title: "Generation failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingAvatar(false);
    }
  }, [form, generationCount, toast, API_URL]);

  const handleAcceptAvatar = useCallback(() => {
    setGeneratedAvatarUrl(null);
    toast({
      title: "Avatar accepted",
      description: "Your AI-generated avatar is ready to use",
    });
  }, [toast]);

  const handleRegenerateAvatar = useCallback(() => {
    handleGenerateAvatar();
  }, [handleGenerateAvatar]);

  // Prepare transaction data for warping - returns tx data instead of setting state
  const prepareForWarp = async (values: WarpFormValues): Promise<{
    originalAgentHash: `0x${string}`;
    originalCreator: `0x${string}`;
    licenses: bigint;
    licensePrice: bigint;
    agentCardUri: string;
  } | null> => {
    if (!isPinataConfigured()) {
      toast({
        title: "IPFS not configured",
        description: "Pinata JWT is missing. Check environment variables.",
        variant: "destructive",
      });
      return null;
    }

    try {
      setMintStep("uploading");

      // 1. Upload avatar to IPFS (if provided)
      let avatarUri = "none";
      if (avatarFile) {
        const avatarCid = await uploadAgentAvatar(avatarFile, values.name);
        avatarUri = getIpfsUri(avatarCid);
      } else if (agent.avatarUrl) {
        // Use existing avatar URL if available
        avatarUri = agent.avatarUrl;
      }

      // 2. Compute external agent hash
      const originalAgentHash = computeExternalAgentHash(agent.registry, agent.address);
      const timestamp = Date.now();

      // 3. Derive wallet from hash + timestamp (timestamp makes wallet unique)
      const walletAddress = deriveAgentWalletAddress(originalAgentHash, timestamp);

      // 4. Build and upload Agent Card to IPFS
      const chainId = paymentChainId;

      const agentCard: AgentCard = {
        schemaVersion: "1.0.0",
        name: values.name,
        description: values.description,
        skills: agent.tags || [],
        image: avatarUri, // Standard NFT metadata field
        avatar: avatarUri, // Legacy field for backward compatibility
        dnaHash: originalAgentHash, // Use the external hash as DNA
        walletAddress, // Derived from hash + timestamp - source of truth
        walletTimestamp: timestamp, // Backend needs this to derive private key
        chain: chainId,
        model: "warped", // Warped agents use their original model
        licensePrice: usdcToWei(parseFloat(values.licensePrice)).toString(),
        licenses: values.licenses ? parseInt(values.licenses) : 0,
        cloneable: false, // Warped agents are not cloneable by default
        protocols: agent.protocols || [{ name: "manowar", version: "1.0" }],
        createdAt: new Date().toISOString(),
        creator: account?.address || "",
      };

      const cardCid = await uploadAgentCard(agentCard);
      // Use HTTPS gateway URL for Cronos (explorer doesn't resolve ipfs://), ipfs:// for others
      const agentCardUri = isCronosChain(chainId) ? getIpfsUrl(cardCid) : getIpfsUri(cardCid);

      // 5. Prepare transaction params
      const licensePrice = usdcToWei(parseFloat(values.licensePrice));
      const licenses = values.licenses ? BigInt(values.licenses) : BigInt(0);
      const originalCreator = (values.originalCreator?.trim() || "0x0000000000000000000000000000000000000000") as `0x${string}`;

      return {
        originalAgentHash,
        originalCreator,
        licenses,
        licensePrice,
        agentCardUri,
      };
    } catch (error) {
      console.error("Prepare error:", error);
      setMintStep("idle");
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload to IPFS",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleWarpSuccess = async (result: { transactionHash: string }) => {
    const chainId = paymentChainId;
    const values = form.getValues();

    toast({
      title: "Agent Warped Successfully!",
      description: (
        <div className="space-y-1">
          <p>{values.name} has been warped into the Manowar ecosystem.</p>
          <a
            href={`${CHAIN_CONFIG[chainId].explorer}/tx/${result.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:underline text-xs flex items-center gap-1"
          >
            View transaction <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      ),
    });

    // Clear session storage and redirect
    sessionStorage.removeItem("warpAgent");
    setMintStep("done");

    // Redirect to my-assets after short delay
    setTimeout(() => {
      setLocation("/my-assets");
    }, 2000);
  };

  const handleWarpError = (error: Error) => {
    console.error("Warp error:", error);
    setMintStep("idle");
    toast({
      title: "Warping Failed",
      description: error.message || "Unknown error occurred",
      variant: "destructive",
    });
  };

  // Show confirmation before warping
  const onSubmit: SubmitHandler<WarpFormValues> = async (values) => {
    setPendingValues(values);
    setShowConfirmDialog(true);
  };

  // Handle confirmed warp - single confirmation triggers both IPFS upload and on-chain tx
  const handleConfirmedWarp = async () => {
    if (!pendingValues) return;
    setShowConfirmDialog(false);

    // Step 1: Upload to IPFS and prepare transaction data
    const txData = await prepareForWarp(pendingValues);
    if (!txData) return; // Upload failed

    // Step 2: Immediately trigger on-chain transaction (no second click needed)
    try {
      setMintStep("minting");

      // Chain-aware transaction: Cronos uses our AA Paymaster, others use ThirdWeb
      if (isCronosChain(paymentChainId) && account) {
        // Cronos: Use our custom AA Paymaster flow
        const warpData = encodeContractCall({
          abi: [
            {
              type: "function",
              name: "warpAgent",
              inputs: [
                { type: "bytes32", name: "originalAgentHash" },
                { type: "address", name: "originalCreator" },
                { type: "uint256", name: "licenses" },
                { type: "uint256", name: "licensePrice" },
                { type: "string", name: "agentCardUri" },
              ],
              outputs: [{ type: "uint256", name: "warpedAgentId" }],
            },
          ],
          functionName: "warpAgent",
          args: [
            txData.originalAgentHash,
            txData.originalCreator,
            txData.licenses,
            txData.licensePrice,
            txData.agentCardUri,
          ],
        });

        const warpContractAddress = getContractAddressForChain("Warp", paymentChainId);

        // Get admin wallet for signing (Smart Accounts return wrapped EIP-1271 signatures)
        const adminAddress = adminWallet?.getAccount()?.address as `0x${string}` | undefined;
        const adminAccount = adminWallet?.getAccount();

        const result = await submitCronosTransaction({
          account,
          to: warpContractAddress as `0x${string}`,
          data: warpData as `0x${string}`,
          value: BigInt(0),
          chainId: paymentChainId,
          adminAddress,
          adminWallet: adminAccount,
        });

        if (!result.success) {
          throw new Error(result.error || "Cronos transaction failed");
        }

        await handleWarpSuccess({ transactionHash: result.txHash! });
      } else {
        // Fuji/other chains: Use ThirdWeb sendTransaction with AA
        const contract = getWarpContractForChain(paymentChainId);
        const transaction = prepareContractCall({
          contract,
          method:
            "function warpAgent(bytes32 originalAgentHash, address originalCreator, uint256 licenses, uint256 licensePrice, string agentCardUri) returns (uint256 warpedAgentId)",
          params: [
            txData.originalAgentHash,
            txData.originalCreator,
            txData.licenses,
            txData.licensePrice,
            txData.agentCardUri,
          ],
        });

        // Send transaction (gasless sponsorship configured on ThirdWeb)
        const result = await sendTransaction(transaction);

        // Handle success
        await handleWarpSuccess({ transactionHash: result.transactionHash });
      }
    } catch (error) {
      handleWarpError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const isProcessing = mintStep !== "idle" && mintStep !== "done";

  return (
    <div className="max-w-3xl mx-auto pb-20">
      {/* Page Header */}
      <div className="mb-8 space-y-2 border-b border-sidebar-border pb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-2"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Choice
        </Button>
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-display font-bold text-white">
            <span className="text-fuchsia-500 mr-2">//</span>
            WARP AGENT
          </h1>
          <div className="hidden md:flex h-px w-32 bg-gradient-to-r from-fuchsia-500 to-transparent"></div>
        </div>
        <p className="text-muted-foreground font-mono text-sm">
          Port an external agent into the Manowar ecosystem with on-chain identity.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Original Agent Info */}
              <Card className="glass-panel border-fuchsia-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-bold font-display text-fuchsia-400">
                    <Globe className="w-5 h-5" />
                    ORIGINAL AGENT
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start gap-4 p-4 rounded-sm bg-background/50 border border-sidebar-border">
                    <Avatar className="w-12 h-12 border-2 border-fuchsia-500/30">
                      <AvatarImage src={agent.avatarUrl || undefined} alt={agent.name} />
                      <AvatarFallback className="bg-fuchsia-500/10 text-fuchsia-400 font-mono text-sm">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display font-bold text-foreground">{agent.name}</h3>
                      <p className="text-xs font-mono text-muted-foreground truncate">
                        {agent.address}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10"
                        >
                          {registryInfo?.name || agent.registry}
                        </Badge>
                        {agent.category && (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono border-sidebar-border"
                          >
                            {agent.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {agent.avatarUrl && (
                      <a
                        href={`https://agentverse.ai/agents/details/${agent.address}/profile`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-fuchsia-400"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Warped Identity */}
              <Card className="glass-panel border-cyan-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-bold font-display text-cyan-400">
                    <ArrowRightLeft className="w-5 h-5" />
                    WARPED IDENTITY
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-foreground">Display Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Alpha Sniper V1"
                            {...field}
                            className="bg-background/50 font-mono border-sidebar-border focus:border-cyan-500"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-foreground">Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe what this agent does..."
                            className="resize-none bg-background/50 min-h-[100px] border-sidebar-border focus:border-cyan-500"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Pricing & Royalties */}
              <Card className="glass-panel border-green-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-bold font-display text-green-400">
                    <DollarSign className="w-5 h-5" />
                    PRICING & ROYALTIES
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="licensePrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-foreground">
                            License Price (USDC)
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.001"
                              {...field}
                              className="bg-background/50 font-mono border-sidebar-border focus:border-green-500"
                            />
                          </FormControl>
                          <FormDescription className="text-muted-foreground text-xs">
                            x402 payment per license
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="licenses"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-foreground">License Supply Cap</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="∞ (leave empty)"
                              {...field}
                              className="bg-background/50 font-mono border-sidebar-border focus:border-green-500"
                            />
                          </FormControl>
                          <FormDescription className="text-muted-foreground text-xs">
                            Max licenses (empty = infinite)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="originalCreator"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-foreground flex items-center gap-2">
                          <User className="w-4 h-4" />
                          Original Creator Address
                          <span className="text-muted-foreground text-xs">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="0x..."
                            {...field}
                            className="bg-background/50 font-mono border-sidebar-border focus:border-green-500"
                          />
                        </FormControl>
                        <FormDescription className="text-muted-foreground text-xs">
                          If known, original creator receives 10% royalties. Leave empty if unknown
                          (treasury holds for up to 1 year).
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Royalty Split Info */}
                  <div className="p-3 rounded-sm bg-green-500/10 border border-green-500/20 text-xs font-mono">
                    <p className="text-green-400 font-bold mb-2">Royalty Distribution:</p>
                    <div className="space-y-1 text-muted-foreground">
                      <p>• Original Creator: 10%</p>
                      <p>• Treasury: 10%</p>
                      <p>• You (Warper): 80%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Mint Progress */}
              {mintStep === "uploading" && (
                <Card className="glass-panel border-cyan-500/50">
                  <CardContent className="py-4">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                      <div>
                        <p className="font-mono text-sm text-foreground">Uploading to IPFS...</p>
                        <p className="text-xs text-muted-foreground">
                          Storing agent card metadata
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                size="lg"
                disabled={!account || isProcessing}
                className="w-full bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white font-bold font-mono hover:from-fuchsia-400 hover:to-cyan-400 h-14 text-lg shadow-[0_0_20px_-5px_hsl(var(--primary))] tracking-wider disabled:opacity-50"
              >
                {mintStep === "uploading" ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    UPLOADING...
                  </>
                ) : mintStep === "minting" ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    WARPING...
                  </>
                ) : !account ? (
                  "SIGN IN TO WARP"
                ) : (
                  <>
                    <ArrowRightLeft className="w-5 h-5 mr-2" />
                    WARP INTO MANOWAR
                  </>
                )}
              </Button>
            </form>
          </Form>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          {/* Avatar Upload */}
          <div className="glass-panel p-6 rounded-sm space-y-4 border border-cyan-500/20 corner-decoration">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarSelect}
              className="hidden"
            />
            {/* Avatar canvas with generate button overlay */}
            <div className="relative w-full aspect-square">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-full rounded-sm bg-background/50 border border-sidebar-border border-dashed flex flex-col items-center justify-center text-muted-foreground cursor-pointer hover:border-cyan-500 hover:text-cyan-400 transition-colors overflow-hidden"
              >
                {isGeneratingAvatar ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                    <span className="text-xs font-mono text-cyan-400">GENERATING...</span>
                  </div>
                ) : avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="Avatar preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <>
                    <Upload className="w-8 h-8 mb-2" />
                    <span className="text-xs font-mono">UPLOAD AVATAR</span>
                    <span className="text-[10px] font-mono text-muted-foreground/70 mt-1">
                      (or use original)
                    </span>
                  </>
                )}
              </button>

              {/* Generate button overlay (bottom-right corner) */}
              {!isGeneratingAvatar && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGenerateAvatar();
                        }}
                        disabled={generationCount >= MAX_GENERATIONS}
                        className={`absolute bottom-2 right-2 w-10 h-10 rounded-full flex items-center justify-center transition-all ${generationCount >= MAX_GENERATIONS
                          ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                          : "bg-fuchsia-500/80 hover:bg-fuchsia-500 text-white shadow-lg hover:shadow-fuchsia-500/30"
                          }`}
                      >
                        <Sparkles className="w-5 h-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {generationCount >= MAX_GENERATIONS
                        ? `Limit reached (${MAX_GENERATIONS}/${MAX_GENERATIONS})`
                        : `Generate Avatar (${generationCount}/${MAX_GENERATIONS})`}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>

            {/* Accept/Regenerate controls for generated avatars */}
            {generatedAvatarUrl && !isGeneratingAvatar && (
              <div className="flex gap-2 justify-center">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAcceptAvatar}
                        className="border-green-500/50 text-green-400 hover:bg-green-500/10 hover:text-green-300"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Accept Avatar</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRegenerateAvatar}
                        disabled={generationCount >= MAX_GENERATIONS}
                        className={`${generationCount >= MAX_GENERATIONS
                          ? "border-muted text-muted-foreground cursor-not-allowed"
                          : "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
                          }`}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {generationCount >= MAX_GENERATIONS
                        ? `Limit reached (${MAX_GENERATIONS}/${MAX_GENERATIONS})`
                        : `Regenerate (${generationCount}/${MAX_GENERATIONS})`}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            {/* Remove/Reset avatar button */}
            {avatarPreview && avatarFile && !generatedAvatarUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAvatarFile(null);
                  setAvatarPreview(agent.avatarUrl || null);
                  setGeneratedAvatarUrl(null);
                }}
                className="w-full text-xs text-muted-foreground"
              >
                Use original avatar
              </Button>
            )}
            <div className="space-y-2">
              <h3 className="font-bold font-display text-white">Warp Info</h3>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground font-mono">Network</span>
                <span className="font-mono text-cyan-400">{CHAIN_CONFIG[paymentChainId]?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground font-mono">Contract</span>
                <span className="font-mono text-cyan-400">Warp</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground font-mono">Storage</span>
                <span className="font-mono text-cyan-400">Pinata IPFS</span>
              </div>
            </div>
          </div>

          {/* Account Status */}
          <div
            className={`p-4 rounded-sm border text-sm ${account
              ? "bg-green-500/10 border-green-500/20 text-green-200"
              : "bg-yellow-500/10 border-yellow-500/20 text-yellow-200"
              }`}
          >
            {account ? (
              <>
                <CheckCircle2 className="w-5 h-5 mb-2 text-green-400" />
                <p>
                  Signed in:{" "}
                  <span className="font-mono">
                    {account.address.slice(0, 6)}...{account.address.slice(-4)}
                  </span>
                </p>
                <p className="text-xs text-green-300/70 mt-1">Gas sponsored • No fees</p>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 mb-2 text-yellow-400" />
                <p>Sign in with email, social, or wallet to warp.</p>
              </>
            )}
          </div>

          <div className="p-4 rounded-sm bg-fuchsia-500/10 border border-fuchsia-500/20 text-sm text-fuchsia-200">
            <ArrowRightLeft className="w-5 h-5 mb-2 text-fuchsia-400" />
            <p>
              Warping brings external agents into the Manowar ecosystem with an on-chain ERC8004
              identity. You'll earn 80% of all usage royalties, whereas 10% will go to the original creator.
            </p>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="bg-background border-sidebar-border max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              <ArrowRightLeft className="w-5 h-5 inline mr-2 text-fuchsia-400" />
              Confirm Warp
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Review the warp details before submitting to the blockchain.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingValues && (
            <div className="space-y-3 py-4 border-y border-sidebar-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Original Agent</span>
                <span className="font-mono text-fuchsia-400">{agent.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Registry</span>
                <span className="font-mono text-foreground">
                  {registryInfo?.name || agent.registry}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Warped Name</span>
                <span className="font-mono text-cyan-400">{pendingValues.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">License Price</span>
                <span className="font-mono text-green-400">${pendingValues.licensePrice} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">License Supply</span>
                <span className="font-mono">{pendingValues.licenses || "∞ Unlimited"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Your Royalty</span>
                <span className="font-mono text-fuchsia-400">80%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Network</span>
                <span className="font-mono text-cyan-400">{CHAIN_CONFIG[paymentChainId]?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gas</span>
                <span className="font-mono text-green-400">Sponsored (Free)</span>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="border-sidebar-border">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmedWarp}
              className="bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white hover:from-fuchsia-400 hover:to-cyan-400 font-bold"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Confirm & Warp
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
