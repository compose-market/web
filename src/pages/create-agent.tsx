import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePostHog } from "@posthog/react";
import { mpTrack, mpError } from "@/lib/mixpanel";
import { useForm, type SubmitHandler, type ControllerRenderProps } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useSearch } from "wouter";
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
import { Switch } from "@/components/ui/switch";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Cpu, DollarSign, ShieldCheck, Upload, Sparkles, Plug, Search, X, ChevronRight, ChevronDown, Loader2, Play, AlertCircle, CheckCircle2, Boxes, ArrowRightLeft, Plus, Globe, RefreshCw, Check, BookOpen, Coins } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WarpAgentForm, type WarpAgentData } from "@/components/warp-form";
import { ModelSelector } from "@/components/models/selector";
import { ShellModelBadge } from "@compose-market/theme/shell";
import {
  clearSelectedCatalogModel,
  loadSelectedCatalogModel,
  type SelectedCatalogModel,
} from "@/lib/models";
import { type RegistryServer, type ServerOrigin } from "@/hooks/use-registry";
import { ConnectorCommandBar } from "@/components/connectors/command-bar";
import {
  uploadAgentAvatar,
  uploadAgentCard,
  getIpfsUri,
  fileToDataUrl,
  isPinataConfigured,
  type AgentCard
} from "@/lib/pinata";
import { uploadIdentityFiles } from "@/lib/identity";
import { indexAgentCard, rememberJustCreatedAgent } from "@/lib/agents";
import { refreshAgentCatalog } from "@/hooks/use-agents";
import {
  computeDnaHash,
  deriveAgentWalletAddress,
  usdcToWei,
} from "@/lib/contracts";
import { CHAIN_CONFIG, isEvmNetwork, evmChainId } from "@/lib/chains";
import { useChain } from "@/contexts/Network";
import { useActiveAccount, useAdminWallet, useSendTransaction } from "thirdweb/react";
import { getAgentFactoryContractForChain, prepareMintAgentCall } from "@/lib/contracts";
import { saveMintSuccessForShare } from "@/lib/share";
import { useSelectedUserAddress } from "@/hooks/use-address";
import {
  buildSolanaMintAgentInstruction,
  getSolanaChainOrThrow,
  relaySolanaManowarInstructions,
} from "@/lib/programs";

interface SelectedConnector {
  id: string;
  name: string;
  description: string;
  origin: ServerOrigin;
}

const formSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().min(10),
  model: z.string(),
  licensePrice: z.string(),
  creatorFee: z.string(),
  isCloneable: z.boolean(),
  licenses: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// =============================================================================
// Choice Mode Type
// =============================================================================

type CreateMode = "choice" | "scratch" | "warp";

