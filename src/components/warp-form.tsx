/**
 * Warp Agent Form Component
 * Pre-fills data from external agent and calls Warp contract to mint
 */
import { useState, useRef, useCallback, useMemo } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
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
import { sdk } from "@/lib/sdk";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AgentCard as AgentPreviewCard } from "@/components/identikit";
import { Pockets } from "@/components/control";
import type { OnchainAgent } from "@/hooks/use-onchain";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alerts";
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
  ChevronDown,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import {
  getWarpContractForChain,
  prepareWarpAgentCall,
  usdcToWei,
  computeExternalAgentHash,
  deriveAgentWalletAddress,
} from "@/lib/contracts";
import {
  uploadAgentAvatar,
  uploadAgentCard,
  getIpfsUri,
  fileToDataUrl,
  type AgentCard,
} from "@/lib/pinata";
import { evmChainId, getChainConfigByNetwork, isEvmNetwork } from "@/lib/chains";
import { useChain } from "@/contexts/Network";
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
  role: z.enum(["executor", "coordinator"]),
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
  const { mutateAsync: sendTransaction } = useSendTransaction();
  const { paymentNetwork } = useChain();
  const evmPaymentNetwork = isEvmNetwork(paymentNetwork) ? paymentNetwork : null;
  const paymentChainId = evmPaymentNetwork ? evmChainId(evmPaymentNetwork) : null;
  const paymentNetworkConfig = evmPaymentNetwork ? getChainConfigByNetwork(evmPaymentNetwork) : undefined;
  const assetSymbol = paymentNetworkConfig?.asset ?? "USDC";

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

  const [builderPocket, setBuilderPocket] = useState<"main" | "side">("main");
  const [activeSection, setActiveSection] = useState<"source" | "identity" | "financials" | null>("identity");
  const [previewMode, setPreviewMode] = useState<"identikit" | "market">("identikit");

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
      role: "executor",
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
      const response = await sdk.fetch("/api/generate-avatar", {
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
  }, [form, generationCount, toast]);

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
    if (!evmPaymentNetwork || !paymentChainId) {
      toast({
        title: "EVM network required",
        description: "Switch to an EVM network to warp external agents.",
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
      const agentCard: AgentCard = {
        schemaVersion: "1.0.0",
        name: values.name,
        description: values.description,
        role: values.role,
        skills: agent.tags || [],
        x402: true,
        x402Support: true,
        image: avatarUri, // Standard NFT metadata field
        avatar: avatarUri, // Legacy field for backward compatibility
        dnaHash: originalAgentHash, // Use the external hash as DNA
        walletAddress, // Derived from hash + timestamp - source of truth
        walletTimestamp: timestamp, // Backend needs this to derive private key
        network: evmPaymentNetwork,
        model: "warped", // Warped agents use their original model
        licensePrice: usdcToWei(parseFloat(values.licensePrice)).toString(),
        creatorFee: 1,
        licenses: values.licenses ? parseInt(values.licenses) : 0,
        cloneable: false, // Warped agents are not cloneable by default
        protocols: agent.protocols || [{ name: "manowar", version: "1.0" }],
        createdAt: new Date().toISOString(),
        creator: account?.address || "",
      };

      const cardCid = await uploadAgentCard(agentCard);
      const agentCardUri = getIpfsUri(cardCid);

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
          <p>{values.name} is now live on Compose.Market.</p>
          <a
            href={`${paymentNetworkConfig?.explorer}/tx/${result.transactionHash}`}
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

    // Redirect to profile after short delay
    setTimeout(() => {
      setLocation("/profile");
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

      if (!account) {
        throw new Error("Wallet account unavailable");
      }
      if (!paymentChainId) {
        throw new Error("Switch to an EVM network to warp external agents");
      }

      const contract = getWarpContractForChain(paymentChainId);
      const transaction = prepareWarpAgentCall(contract, txData);
      const result = await sendTransaction(transaction);
      await handleWarpSuccess({ transactionHash: result.transactionHash });
    } catch (error) {
      handleWarpError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const isProcessing = mintStep !== "idle" && mintStep !== "done";
  const watched = form.watch();
  const previewAgent = useMemo<OnchainAgent>(() => {
    const supply = watched.licenses ? Math.max(0, Number.parseInt(watched.licenses, 10) || 0) : 0;
    const price = watched.licensePrice?.trim() || "0";
    return {
      id: 0,
      dnaHash: "",
      walletAddress: account?.address ?? "",
      network: evmPaymentNetwork ?? paymentNetwork ?? undefined,
      licenses: supply,
      licensesMinted: 0,
      licensesAvailable: supply,
      licensePrice: price,
      licensePriceFormatted: `$${price}`,
      creatorFee: 10,
      creator: account?.address ?? "",
      cloneable: false,
      isClone: false,
      parentAgentId: 0,
      agentCardUri: "",
      isWarped: true,
      metadata: {
        schemaVersion: "1.0.0",
        name: watched.name.trim() || agent.name,
        description: watched.description.trim() || agent.description,
        role: watched.role,
        skills: agent.tags ?? [],
        x402: true,
        x402Support: true,
        avatarUrl: avatarPreview ?? undefined,
        dnaHash: "",
        walletAddress: account?.address ?? "",
        network: evmPaymentNetwork ?? paymentNetwork ?? "",
        model: registryInfo?.name || agent.registry,
        framework: "other",
        licensePrice: price,
        creatorFee: 10,
        licenses: supply,
        cloneable: false,
        protocols: [{ name: "x402", version: "1.0" }],
        connectors: [],
        createdAt: "",
      },
    };
  }, [account?.address, agent.description, agent.name, agent.registry, agent.tags, avatarPreview, evmPaymentNetwork, registryInfo?.name, watched.description, watched.licensePrice, watched.licenses, watched.name, watched.role]);

  return (
    <div className="cm-create-page">
      <div className="cm-control-rail cm-control-rail--compact cm-control-rail--inline">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm"
        >
          <ArrowLeft className="w-3.5 h-3.5 sm:mr-1" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="cm-control-rail__main">
          <h1 className="cm-page-header__title" data-route-heading>
            <span className="text-fuchsia-500 mr-2 shrink-0">//</span>
            <span className="truncate">WARP AGENT</span>
          </h1>
        </div>

        <div className="cm-control-rail__actions">
          <Pockets
            value={builderPocket}
            label="Warp view"
            className="cm-pocket-bar--split"
            onChange={setBuilderPocket}
            options={[
              { value: "main", label: "Edit" },
              { value: "side", label: "Preview" },
            ]}
          />
          <span className="cm-badge cm-badge--accent cm-create-status-badge">
            {paymentNetworkConfig?.name || "EVM"}
          </span>
        </div>
      </div>

      <div className="cm-split" data-pocket={builderPocket}>
        <div className="cm-split__main">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="cm-create-form">
              <div className="cm-create-sections-stage">
                <div className="cm-create-sections">
                  {/* Block 1: Source Agent */}
                  <section
                    className="cm-builder-panel cm-create-section"
                    data-tone="fuchsia"
                    data-open={activeSection === "source" ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="cm-create-section__trigger"
                      aria-expanded={activeSection === "source"}
                      onClick={() => setActiveSection(activeSection === "source" ? null : "source")}
                    >
                      <span className="cm-create-section__title">
                        <Globe />
                        <span>Source Agent</span>
                      </span>
                      <span className="cm-create-section__right">
                        {activeSection !== "source" ? (
                          <span className="cm-create-section__summary">
                            {agent.name} · {registryInfo?.name || agent.registry}
                          </span>
                        ) : null}
                        <ChevronDown className="cm-create-section__chevron" aria-hidden="true" />
                      </span>
                    </button>
                    <div className="cm-create-section__fold">
                      <div className="cm-create-section__content">
                        <div className="cm-create-origin">
                          <Avatar className="w-12 h-12 border border-fuchsia-500/30 shrink-0">
                            <AvatarImage src={agent.avatarUrl || undefined} alt={agent.name} />
                            <AvatarFallback className="bg-fuchsia-500/10 text-fuchsia-400 font-mono text-sm">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-display font-bold text-foreground truncate">{agent.name}</h3>
                            <p className="text-xs font-mono text-muted-foreground truncate">{agent.address}</p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <Badge variant="outline" className="text-xs font-mono border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10">
                                {registryInfo?.name || agent.registry}
                              </Badge>
                              {agent.category && (
                                <Badge variant="outline" className="text-xs font-mono">
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
                              aria-label="Open source profile"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Block 2: Warped Identity */}
                  <section
                    className="cm-builder-panel cm-create-section"
                    data-open={activeSection === "identity" ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="cm-create-section__trigger"
                      aria-expanded={activeSection === "identity"}
                      onClick={() => setActiveSection(activeSection === "identity" ? null : "identity")}
                    >
                      <span className="cm-create-section__title">
                        <ArrowRightLeft />
                        <span>Identity</span>
                      </span>
                      <span className="cm-create-section__right">
                        {activeSection !== "identity" ? (
                          <span className="cm-create-section__summary">
                            {watched.name.trim() || agent.name}
                          </span>
                        ) : null}
                        <ChevronDown className="cm-create-section__chevron" aria-hidden="true" />
                      </span>
                    </button>

                    <div className="cm-create-section__fold">
                      <div className="cm-create-section__content">
                        <div className="cm-create-identity">
                          <div className="cm-create-fields">
                            <FormField
                              control={form.control}
                              name="name"
                              render={({ field }) => (
                                <FormItem className="cm-field">
                                  <FormLabel>Display Name</FormLabel>
                                  <FormControl>
                                    <Input placeholder="e.g. Research Assistant" {...field} className="cm-form-input" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="cm-create-avatar">
                            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
                            <div className="cm-create-avatar__box">
                              <button type="button" onClick={() => fileInputRef.current?.click()} className="cm-create-avatar__drop">
                                {isGeneratingAvatar ? (
                                  <>
                                    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                                    <span>Generating…</span>
                                  </>
                                ) : avatarPreview ? (
                                  <img src={avatarPreview} alt="Avatar preview" />
                                ) : (
                                  <>
                                    <Upload className="w-4 h-4" />
                                    <span>Avatar</span>
                                  </>
                                )}
                              </button>
                              {!isGeneratingAvatar && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleGenerateAvatar();
                                        }}
                                        disabled={generationCount >= MAX_GENERATIONS}
                                        className="cm-create-avatar__gen"
                                        aria-label="Generate avatar with AI"
                                      >
                                        <Sparkles className="w-3.5 h-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {generationCount >= MAX_GENERATIONS
                                        ? `Limit (${MAX_GENERATIONS}/${MAX_GENERATIONS})`
                                        : `Generate avatar (${generationCount}/${MAX_GENERATIONS})`}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>

                            {generatedAvatarUrl && !isGeneratingAvatar && (
                              <div className="cm-create-avatar__controls">
                                <Button type="button" variant="outline" size="sm" onClick={handleAcceptAvatar} className="cm-shell-button cm-shell-button--secondary cm-shell-button--sm">
                                  <Check className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={handleRegenerateAvatar}
                                  disabled={generationCount >= MAX_GENERATIONS}
                                  className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            )}

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
                                className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm w-full"
                              >
                                Use original
                              </Button>
                            )}
                          </div>
                        </div>

                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem className="cm-field">
                              <FormLabel>Description</FormLabel>
                              <FormControl>
                                <Textarea placeholder="Describe what this agent helps users do..." rows={3} className="cm-form-textarea" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </section>

                  {/* Block 3: Pricing & Royalties */}
                  <section
                    className="cm-builder-panel cm-create-section"
                    data-tone="green"
                    data-open={activeSection === "financials" ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="cm-create-section__trigger"
                      aria-expanded={activeSection === "financials"}
                      onClick={() => setActiveSection(activeSection === "financials" ? null : "financials")}
                    >
                      <span className="cm-create-section__title">
                        <DollarSign />
                        <span>Pricing & Royalties</span>
                      </span>
                      <span className="cm-create-section__right">
                        {activeSection !== "financials" ? (
                          <span className="cm-create-section__summary">
                            ${watched.licensePrice || "0"} · 80% share · {watched.licenses ? watched.licenses : "∞"}
                          </span>
                        ) : null}
                        <ChevronDown className="cm-create-section__chevron" aria-hidden="true" />
                      </span>
                    </button>

                    <div className="cm-create-section__fold">
                      <div className="cm-create-section__content">
                        <div className="cm-create-pricing-grid">
                          <FormField
                            control={form.control}
                            name="licensePrice"
                            render={({ field }) => (
                              <FormItem className="cm-field">
                                <FormLabel>Price (USDC)</FormLabel>
                                <FormControl>
                                  <Input type="number" step="0.001" {...field} className="cm-form-input font-mono" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="licenses"
                            render={({ field }) => (
                              <FormItem className="cm-field">
                                <FormLabel>Supply Cap</FormLabel>
                                <FormControl>
                                  <Input type="number" placeholder="∞ Unlimited" {...field} className="cm-form-input font-mono" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="originalCreator"
                            render={({ field }) => (
                              <FormItem className="cm-field">
                                <FormLabel>Original Creator</FormLabel>
                                <FormControl>
                                  <Input placeholder="0x… (optional)" {...field} className="cm-form-input font-mono" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="cm-create-summary">
                          <div className="cm-create-summary__item">
                            <span className="cm-create-summary__label">Your Share</span>
                            <span className="cm-create-summary__val" data-tone="green">80%</span>
                          </div>
                          <div className="cm-create-summary__item">
                            <span className="cm-create-summary__label">Original Creator</span>
                            <span className="cm-create-summary__val">10%</span>
                          </div>
                          <div className="cm-create-summary__item">
                            <span className="cm-create-summary__label">Network</span>
                            <span className="cm-create-summary__val">{paymentNetworkConfig?.name || "EVM"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {!evmPaymentNetwork && (
                    <div className="cm-shell-notice cm-shell-notice--warning">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Switch to an EVM network to warp external agents.</span>
                    </div>
                  )}

                  {mintStep === "uploading" && (
                    <div className="cm-shell-notice cm-shell-notice--info">
                      <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                      <span>Uploading agent metadata to IPFS…</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="cm-create-submit">
                <Button
                  type="submit"
                  disabled={!account || !evmPaymentNetwork || isProcessing}
                  className="cm-shell-button cm-shell-button--primary cm-create-submit__btn"
                >
                  {mintStep === "uploading" ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  ) : mintStep === "minting" ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Warping…</>
                  ) : !account ? (
                    "Sign in to Warp"
                  ) : !evmPaymentNetwork ? (
                    "Select EVM Network"
                  ) : (
                    <><ArrowRightLeft className="w-4 h-4" /> Warp Agent</>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>

        <aside className="cm-split__side">
          <div className="cm-create-preview-stage">
            <div className="cm-create-preview-stage__head">
              <span className="cm-create-preview__label">Live Preview</span>
              <div className="cm-create-preview__tabs" role="tablist" aria-label="Preview mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === "identikit"}
                  data-active={previewMode === "identikit"}
                  className="cm-create-preview__tab"
                  onClick={() => setPreviewMode("identikit")}
                >
                  Identikit
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === "market"}
                  data-active={previewMode === "market"}
                  className="cm-create-preview__tab"
                  onClick={() => setPreviewMode("market")}
                >
                  Market Card
                </button>
              </div>
            </div>
            <div className="cm-create-preview-stage__body">
              <div className="cm-create-preview-stage__frame">
                {previewMode === "market" ? (
                  <AgentPreviewCard agent={previewAgent} variant="market" />
                ) : (
                  <AgentPreviewCard agent={previewAgent} />
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="cm-surface-card max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              <ArrowRightLeft className="w-5 h-5 inline mr-2 text-fuchsia-400" />
              Confirm Warp
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Review the details before publishing on-chain.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingValues && (
            <div className="space-y-3 py-4 border-y border-primary/15">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Original Agent</span>
                <span className="font-mono text-fuchsia-400">{agent.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Registry</span>
                <span className="font-mono text-foreground">{registryInfo?.name || agent.registry}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Display Name</span>
                <span className="font-mono text-cyan-400">{pendingValues.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Price</span>
                <span className="font-mono text-green-400">${pendingValues.licensePrice} {assetSymbol}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Supply</span>
                <span className="font-mono">{pendingValues.licenses || "∞ Unlimited"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Your Share</span>
                <span className="font-mono text-fuchsia-400">80%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Network</span>
                <span className="font-mono text-cyan-400">{paymentNetworkConfig?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gas</span>
                <span className="font-mono text-green-400">Sponsored (Free)</span>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="cm-shell-button cm-shell-button--ghost">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedWarp} className="cm-shell-button cm-shell-button--primary">
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Confirm & Warp
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
