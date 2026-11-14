import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
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
} from "@/components/ui/alerts";
import { Badge } from "@/components/ui/badge";
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
import { AgentCard as AgentPreviewCard } from "@/components/identikit";
import { CapabilityStrip, getAgentCapabilities } from "@/lib/capabilities";
import { Pockets } from "@/components/control";
import type { OnchainAgent } from "@/hooks/use-onchain";
import { ShellModelBadge } from "@/components/models/badge";
import {
  clearSelectedCatalogModel,
  loadSelectedCatalogModel,
  type SelectedCatalogModel,
} from "@/lib/models";
import { type RegistryServer, type ServerOrigin } from "@/hooks/use-registry";
import { ConnectorCommandBar } from "@/components/connectors/commands";
import {
  uploadAgentAvatar,
  uploadAgentCard,
  getIpfsUri,
  fileToDataUrl,
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
  role: z.enum(["executor", "coordinator"]),
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

  const [builderPocket, setBuilderPocket] = useState<"main" | "side">("main");
  const [activeSection, setActiveSection] = useState<"identity" | "tools" | "financials" | null>("identity");
  const [previewMode, setPreviewMode] = useState<"identikit" | "market">("identikit");

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
        // No agent selected, redirect to market page
        setLocation("/market");
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
      case "account": return "border-purple-500/50 text-purple-400 bg-purple-500/10";
      case "mcp": return "border-cyan-500/50 text-cyan-400 bg-cyan-500/10";
      default: return "border-slate-500/50 text-slate-400 bg-slate-500/10";
    }
  };

  const getOriginLabel = (origin: ServerOrigin) => {
    switch (origin) {
      case "onchain": return "Onchain";
      case "account": return "Account";
      case "mcp": return "MCP";
      default: return origin;
    }
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      role: "executor",
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

  const watchedValues = form.watch();
  const previewAgent = useMemo<OnchainAgent>(() => {
    const supply = watchedValues.licenses ? Math.max(0, Number.parseInt(watchedValues.licenses, 10) || 0) : 0;
    const fee = Math.max(0, Number.parseFloat(watchedValues.creatorFee) || 0);
    const price = watchedValues.licensePrice?.trim() || "0";
    const name = watchedValues.name.trim() || "New Agent";
    const description = watchedValues.description.trim() || "Add purpose, model, connectors, and pricing.";
    const creatorAddress = userAddress ?? account?.address ?? "";
    return {
      id: 0,
      dnaHash: "",
      walletAddress: creatorAddress,
      network: selectedNetwork ?? undefined,
      licenses: supply,
      licensesMinted: 0,
      licensesAvailable: supply,
      licensePrice: price,
      licensePriceFormatted: `$${price}`,
      creatorFee: fee,
      creator: creatorAddress,
      cloneable: watchedValues.isCloneable,
      isClone: false,
      parentAgentId: 0,
      agentCardUri: "",
      isWarped: false,
      metadata: {
        schemaVersion: "1.0.0",
        name,
        description,
        role: watchedValues.role,
        skills: [],
        x402: true,
        x402Support: true,
        avatarUrl: avatarPreview ?? undefined,
        dnaHash: "",
        walletAddress: creatorAddress,
        network: selectedNetwork ?? "",
        model: selectedCatalogModel?.name || watchedValues.model,
        framework: "manowar",
        licensePrice: price,
        creatorFee: fee,
        licenses: supply,
        cloneable: watchedValues.isCloneable,
        knowledge: identityFiles.map((file) => file.name),
        protocols: [{ name: "x402", version: "1.0" }],
        connectors: selectedConnectors.map((connector) => ({
          registryId: connector.id,
          name: connector.name,
          origin: connector.origin,
        })),
        createdAt: "",
      },
    };
  }, [
    account?.address,
    avatarPreview,
    identityFiles,
    selectedCatalogModel?.name,
    selectedConnectors,
    selectedNetwork,
    userAddress,
    watchedValues.creatorFee,
    watchedValues.description,
    watchedValues.isCloneable,
    watchedValues.licensePrice,
    watchedValues.licenses,
    watchedValues.model,
    watchedValues.name,
    watchedValues.role,
  ]);

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
    network: NonNullable<typeof selectedNetwork>;
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
    if (!selectedNetwork) {
      toast({
        title: "Network required",
        description: "Select a deployment network before minting.",
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
        role: values.role,
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
        console.warn("[create] immediate indexing failed; cron will pick it up", error);
      }
    }

    setLocation("/profile");
  };

  const handleMintError = (error: Error) => {
    console.error("Mint error:", error);
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

      if (!selectedNetwork) {
        throw new Error("Select a deployment network first");
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
    setLocation("/create");
  };

  // Handle selecting "Create from Scratch"
  const handleSelectScratch = () => {
    setMode("scratch");
  };

  // Handle selecting "Warp Existing"
  const handleSelectWarp = () => {
    setLocation("/market");
  };

  // =============================================================================
  // Render Choice Screen
  // =============================================================================
  if (mode === "choice") {
    return (
      <div className="cm-create-page">
        <div className="cm-control-rail">
          <div className="cm-control-rail__main">
            <h1 className="cm-page-header__title" data-route-heading>
              <span className="text-fuchsia-500 mr-2">//</span>
              CREATE AGENT
            </h1>
          </div>
        </div>

        <div className="cm-create-choice-scroll cm-workspace-canvas--fade">
          <div className="cm-create-choice">
            <div className="cm-create-choice__grid">
              <button
                type="button"
                className="cm-choice-card group"
                data-tone="cyan"
                onClick={handleSelectScratch}
              >
                <span className="cm-choice-card__icon">
                  <Plus className="w-6 h-6" />
                </span>
                <div>
                  <span className="cm-choice-card__title block text-cyan-400">
                    Create from Scratch
                  </span>
                  <span className="cm-choice-card__copy mt-2 block">
                    Build a new agent with your choice of model, tools, knowledge, and pricing.
                  </span>
                </div>
                <div className="cm-create-choice__highlights">
                  <span className="cm-create-choice__tag">Any Model</span>
                  <span className="cm-create-choice__tag">200+ Tools</span>
                  <span className="cm-create-choice__tag">On-Chain Ownership</span>
                </div>
                <span className="cm-shell-button cm-shell-button--primary w-full">
                  <Plus className="w-4 h-4" />
                  Start Building
                </span>
              </button>

              <button
                type="button"
                className="cm-choice-card group"
                data-tone="fuchsia"
                onClick={handleSelectWarp}
              >
                <span className="cm-choice-card__icon">
                  <ArrowRightLeft className="w-6 h-6" />
                </span>
                <div>
                  <span className="cm-choice-card__title block text-fuchsia-400">
                    Warp Existing
                  </span>
                  <span className="cm-choice-card__copy mt-2 block">
                    Bring an agent from an external registry onto Compose.Market and earn 80% royalties.
                  </span>
                </div>
                <div className="cm-create-choice__highlights">
                  <span className="cm-create-choice__tag" data-tone="fuchsia">80% Royalties</span>
                  <span className="cm-create-choice__tag" data-tone="fuchsia">On-Chain Identity</span>
                  <span className="cm-create-choice__tag" data-tone="fuchsia">Instant Payouts</span>
                </div>
                <span className="cm-shell-button cm-shell-button--secondary w-full">
                  <Globe className="w-4 h-4" />
                  Browse External Agents
                </span>
              </button>
            </div>

            <details className="cm-fold">
              <summary className="cm-fold__summary">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                Compare options
              </summary>
              <div className="cm-fold__body">
                <div className="cm-create-choice__compare">
                  <div>
                    <p className="cm-create-choice__compare-title">Create from Scratch</p>
                    <ul className="cm-create-choice__compare-list">
                      <li>You are the original creator</li>
                      <li>Full control over model, tools, and knowledge</li>
                      <li>Keep 100% of earnings minus protocol fee</li>
                    </ul>
                  </div>
                  <div>
                    <p className="cm-create-choice__compare-title" data-tone="fuchsia">Warp Existing</p>
                    <ul className="cm-create-choice__compare-list">
                      <li>Port agents from external directories</li>
                      <li>Original creator receives 10% royalties</li>
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
  // Render Create from Scratch Builder
  // =============================================================================
  return (
    <div className="cm-create-page">
      {/* ── Control Rail ── */}
      <div className="cm-control-rail cm-control-rail--compact cm-control-rail--inline">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode("choice")}
          className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm"
        >
          <ChevronRight className="w-3.5 h-3.5 sm:mr-1 rotate-180" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="cm-control-rail__main">
          <h1 className="cm-page-header__title" data-route-heading>
            <span className="text-fuchsia-500 mr-2 shrink-0">//</span>
            <span className="truncate">NEW AGENT</span>
          </h1>
        </div>

        <div className="cm-control-rail__actions">
          <Pockets
            value={builderPocket}
            label="Builder view"
            className="cm-pocket-bar--split"
            onChange={setBuilderPocket}
            options={[
              { value: "main", label: "Build" },
              { value: "side", label: "Preview" },
            ]}
          />
          {account ? (
            <span className="cm-badge cm-badge--success cm-create-status-badge">
              <CheckCircle2 className="w-3 h-3" />
              {account.address.slice(0, 6)}...{account.address.slice(-4)}
            </span>
          ) : (
            <span className="cm-badge cm-badge--muted cm-create-status-badge">
              <AlertCircle className="w-3 h-3" />
              Sign in to publish
            </span>
          )}
        </div>
      </div>

      {/* ── Unified Split: Selective-Unfolding Form (left) + Single Framed Live Preview (right) ── */}
      <div className="cm-split" data-pocket={builderPocket}>
        <div className="cm-split__main">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="cm-create-form">
              <div className="cm-create-sections-stage">
                <div className="cm-create-sections">
                  <input
                    ref={identityInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.txt,.md,.json,.csv,.html,.xml,text/*,application/json,application/pdf"
                    onChange={handleIdentitySelect}
                    className="hidden"
                  />

                  {/* ── Block 1: Identity ── */}
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
                        <Cpu />
                        <span>Identity</span>
                      </span>
                      <span className="cm-create-section__right">
                        {activeSection !== "identity" ? (
                          <span className="cm-create-section__summary">
                            {watchedValues.name.trim() || "Untitled"} · {selectedCatalogModel?.name || watchedValues.model} · {watchedValues.role === "coordinator" ? "Coordinator" : "Executor"}
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
                              render={({ field }: { field: ControllerRenderProps<FormValues, "name"> }) => (
                                <FormItem className="cm-field">
                                  <FormLabel>Name</FormLabel>
                                  <FormControl>
                                    <Input placeholder="e.g. Research Assistant" {...field} className="cm-form-input" />
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
                                  <FormLabel>Model</FormLabel>
                                  <ModelSelector value={field.value} onChange={field.onChange} />
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          {/* Avatar Dropzone + AI Generate */}
                          <div className="cm-create-avatar">
                            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
                            <div className="cm-create-avatar__box">
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="cm-create-avatar__drop"
                              >
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

                            {avatarPreview && !generatedAvatarUrl && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setAvatarFile(null);
                                  setAvatarPreview(null);
                                  setGeneratedAvatarUrl(null);
                                }}
                                className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm w-full"
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        </div>

                        <FormField
                          control={form.control}
                          name="role"
                          render={({ field }: { field: ControllerRenderProps<FormValues, "role"> }) => (
                            <FormItem className="cm-field">
                              <FormLabel>Role</FormLabel>
                              <FormControl>
                                <div className="cm-create-role" role="radiogroup" aria-label="Agent role">
                                  <button
                                    type="button"
                                    role="radio"
                                    aria-checked={field.value === "executor"}
                                    data-active={field.value === "executor"}
                                    className="cm-create-role__btn"
                                    onClick={() => field.onChange("executor")}
                                  >
                                    Executor
                                  </button>
                                  <button
                                    type="button"
                                    role="radio"
                                    aria-checked={field.value === "coordinator"}
                                    data-active={field.value === "coordinator"}
                                    data-tone="fuchsia"
                                    className="cm-create-role__btn"
                                    onClick={() => field.onChange("coordinator")}
                                  >
                                    Coordinator
                                  </button>
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field }: { field: ControllerRenderProps<FormValues, "description"> }) => (
                            <FormItem className="cm-field">
                              <FormLabel>Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Describe what this agent helps users do..."
                                  rows={3}
                                  className="cm-form-textarea"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </section>

                  {/* ── Block 2: Tools & Knowledge ── */}
                  <section
                    className="cm-builder-panel cm-create-section"
                    data-tone="green"
                    data-open={activeSection === "tools" ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="cm-create-section__trigger"
                      aria-expanded={activeSection === "tools"}
                      onClick={() => setActiveSection(activeSection === "tools" ? null : "tools")}
                    >
                      <span className="cm-create-section__title">
                        <Plug />
                        <span>Tools & Knowledge</span>
                      </span>
                      <span className="cm-create-section__right">
                        {activeSection !== "tools" ? (
                          <span className="cm-create-section__summary">
                            {selectedConnectors.length > 0 || identityFiles.length > 0
                              ? [
                                selectedConnectors.length > 0 ? `${selectedConnectors.length} pinned` : null,
                                identityFiles.length > 0 ? `${identityFiles.length} ${identityFiles.length === 1 ? "doc" : "docs"}` : null,
                              ].filter(Boolean).join(" · ")
                              : "Built-in capabilities"}
                          </span>
                        ) : null}
                        <ChevronDown className="cm-create-section__chevron" aria-hidden="true" />
                      </span>
                    </button>

                    <div className="cm-create-section__fold">
                      <div className="cm-create-section__content">
                        <div className="cm-create-caps">
                          <span className="cm-create-caps__label">Included Capabilities</span>
                          <CapabilityStrip
                            capabilities={getAgentCapabilities({
                              role: watchedValues.role,
                              connectorCount: selectedConnectors.length,
                              knowledgeCount: identityFiles.length,
                            })}
                            size="sm"
                            showLabels
                          />
                        </div>

                        {selectedConnectors.length > 0 && (
                          <div className="cm-create-chips">
                            {selectedConnectors.map((connector) => (
                              <Badge
                                key={connector.id}
                                variant="outline"
                                className={`${getOriginColor(connector.origin)} pl-2.5 pr-1.5 py-1 text-xs font-mono`}
                              >
                                {connector.name}
                                <button
                                  type="button"
                                  onClick={() => removeConnector(connector.id)}
                                  className="ml-1.5 p-0.5 rounded hover:bg-white/10"
                                  aria-label={`Remove ${connector.name}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}

                        <div>
                          <ShellModelBadge
                            placeholder
                            label="Pin tool or connector..."
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
                            <div className="cm-setting-row__label">Knowledge files</div>
                            <div className="cm-setting-row__description">
                              Attach reference docs or datasets the agent can search.
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
                                      <X className="w-3 h-3" />
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
                              className="cm-shell-button cm-shell-button--secondary cm-shell-button--sm"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>Attach</span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* ── Block 3: Financials ── */}
                  <section
                    className="cm-builder-panel cm-create-section"
                    data-tone="fuchsia"
                    data-open={activeSection === "financials" ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="cm-create-section__trigger"
                      aria-expanded={activeSection === "financials"}
                      onClick={() => setActiveSection(activeSection === "financials" ? null : "financials")}
                    >
                      <span className="cm-create-section__title">
                        <Coins />
                        <span>Financials</span>
                      </span>
                      <span className="cm-create-section__right">
                        {activeSection !== "financials" ? (
                          <span className="cm-create-section__summary">
                            ${watchedValues.licensePrice || "0"} · {watchedValues.creatorFee || "0"}% · {watchedValues.licenses ? watchedValues.licenses : "∞"}
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
                            render={({ field }: { field: ControllerRenderProps<FormValues, "licensePrice"> }) => (
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
                            name="creatorFee"
                            render={({ field }: { field: ControllerRenderProps<FormValues, "creatorFee"> }) => (
                              <FormItem className="cm-field">
                                <FormLabel>Creator Fee (%)</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" step="1" {...field} className="cm-form-input font-mono" />
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
                                <FormLabel>Supply Cap</FormLabel>
                                <FormControl>
                                  <Input type="number" placeholder="∞ Unlimited" {...field} className="cm-form-input font-mono" />
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
                                <FormLabel className="cm-setting-row__label cursor-pointer">Allow Cloning</FormLabel>
                                <FormDescription className="cm-setting-row__description">
                                  Let other builders create derivative agents with attribution.
                                </FormDescription>
                              </div>
                              <div className="cm-setting-row__control">
                                <FormControl>
                                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                              </div>
                            </FormItem>
                          )}
                        />

                        <div className="cm-create-summary">
                          <div className="cm-create-summary__item">
                            <span className="cm-create-summary__label">Network</span>
                            <span className="cm-create-summary__val">{selectedNetworkLabel}</span>
                          </div>
                          <div className="cm-create-summary__item">
                            <span className="cm-create-summary__label">Standard</span>
                            <span className="cm-create-summary__val">{selectedChainId ? "ERC-8004" : "Solana PDA"}</span>
                          </div>
                          <div className="cm-create-summary__item">
                            <span className="cm-create-summary__label">Gas</span>
                            <span className="cm-create-summary__val" data-tone="green">Sponsored</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {mintStep === "uploading" && (
                    <div className="cm-shell-notice cm-shell-notice--info">
                      <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                      <span>Uploading agent metadata to IPFS…</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Primary Publish Action — always sticky/pinned at bottom of builder column */}
              <div className="cm-create-submit">
                <Button
                  type="submit"
                  disabled={!account || isProcessing}
                  className="cm-shell-button cm-shell-button--primary cm-create-submit__btn"
                >
                  {mintStep === "uploading" ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  ) : mintStep === "minting" ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Publishing…</>
                  ) : !account ? (
                    "Sign in to Publish"
                  ) : (
                    "Publish Agent"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>

        {/* ── Right Column: Single Framed Live Preview Stage ── */}
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
              <Sparkles className="w-5 h-5 inline mr-2 text-cyan-400" />
              Confirm Agent
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Review your agent details before publishing on-chain.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingValues && (
            <div className="space-y-3 py-4 border-y border-primary/15">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-mono text-foreground">{pendingValues.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Role</span>
                <span className="font-mono text-cyan-400 capitalize">{pendingValues.role}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Model</span>
                <span className="font-mono text-cyan-400">{selectedCatalogModel?.name || pendingValues.model}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Price</span>
                <span className="font-mono text-green-400">${pendingValues.licensePrice} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Supply</span>
                <span className="font-mono">{pendingValues.licenses || "∞ Unlimited"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cloneable</span>
                <span className="font-mono">{pendingValues.isCloneable ? "Yes" : "No"}</span>
              </div>
              {selectedConnectors.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tools</span>
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
            <AlertDialogCancel className="cm-shell-button cm-shell-button--ghost">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmedMint}
              className="cm-shell-button cm-shell-button--primary"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Confirm & Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