export default function CreateAgent() {
  const posthog = usePostHog();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const account = useActiveAccount();
  const adminWallet = useAdminWallet();
  const { mutateAsync: sendTransaction } = useSendTransaction();
  const { selectedNetwork, solanaChains } = useChain();
  const {
    userAddress,
    solanaAddress,
    evmSignerAddress,
    isResolving: userAddressResolving,
  } = useSelectedUserAddress();
  const selectedChainId = isEvmNetwork(selectedNetwork) ? evmChainId(selectedNetwork) : null;
  const selectedNetworkLabel = selectedChainId
    ? CHAIN_CONFIG[selectedChainId]?.name || "Unknown"
    : solanaChains.find((chain) => chain.network === selectedNetwork)?.name || "Solana";

  // Parse URL params
  const urlParams = new URLSearchParams(searchString);
  const isWarpMode = urlParams.get("warp") === "true";

  // Mode state: choice, scratch (create from scratch), or warp
  const [mode, setMode] = useState<CreateMode>("choice");
  const [warpAgent, setWarpAgent] = useState<WarpAgentData | null>(null);

  const [selectedCatalogModel, setSelectedCatalogModel] = useState<SelectedCatalogModel | null>(null);
  const [selectedConnectors, setSelectedConnectors] = useState<SelectedConnector[]>([]);
  const [showConnectorPicker, setShowConnectorPicker] = useState(false);

  // Avatar upload state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [identityFiles, setIdentityFiles] = useState<File[]>([]);
  const [mintStep, setMintStep] = useState<"idle" | "uploading" | "minting" | "done">("idle");

  // Avatar generation state
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [generationCount, setGenerationCount] = useState(0);
  const [generatedAvatarUrl, setGeneratedAvatarUrl] = useState<string | null>(null);
  const MAX_GENERATIONS = 3;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const identityInputRef = useRef<HTMLInputElement>(null);

  // Collapsible section state (accordion: only one can be open at a time)
  const [activeSection, setActiveSection] = useState<"identity" | "connectors" | "financials" | null>("identity");

  // Check for warp mode from URL and sessionStorage
  useEffect(() => {
    if (isWarpMode) {
      const stored = sessionStorage.getItem("warpAgent");
      if (stored) {
        try {
          const agent = JSON.parse(stored) as WarpAgentData;
          setWarpAgent(agent);
          setMode("warp");
        } catch {
          // Invalid data, go to choice
          setMode("choice");
        }
      } else {
        // No agent selected, redirect to agents page
        setLocation("/agents");
      }
    }
  }, [isWarpMode, setLocation]);

  // Check for selected model from models page
  useEffect(() => {
    try {
      const model = loadSelectedCatalogModel();
      if (model) {
        setSelectedCatalogModel(model);
        clearSelectedCatalogModel();
      }
    } catch {
      clearSelectedCatalogModel();
    }
  }, []);

  // Precompute selected connector IDs for O(1) lookups (Fix 7)
  const selectedIds = useMemo(() => new Set(selectedConnectors.map(p => p.id)), [selectedConnectors]);

  const addConnector = (server: RegistryServer) => {
    // registryId is already normalized by backend (use-registry.ts -> connector)
    if (selectedIds.has(server.registryId)) return;
    setSelectedConnectors(prev => [...prev, {
      id: server.registryId,
      name: server.name,
      description: server.description,
      origin: server.origin,
    }]);
    setShowConnectorPicker(false);
  };

  const removeConnector = (id: string) => {
    setSelectedConnectors(prev => prev.filter(p => p.id !== id));
  };

  const getOriginColor = (origin: ServerOrigin) => {
    switch (origin) {
      case "onchain": return "border-green-500/50 text-green-400 bg-green-500/10";
      case "mcp": return "border-cyan-500/50 text-cyan-400 bg-cyan-500/10";
      default: return "border-slate-500/50 text-slate-400 bg-slate-500/10";
    }
  };

  const getOriginLabel = (origin: ServerOrigin) => {
    switch (origin) {
      case "onchain": return "Onchain";
      case "mcp": return "MCP";
      default: return origin;
    }
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      model: "gemini-3.1-pro-preview",
      licensePrice: "0.01",
      creatorFee: "1",
      isCloneable: false,
      licenses: "",
    },
  });

  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

  // Update form when a catalog model is selected
  useEffect(() => {
    if (selectedCatalogModel) {
      form.setValue("model", selectedCatalogModel.modelId);
    }
  }, [selectedCatalogModel, form]);

  // Handle avatar file selection
  const handleAvatarSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 5MB)
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
  }, [toast]);

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
      setAvatarFile(generatedFile); // set the file for Pinata upload on mint
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
    // Avatar is already set in preview, just clear the generated URL state
    setGeneratedAvatarUrl(null);
    toast({
      title: "Avatar accepted",
      description: "Your AI-generated avatar is ready to use",
    });
  }, [toast]);

  const handleRegenerateAvatar = useCallback(() => {
    handleGenerateAvatar();
  }, [handleGenerateAvatar]);

  const handleIdentitySelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) {
      return;
    }

    setIdentityFiles((prev) => {
      const seen = new Set(prev.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...prev];
      for (const file of selected) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        next.push(file);
      }
      return next;
    });

    e.target.value = "";
  }, []);

  const removeIdentityFile = useCallback((target: File) => {
    setIdentityFiles((prev) => prev.filter((file) => (
      file.name !== target.name
      || file.size !== target.size
      || file.lastModified !== target.lastModified
    )));
  }, []);

  // Handle form validation and IPFS upload before minting
  // Returns prepared transaction data or null if failed
  const prepareForMint = async (values: FormValues): Promise<{
    network: typeof selectedNetwork;
    chainId?: number;
    dnaHash: `0x${string}`;
    walletAddress: `0x${string}`;
    walletTimestamp: number;
    licenses: bigint;
    licensePrice: bigint;
    creatorFee: bigint;
    cloneable: boolean;
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
      // 1. Upload avatar to IPFS
      let avatarUri = "";
      if (avatarFile) {
        const avatarCid = await uploadAgentAvatar(avatarFile, values.name);
        avatarUri = getIpfsUri(avatarCid);
      }

      // 2. Compute DNA hash (skills, selected deployment, model) - matches contract/program expectation
      const chainId = selectedChainId ?? undefined;
      const modelId = selectedCatalogModel?.modelId || values.model;
      const skills = selectedConnectors.map(p => p.id);
      const timestamp = Date.now();

      // dnaHash = hash(skills, selected network, model) - NO timestamp (contract/program expects this)
      const dnaHash = computeDnaHash(skills, chainId ?? selectedNetwork, modelId);

      // Derive wallet from dnaHash + timestamp (timestamp makes each wallet unique)
      const walletAddress = deriveAgentWalletAddress(dnaHash, timestamp);
      const identityUploads = await uploadIdentityFiles(identityFiles, {
        agentName: values.name,
        agentWallet: walletAddress,
      });

      // 3. Build and upload Agent Card to IPFS
      // walletAddress is stored here as the single source of truth
      const agentCard: AgentCard = {
        schemaVersion: "1.0.0",
        name: values.name,
        description: values.description,
        skills,
        x402: true,
        x402Support: true,
        image: avatarUri || "none",
        avatar: avatarUri || "none",
        dnaHash,
        walletAddress,
        walletTimestamp: timestamp,
        network: selectedNetwork,
        model: modelId,
        framework: "manowar",
        licensePrice: usdcToWei(parseFloat(values.licensePrice)).toString(),
        creatorFee: Number.parseInt(values.creatorFee || "1", 10) || 1,
        licenses: values.licenses ? parseInt(values.licenses) : 0,
        cloneable: values.isCloneable,
        ...(identityUploads.length > 0 ? { knowledge: identityUploads.map((item) => item.uri) } : {}),
        protocols: [{ name: "Manowar", version: "1.0" }],
        connectors: selectedConnectors.map(p => ({
          registryId: p.id,
          name: p.name,
          origin: p.origin,
        })),
        createdAt: new Date(timestamp).toISOString(),
        creator: account?.address || "",
      };

      const cardCid = await uploadAgentCard(agentCard);
      const agentCardUri = getIpfsUri(cardCid);

      const licensePrice = usdcToWei(parseFloat(values.licensePrice));
      const creatorFee = BigInt(Number.parseInt(values.creatorFee || "1", 10) || 1);
      const licenses = values.licenses ? BigInt(values.licenses) : BigInt(0);

      const txData = {
        network: selectedNetwork,
        chainId,
        dnaHash,
        walletAddress,
        walletTimestamp: timestamp,
        licenses,
        licensePrice,
        creatorFee,
        cloneable: values.isCloneable,
        agentCardUri,
      };
      setMintStep("minting");

      // Return the prepared data so caller can trigger transaction immediately
      return txData;
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

  const handleMintSuccess = async (
    txData: NonNullable<Awaited<ReturnType<typeof prepareForMint>>>,
    result: { transactionHash: string },
  ) => {
    if (!txData) {
      toast({
        title: "Minting Error",
        description: "Missing prepared mint transaction data",
        variant: "destructive",
      });
      return;
    }

    const chainId = txData.chainId;
    const values = form.getValues();

    const walletAddress = txData.walletAddress || null;

    if (!walletAddress) {
      toast({
        title: "Minting Error",
        description: "Missing mint identity metadata",
        variant: "destructive",
      });
      return;
    }

    saveMintSuccessForShare({
      type: 'agent',
      name: values.name,
      walletAddress,
      txHash: result.transactionHash,
      network: txData.network,
    });

    posthog?.capture("agent_created", {
      agent_name: values.name,
      agent_wallet: walletAddress,
      network: txData.network,
      ...(chainId ? { chain_id: chainId } : {}),
      tx_hash: result.transactionHash,
    });

    mpTrack("Conversion Event", {
      "Conversion Type": "agent_minted",
    });
    mpTrack("Purchase", {
      transaction_id: result.transactionHash,
      revenue: parseFloat(values.licensePrice),
      currency: "USDC",
    });

    // Index the fresh agent immediately: the worker fetches the pinned card
    // by CID, publishes it, and bumps the catalog version so Market and
    // /agent/<wallet> serve it within seconds. Cron remains the fallback.
    if (txData.agentCardUri) {
      const cid = txData.agentCardUri.replace(/^ipfs:\/\//, "");
      rememberJustCreatedAgent(walletAddress);
      try {
        await indexAgentCard({ cid, walletAddress }, { timeoutMs: 10_000 });
        void refreshAgentCatalog();
      } catch (error) {
        console.warn("[create-agent] immediate indexing failed; cron will pick it up", error);
      }
    }

    setLocation("/my-assets");
  };

  const handleMintError = (error: Error) => {
    console.error("Mint error:", error);
    posthog?.captureException(error, { $exception_message: "agent_mint_failed" });
    mpError("agent_mint", error.message);
    setMintStep("idle");
    toast({
      title: "Minting Failed",
      description: error.message || "Unknown error occurred",
      variant: "destructive",
    });
  };

  // Show confirmation before minting
  const onSubmit: SubmitHandler<FormValues> = async (values: FormValues) => {
    setPendingValues(values);
    setShowConfirmDialog(true);
  };

  // Handle confirmed mint - single confirmation triggers both IPFS upload and on-chain mint
  const handleConfirmedMint = async () => {
    if (!pendingValues) return;
    setShowConfirmDialog(false);

    // Step 1: Upload to IPFS and prepare transaction data
    const txData = await prepareForMint(pendingValues);
    if (!txData) return; // Upload failed

    // Step 2: Immediately trigger on-chain transaction (no second click needed)
    try {
      if (!account) {
        throw new Error("Wallet account unavailable");
      }

      if (isEvmNetwork(selectedNetwork)) {
        if (!selectedChainId) throw new Error("EVM chain unavailable");
        const contract = getAgentFactoryContractForChain(selectedChainId);
        const transaction = prepareMintAgentCall(contract, txData);
        const result = await sendTransaction(transaction);
        await handleMintSuccess(txData, { transactionHash: result.transactionHash });
        return;
      }

      if (!solanaAddress || !userAddress || userAddressResolving) {
        throw new Error("Solana smart account is still resolving");
      }
      if (!evmSignerAddress) {
        throw new Error("EVM signer address not available for Solana smart-account signing");
      }
      const signerAccount = adminWallet?.getAccount?.();
      if (!signerAccount) {
        throw new Error("EVM signer account not available");
      }

      const solanaChain = getSolanaChainOrThrow(solanaChains, selectedNetwork);
      const built = await buildSolanaMintAgentInstruction({
        network: solanaChain.network,
        rpcUrl: solanaChain.rpcUrl,
        owner: solanaAddress,
        dnaHash: txData.dnaHash,
        licenses: txData.licenses,
        licensePrice: txData.licensePrice,
        creatorFee: txData.creatorFee,
        cloneable: txData.cloneable,
        agentCardUri: txData.agentCardUri,
      });
      const relayed = await relaySolanaManowarInstructions({
        network: solanaChain.network,
        rpcUrl: solanaChain.rpcUrl,
        selectedSolanaAddress: solanaAddress,
        evmSignerAddress,
        feePayer: built.rentPayer,
        instructions: [built.instruction],
        signMessage: async (message: Uint8Array) => {
          return signerAccount.signMessage({ message: { raw: message } as any });
        },
      });
      await handleMintSuccess(txData, { transactionHash: relayed.signature });
    } catch (error) {
      handleMintError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const isProcessing = mintStep !== "idle" && mintStep !== "done";

  // Handle back to choice from warp mode
  const handleBackToChoice = () => {
    sessionStorage.removeItem("warpAgent");
    setWarpAgent(null);
    setMode("choice");
    // Clear URL params
    setLocation("/create-agent");
  };

  // Handle selecting "Create from Scratch"
  const handleSelectScratch = () => {
    setMode("scratch");
  };

  // Handle selecting "Warp Existing"
  const handleSelectWarp = () => {
    // Navigate to agents page to select an agent to warp
    setLocation("/agents");
  };

  // =============================================================================
  // Render Choice Screen
  // =============================================================================
  if (mode === "choice") {
    return (
      <div className="cm-web-page">
        <div className="cm-web-page__canvas cm-workspace-canvas--fade">
          <div className="cm-web-page__body cm-web-page__body--narrow cm-create-choice">
            <div className="cm-shell-page-header px-0">
              <div className="cm-shell-page-header__copy">
                <h1 className="cm-shell-page-header__title">
                  <span className="text-fuchsia-500 mr-2">//</span>
                  CREATE AGENT
                </h1>
                <p className="cm-shell-page-header__subtitle">
                  Choose how you want to create your agent.
                </p>
              </div>
            </div>

            <div className="cm-create-choice__grid">
              <button
                type="button"
                className="cm-choice-card group"
                data-tone="cyan"
                onClick={handleSelectScratch}
              >
                <span className="cm-choice-card__icon">
                  <Plus className="w-6 h-6 sm:w-8 sm:h-8" />
                </span>
                <span>
                  <span className="cm-choice-card__title block text-cyan-400">
                    CREATE FROM SCRATCH
                  </span>
                  <span className="cm-choice-card__copy mt-2 block">
                    Build a new agent with custom connectors, models, and pricing.
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5 sm:gap-2">
                  <Badge variant="outline" className="text-[9px] sm:text-[10px] border-cyan-500/30 text-cyan-400">
                    Custom Model
                  </Badge>
                  <Badge variant="outline" className="text-[9px] sm:text-[10px] border-cyan-500/30 text-cyan-400">
                    200+ Connectors
                  </Badge>
                  <Badge variant="outline" className="text-[9px] sm:text-[10px] border-cyan-500/30 text-cyan-400">
                    ERC8004
                  </Badge>
                </span>
                <span className="cm-shell-button cm-shell-button--primary w-full">
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  START BUILDING
                </span>
              </button>

              <button
                type="button"
                className="cm-choice-card group"
                data-tone="fuchsia"
                onClick={handleSelectWarp}
              >
                <span className="cm-choice-card__icon">
                  <ArrowRightLeft className="w-6 h-6 sm:w-8 sm:h-8" />
                </span>
                <span>
                  <span className="cm-choice-card__title block text-fuchsia-400">
                    WARP EXISTING
                  </span>
                  <span className="cm-choice-card__copy mt-2 block">
                    Port an agent from external registries into Manowar. Earn 80% royalties.
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5 sm:gap-2">
                  <Badge variant="outline" className="text-[9px] sm:text-[10px] border-fuchsia-500/30 text-fuchsia-400">
                    80% Royalties
                  </Badge>
                  <Badge variant="outline" className="text-[9px] sm:text-[10px] border-fuchsia-500/30 text-fuchsia-400">
                    On-chain Identity
                  </Badge>
                  <Badge variant="outline" className="text-[9px] sm:text-[10px] border-fuchsia-500/30 text-fuchsia-400">
                    x402 Payments
                  </Badge>
                </span>
                <span className="cm-shell-button cm-shell-button--secondary w-full">
                  <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  BROWSE AGENTS
                </span>
              </button>
            </div>

            <details className="cm-fold">
              <summary className="cm-fold__summary">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                What's the difference?
              </summary>
              <div className="cm-fold__body">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <p className="font-mono text-cyan-400 mb-1">Create from Scratch:</p>
                    <ul className="list-disc list-inside space-y-0.5 sm:space-y-1">
                      <li>You are the original creator</li>
                      <li>Full control over connectors & model</li>
                      <li>100% of earnings minus protocol fee</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-mono text-fuchsia-400 mb-1">Warp Existing:</p>
                    <ul className="list-disc list-inside space-y-0.5 sm:space-y-1">
                      <li>Port agents from other ecosystems</li>
                      <li>Original creator gets 10% royalties</li>
                      <li>You earn 80% of usage fees</li>
                    </ul>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    );
  }

  // =============================================================================
  // Render Warp Form
  // =============================================================================
  if (mode === "warp" && warpAgent) {
    return <WarpAgentForm agent={warpAgent} onBack={handleBackToChoice} />;
  }

  // =============================================================================
  // Render Create from Scratch Form
  // =============================================================================
  return (
    <div className="cm-web-page cm-create-page">
      <div className="cm-web-page__canvas cm-workspace-canvas--fade cm-web-page__canvas--scroll">
        <div className="cm-web-page__body cm-web-page__body--wide cm-create-builder">
          {/* Compact Header */}
          <div className="cm-control-rail">
            <div className="cm-control-rail__main">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMode("choice")}
                className="text-muted-foreground hover:text-cyan-400 h-8 px-2"
              >
                <ChevronRight className="w-3.5 h-3.5 mr-1 rotate-180" />
                <span className="hidden sm:inline">Back</span>
              </Button>
              <h1 className="cm-shell-page-header__title text-lg">
                <span className="text-fuchsia-500 mr-1">//</span>
                MINT AGENT
              </h1>
            </div>
            <div className="cm-control-rail__actions">
              {account ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {account.address.slice(0, 6)}...{account.address.slice(-4)}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-yellow-500/30 text-yellow-400">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Sign in to mint
                </Badge>
              )}
            </div>
          </div>

          {/* Main Content */}
          <div className="cm-create-builder__pair">
            {/* Left: Form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="cm-create-builder__form">
                {/* Identity: Name + Model row */}
                <div className={cn("cm-builder-panel cm-create-builder__section", activeSection === "identity" && "cm-active-panel")}>
                  <div
                    onClick={() => setActiveSection(activeSection === "identity" ? null : "identity")}
                    className="cm-builder-panel__title cursor-pointer flex justify-between items-center select-none"
                  >
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4" />
                      Identity
                    </div>
                    <ChevronDown className={cn("w-4 h-4 transition-transform", activeSection === "identity" && "rotate-180")} />
                  </div>
                  <input
                    ref={identityInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.txt,.md,.json,.csv,.html,.xml,text/*,application/json,application/pdf"
                    onChange={handleIdentitySelect}
                    className="hidden"
                  />
                  {activeSection === "identity" && (
                    <div className="flex flex-col gap-4 mt-3">
                      {/* Top: Name/Model on left, Avatar on right */}
                      <div className="flex gap-4 items-stretch">
                        {/* Fields stacked on left */}
                        <div className="flex-1 flex flex-col justify-between gap-3 min-w-0">
                          <FormField
                            control={form.control}
                            name="name"
                            render={({ field }: { field: ControllerRenderProps<FormValues, "name"> }) => (
                              <FormItem className="cm-field">
                                <FormLabel className="font-mono text-foreground text-xs">Agent Name</FormLabel>
                                <FormControl>
                                  <Input placeholder="e.g. Alpha Sniper V1" {...field} className="bg-background/50 font-mono border-primary/20 focus:border-cyan-500 h-9" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="model"
                            render={({ field }: { field: ControllerRenderProps<FormValues, "model"> }) => (
                              <FormItem className="cm-field">
                                <FormLabel className="font-mono text-foreground text-xs">LLM Model</FormLabel>
                                <ModelSelector
                                  value={field.value}
                                  onChange={field.onChange}
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Avatar Upload column on right */}
                        <div className="w-[120px] sm:w-[140px] shrink-0 flex flex-col items-center justify-center p-2 border border-primary/15 rounded-lg bg-background/20 relative z-20">
                          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
                          <div className="relative w-full aspect-square max-w-[100px] sm:max-w-[110px] mx-auto">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="w-full h-full rounded-sm bg-background/50 border border-primary/25 border-dashed flex flex-col items-center justify-center text-muted-foreground cursor-pointer hover:border-cyan-500 hover:text-cyan-400 transition-colors overflow-hidden"
                            >
                              {isGeneratingAvatar ? (
                                <div className="flex flex-col items-center gap-1">
                                  <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                                  <span className="text-[8px] font-mono text-cyan-400">GENERATING...</span>
                                </div>
                              ) : avatarPreview ? (
                                <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                              ) : (
                                <>
                                  <Upload className="w-4 h-4 mb-0.5" />
                                  <span className="text-[9px] font-mono text-center leading-tight">UPLOAD AVATAR</span>
                                </>
                              )}
                            </button>
                            {!isGeneratingAvatar && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleGenerateAvatar(); }}
                                      disabled={generationCount >= MAX_GENERATIONS}
                                      className={`absolute bottom-0.5 right-0.5 w-6 h-6 rounded-full flex items-center justify-center transition-all ${generationCount >= MAX_GENERATIONS
                                        ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                                        : "bg-fuchsia-500/80 hover:bg-fuchsia-500 text-white shadow-lg"
                                        }`}
                                    >
                                      <Sparkles className="w-3 h-3" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {generationCount >= MAX_GENERATIONS
                                      ? `Limit (${MAX_GENERATIONS}/${MAX_GENERATIONS})`
                                      : `Generate (${generationCount}/${MAX_GENERATIONS})`}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                          {generatedAvatarUrl && !isGeneratingAvatar && (
                            <div className="flex gap-1.5 justify-center mt-1.5">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button type="button" variant="outline" size="sm" onClick={handleAcceptAvatar} className="border-green-500/50 text-green-400 hover:bg-green-500/10 h-6 w-6 p-0">
                                      <Check className="w-3 h-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Accept</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button type="button" variant="outline" size="sm" onClick={handleRegenerateAvatar} disabled={generationCount >= MAX_GENERATIONS}
                                      className={`h-6 w-6 p-0 ${generationCount >= MAX_GENERATIONS ? "border-muted text-muted-foreground" : "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"}`}
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{generationCount >= MAX_GENERATIONS ? "Limit" : "Regenerate"}</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          )}
                          {avatarPreview && !generatedAvatarUrl && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => { setAvatarFile(null); setAvatarPreview(null); setGeneratedAvatarUrl(null); }} className="w-full text-[9px] text-muted-foreground h-5 mt-1">
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Description full-width below */}
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }: { field: ControllerRenderProps<FormValues, "description"> }) => (
                          <FormItem className="cm-field cm-create-description">
                            <FormLabel className="font-mono text-foreground text-xs">Purpose & Capabilities</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Describe what this agent does..."
                                className="resize-none bg-background/50 border-primary/20 focus:border-cyan-500 min-h-[80px]"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>
                {/* Connectors */}
                <div className={cn("cm-builder-panel cm-create-builder__section relative z-10", activeSection === "connectors" && "cm-active-panel")} data-tone="green">
                  <div
                    onClick={() => setActiveSection(activeSection === "connectors" ? null : "connectors")}
                    className="cm-builder-panel__title cursor-pointer flex justify-between items-center select-none"
                  >
                    <div className="flex items-center gap-2">
                      <Plug className="w-4 h-4" />
                      Connectors
                    </div>
                    <ChevronDown className={cn("w-4 h-4 transition-transform", activeSection === "connectors" && "rotate-180")} />
                  </div>
                  {activeSection === "connectors" && (
                    <>
                      {selectedConnectors.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {selectedConnectors.map(connector => (
                            <Badge
                              key={connector.id}
                              variant="outline"
                              className={`${getOriginColor(connector.origin)} pl-2 pr-1 py-0.5 text-[10px] font-mono`}
                            >
                              {connector.name}
                              <button
                                type="button"
                                onClick={() => removeConnector(connector.id)}
                                className="ml-1 p-0.5 rounded hover:bg-white/10"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="mt-3">
                        <ShellModelBadge
                          placeholder
                          label="Add connector..."
                          shortcut="Search"
                          onClick={() => setShowConnectorPicker(true)}
                        />
                        <ConnectorCommandBar
                          open={showConnectorPicker}
                          onOpenChange={setShowConnectorPicker}
                          onSelect={addConnector}
                          selectedIds={selectedIds}
                        />
                      </div>
                      <div className="cm-setting-row cm-knowledge-row">
                        <div className="cm-setting-row__icon">
                          <BookOpen className="w-4 h-4" />
                        </div>
                        <div className="cm-setting-row__copy">
                          <div className="cm-setting-row__label">Knowledge</div>
                          <div className="cm-setting-row__description">
                            Optional Filecoin-backed <code className="text-cyan-500/70">ipfs://</code> files attached to the minted agent card.
                          </div>
                          {identityFiles.length > 0 ? (
                            <div className="cm-knowledge-row__files">
                              {identityFiles.map((file) => (
                                <span
                                  key={`${file.name}:${file.size}:${file.lastModified}`}
                                  className="cm-knowledge-row__file"
                                >
                                  <span className="truncate">{file.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeIdentityFile(file)}
                                    className="rounded-full px-1 text-muted-foreground hover:text-foreground"
                                    aria-label={`Remove ${file.name}`}
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="cm-setting-row__control">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => identityInputRef.current?.click()}
                            className="border-cyan-500/40 text-cyan-300 hover:text-cyan-200 shrink-0 h-8 text-xs"
                          >
                            <Upload className="w-3 h-3 mr-1.5" />
                            Attach
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Financial */}
                <div className={cn("cm-builder-panel cm-create-builder__section", activeSection === "financials" && "cm-active-panel")} data-tone="fuchsia">
                  <div
                    onClick={() => setActiveSection(activeSection === "financials" ? null : "financials")}
                    className="cm-builder-panel__title cursor-pointer flex justify-between items-center select-none"
                  >
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4" />
                      Financials
                    </div>
                    <ChevronDown className={cn("w-4 h-4 transition-transform", activeSection === "financials" && "rotate-180")} />
                  </div>
                  {activeSection === "financials" && (
                    <>
                      <div className="cm-financial-grid">
                        <FormField
                          control={form.control}
                          name="licensePrice"
                          render={({ field }: { field: ControllerRenderProps<FormValues, "licensePrice"> }) => (
                            <FormItem className="cm-field">
                              <FormLabel className="font-mono text-foreground text-sm">Price</FormLabel>
                              <FormControl>
                                <Input type="number" step="0.001" {...field} className="bg-background/50 font-mono border-primary/20 focus:border-fuchsia-500" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="creatorFee"
                          render={({ field }: { field: ControllerRenderProps<FormValues, "creatorFee"> }) => (
                            <FormItem className="cm-field">
                              <FormLabel className="font-mono text-foreground text-sm">Fee</FormLabel>
                              <FormControl>
                                <Input type="number" min="0" step="1" {...field} className="bg-background/50 font-mono border-primary/20 focus:border-fuchsia-500" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="licenses"
                          render={({ field }: { field: ControllerRenderProps<FormValues, "licenses"> }) => (
                            <FormItem className="cm-field">
                              <FormLabel className="font-mono text-foreground text-sm">Supply</FormLabel>
                              <FormControl>
                                <Input type="number" placeholder="∞" {...field} className="bg-background/50 font-mono border-primary/20 focus:border-fuchsia-500" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={form.control}
                        name="isCloneable"
                        render={({ field }: { field: ControllerRenderProps<FormValues, "isCloneable"> }) => (
                          <FormItem className="cm-setting-row">
                            <div className="cm-setting-row__copy">
                              <FormLabel className="text-sm font-mono text-foreground cursor-pointer">Allow Cloning</FormLabel>
                              <FormDescription>Let other builders mint derivative agents with attribution.</FormDescription>
                            </div>
                            <div className="cm-setting-row__control">
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </div>
                          </FormItem>
                        )}
                      />
                      {/* Mint Info metadata inside Financial */}
                      <div className="border-t border-primary/10 pt-3 mt-3 space-y-2 text-xs font-mono">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Network</span>
                          <span className="text-cyan-400 truncate">
                            {selectedNetworkLabel}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Contract</span>
                          <span className="text-cyan-400">ERC8004</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Gas</span>
                          <span className="text-green-400">Sponsored</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>


                {/* Mint Progress */}
                {mintStep === "uploading" && (
                  <div className="flex items-center gap-2 p-2 rounded-sm bg-cyan-500/10 border border-cyan-500/30">
                    <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                    <p className="font-mono text-xs text-foreground">Uploading to IPFS...</p>
                  </div>
                )}

                {/* Mint Button centered */}
                <div className="flex justify-center mt-6">
                  <Button
                    type="submit"
                    size="lg"
                    disabled={!account || isProcessing}
                    className="w-full max-w-md bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold font-mono hover:from-cyan-400 hover:to-fuchsia-400 h-12 text-base shadow-[0_0_20px_-5px_hsl(var(--primary))] tracking-wider disabled:opacity-50"
                  >
                    {mintStep === "uploading" ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />UPLOADING...</>
                    ) : mintStep === "minting" ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />MINTING...</>
                    ) : !account ? (
                      "SIGN IN TO MINT"
                    ) : (
                      "MINT AGENT"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </div>


          {/* Confirmation Dialog */}
          <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
            <AlertDialogContent className="cm-surface-card max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl">
                  <Sparkles className="w-5 h-5 inline mr-2 text-cyan-400" />
                  Confirm Agent Minting
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  Review your agent details before minting to the blockchain.
                </AlertDialogDescription>
              </AlertDialogHeader>

              {pendingValues && (
                <div className="space-y-3 py-4 border-y border-primary/15">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-mono text-foreground">{pendingValues.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Framework</span>
                    <span className="font-mono text-orange-400">Manowar</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Model</span>
                    <span className="font-mono text-cyan-400">{selectedCatalogModel?.name || pendingValues.model}</span>
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
                    <span className="text-muted-foreground">Cloneable</span>
                    <span className="font-mono">{pendingValues.isCloneable ? "Yes" : "No"}</span>
                  </div>
                  {selectedConnectors.length > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Connectors</span>
                      <span className="font-mono text-fuchsia-400">{selectedConnectors.length} selected</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Network</span>
                    <span className="font-mono text-cyan-400">{selectedNetworkLabel}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Gas</span>
                    <span className="font-mono text-green-400">Sponsored (Free)</span>
                  </div>
                </div>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel className="border-primary/20">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmedMint}
                  className="bg-cyan-500 text-black hover:bg-cyan-400 font-bold"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Confirm & Mint
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
