import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Cpu, DollarSign, ShieldCheck, Upload, Sparkles, Plug, Search, X, ChevronRight, Loader2, Play, AlertCircle, CheckCircle2, Boxes, ArrowRightLeft, Plus, Globe, RefreshCw, Check, BookOpen } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WarpAgentForm, type WarpAgentData } from "@/components/warp-form";
import { ModelSelector } from "@/components/model-selector";
import {
  clearSelectedCatalogModel,
  loadSelectedCatalogModel,
  type SelectedCatalogModel,
} from "@/lib/models";
import { useRegistryServers, useRegistrySearch, type RegistryServer, type ServerOrigin } from "@/hooks/use-registry";
import {
  uploadAgentAvatar,
  uploadAgentCard,
  getIpfsUri,
  fileToDataUrl,
  isPinataConfigured,
  type AgentCard
} from "@/lib/pinata";
import { uploadIdentityFiles } from "@/lib/identity";
import {
  computeDnaHash,
  deriveAgentWalletAddress,
  usdcToWei,
} from "@/lib/contracts";
import { CHAIN_CONFIG } from "@/lib/chains";
import { useChain } from "@/contexts/ChainContext";
import { NetworkSelector } from "@/components/ui/network-selector";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { getAgentFactoryContractForChain, prepareMintAgentCall } from "@/lib/contracts";
import { saveMintSuccessForShare } from "@/lib/share";

interface SelectedPlugin {
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
  const { mutateAsync: sendTransaction } = useSendTransaction();
  const { selectedChainId } = useChain();

  // Parse URL params
  const urlParams = new URLSearchParams(searchString);
  const isWarpMode = urlParams.get("warp") === "true";

  // Mode state: choice, scratch (create from scratch), or warp
  const [mode, setMode] = useState<CreateMode>("choice");
  const [warpAgent, setWarpAgent] = useState<WarpAgentData | null>(null);

  const [selectedCatalogModel, setSelectedCatalogModel] = useState<SelectedCatalogModel | null>(null);
  const [selectedPlugins, setSelectedPlugins] = useState<SelectedPlugin[]>([]);
  const [pluginSearch, setPluginSearch] = useState("");
  const [showPluginPicker, setShowPluginPicker] = useState(false);

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

  // Fetch plugins/MCPs
  const { data: searchData, isLoading: isSearching } = useRegistrySearch(
    pluginSearch,
    20
  );

  const { data: defaultPlugins, isLoading: isLoadingDefault } = useRegistryServers({
    origin: "goat,mcp",
    limit: 30,
  });

  const isLoadingPlugins = pluginSearch.trim() ? isSearching : isLoadingDefault;
  const availablePlugins: RegistryServer[] = pluginSearch.trim()
    ? (searchData?.servers ?? [])
    : (defaultPlugins?.servers ?? []);

  // Precompute selected plugin IDs for O(1) lookups (Fix 7)
  const selectedIds = useMemo(() => new Set(selectedPlugins.map(p => p.id)), [selectedPlugins]);

  const addPlugin = (server: RegistryServer) => {
    // registryId is already normalized by backend (use-registry.ts -> connector)
    if (selectedIds.has(server.registryId)) return;
    setSelectedPlugins(prev => [...prev, {
      id: server.registryId,
      name: server.name,
      description: server.description,
      origin: server.origin,
    }]);
    setPluginSearch("");
    setShowPluginPicker(false);
  };

  const removePlugin = (id: string) => {
    setSelectedPlugins(prev => prev.filter(p => p.id !== id));
  };

  const getOriginColor = (origin: ServerOrigin) => {
    switch (origin) {
      case "goat": return "border-green-500/50 text-green-400 bg-green-500/10";
      case "mcp": return "border-cyan-500/50 text-cyan-400 bg-cyan-500/10";
      default: return "border-slate-500/50 text-slate-400 bg-slate-500/10";
    }
  };

  const getOriginLabel = (origin: ServerOrigin) => {
    switch (origin) {
      case "goat": return "GOAT";
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
  }, [form, generationCount, toast, API_URL]);

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
    chainId: number;
    dnaHash: `0x${string}`;
    walletAddress: `0x${string}`;
    walletTimestamp: number;
    licenses: bigint;
    licensePrice: bigint;
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

      // 2. Compute DNA hash (skills, chainId, model) - matches contract expectation
      const chainId = selectedChainId; // Use selected chain from context
      const modelId = selectedCatalogModel?.modelId || values.model;
      const skills = selectedPlugins.map(p => p.id);
      const timestamp = Date.now();

      // dnaHash = hash(skills, chainId, model) - NO timestamp (contract expects this)
      const dnaHash = computeDnaHash(skills, chainId, modelId);

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
        chain: chainId,
        model: modelId,
        framework: "manowar",
        licensePrice: usdcToWei(parseFloat(values.licensePrice)).toString(),
        licenses: values.licenses ? parseInt(values.licenses) : 0,
        cloneable: values.isCloneable,
        ...(identityUploads.length > 0 ? { knowledge: identityUploads.map((item) => item.uri) } : {}),
        protocols: [{ name: "Manowar", version: "1.0" }],
        plugins: selectedPlugins.map(p => ({
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
      const licenses = values.licenses ? BigInt(values.licenses) : BigInt(0);

      const txData = {
        chainId,
        dnaHash,
        walletAddress,
        walletTimestamp: timestamp,
        licenses,
        licensePrice,
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

    if (!walletAddress || !Number.isInteger(chainId) || !CHAIN_CONFIG[chainId]) {
      toast({
        title: "Minting Error",
        description: "Missing or invalid mint chain metadata",
        variant: "destructive",
      });
      return;
    }

    saveMintSuccessForShare({
      type: 'agent',
      name: values.name,
      walletAddress,
      txHash: result.transactionHash,
      chainId,
    });

    posthog?.capture("agent_created", {
      agent_name: values.name,
      agent_wallet: walletAddress,
      chain_id: chainId,
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
      const contract = getAgentFactoryContractForChain(selectedChainId);
      if (!account) {
        throw new Error("Wallet account unavailable");
      }

      const transaction = prepareMintAgentCall(contract, txData);
      const result = await sendTransaction(transaction);
      await handleMintSuccess(txData, { transactionHash: result.transactionHash });
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
      <div className="max-w-3xl mx-auto pb-20 px-1">
        {/* Page Header */}
        <div className="mb-6 sm:mb-8 space-y-2 border-b border-sidebar-border pb-4 sm:pb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl sm:text-2xl font-display font-bold text-white">
              <span className="text-fuchsia-500 mr-2">//</span>
              CREATE AGENT
            </h1>
            <div className="hidden md:flex h-px w-32 bg-gradient-to-r from-fuchsia-500 to-transparent"></div>
          </div>
          <p className="text-muted-foreground font-mono text-xs sm:text-sm">
            Choose how you want to create your agent.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {/* Create from Scratch */}
          <Card
            className="glass-panel border-cyan-500/20 cursor-pointer hover:border-cyan-500/50 transition-all group active:bg-cyan-500/5"
            onClick={handleSelectScratch}
          >
            <CardContent className="p-5 sm:p-8 text-center space-y-3 sm:space-y-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto rounded-full bg-cyan-500/10 flex items-center justify-center border-2 border-cyan-500/30 group-hover:border-cyan-500/50 group-hover:bg-cyan-500/20 transition-colors">
                <Plus className="w-6 h-6 sm:w-8 sm:h-8 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-display font-bold text-cyan-400 mb-1 sm:mb-2">
                  CREATE FROM SCRATCH
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Build a new agent with custom plugins, models, and pricing.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
                <Badge variant="outline" className="text-[9px] sm:text-[10px] border-cyan-500/30 text-cyan-400">
                  Custom Model
                </Badge>
                <Badge variant="outline" className="text-[9px] sm:text-[10px] border-cyan-500/30 text-cyan-400">
                  200+ Plugins
                </Badge>
                <Badge variant="outline" className="text-[9px] sm:text-[10px] border-cyan-500/30 text-cyan-400">
                  ERC8004
                </Badge>
              </div>
              <Button className="w-full bg-cyan-500 text-black hover:bg-cyan-400 font-bold font-mono text-xs sm:text-sm h-9 sm:h-10">
                <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                START BUILDING
              </Button>
            </CardContent>
          </Card>

          {/* Warp Existing */}
          <Card
            className="glass-panel border-fuchsia-500/20 cursor-pointer hover:border-fuchsia-500/50 transition-all group active:bg-fuchsia-500/5"
            onClick={handleSelectWarp}
          >
            <CardContent className="p-5 sm:p-8 text-center space-y-3 sm:space-y-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto rounded-full bg-fuchsia-500/10 flex items-center justify-center border-2 border-fuchsia-500/30 group-hover:border-fuchsia-500/50 group-hover:bg-fuchsia-500/20 transition-colors">
                <ArrowRightLeft className="w-6 h-6 sm:w-8 sm:h-8 text-fuchsia-400" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-display font-bold text-fuchsia-400 mb-1 sm:mb-2">
                  WARP EXISTING
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Port an agent from external registries into Manowar. Earn 80% royalties.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
                <Badge variant="outline" className="text-[9px] sm:text-[10px] border-fuchsia-500/30 text-fuchsia-400">
                  80% Royalties
                </Badge>
                <Badge variant="outline" className="text-[9px] sm:text-[10px] border-fuchsia-500/30 text-fuchsia-400">
                  On-chain Identity
                </Badge>
                <Badge variant="outline" className="text-[9px] sm:text-[10px] border-fuchsia-500/30 text-fuchsia-400">
                  x402 Payments
                </Badge>
              </div>
              <Button className="w-full bg-fuchsia-500 text-white hover:bg-fuchsia-400 font-bold font-mono text-xs sm:text-sm h-9 sm:h-10">
                <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                BROWSE AGENTS
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Info Box */}
        <div className="mt-6 sm:mt-8 p-3 sm:p-4 rounded-sm bg-sidebar-accent border border-sidebar-border">
          <h3 className="font-bold font-display text-foreground mb-2 text-sm sm:text-base">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1.5 sm:mr-2 text-cyan-400" />
            What's the difference?
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
            <div>
              <p className="font-mono text-cyan-400 mb-1">Create from Scratch:</p>
              <ul className="list-disc list-inside space-y-0.5 sm:space-y-1">
                <li>You are the original creator</li>
                <li>Full control over plugins & model</li>
                <li>100% of earnings (minus protocol fee)</li>
              </ul>
            </div>
            <div>
              <p className="font-mono text-fuchsia-400 mb-1">Warp Existing:</p>
              <ul className="list-disc list-inside space-y-0.5 sm:space-y-1">
                <li>Port agents from other ecosystems</li>
                <li>Original creator gets 10% royalties</li>
                <li>You (warper) earn 80% of usage fees</li>
              </ul>
            </div>
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
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Compact Header */}
      <div className="shrink-0 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("choice")}
            className="text-muted-foreground hover:text-cyan-400 -ml-2 h-7 px-2"
          >
            <ChevronRight className="w-3.5 h-3.5 mr-1 rotate-180" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <h1 className="text-lg font-display font-bold text-white">
            <span className="text-fuchsia-500 mr-1">//</span>
            MINT AGENT
          </h1>
          <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-400 hidden sm:inline-flex">
            Manowar · LangGraph · Memory · RAG
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {account ? (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              {account.address.slice(0, 6)}…{account.address.slice(-4)}
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
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Left: Form */}
        <div className="min-h-0 flex flex-col pr-1">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0 gap-3">
              {/* Identity: Name + Model row */}
              <div className="glass-panel border border-cyan-500/20 rounded-sm p-4 space-y-3 flex-1 flex flex-col min-h-0 overflow-y-auto">
                <div className="flex items-center gap-2 text-cyan-400 text-sm font-display font-bold uppercase">
                  <Cpu className="w-4 h-4" />
                  Identity
                </div>
                <input
                  ref={identityInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.json,.csv,.html,.xml,text/*,application/json,application/pdf"
                  onChange={handleIdentitySelect}
                  className="hidden"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }: { field: ControllerRenderProps<FormValues, "name"> }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-foreground text-sm">Agent Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Alpha Sniper V1" {...field} className="bg-background/50 font-mono border-sidebar-border focus:border-cyan-500" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="model"
                    render={({ field }: { field: ControllerRenderProps<FormValues, "model"> }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-foreground text-sm">LLM Model</FormLabel>
                        {selectedCatalogModel ? (
                          <div className="p-2.5 rounded-sm bg-cyan-500/10 border border-cyan-500/30">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-mono font-bold text-cyan-400 text-sm">{selectedCatalogModel.name || selectedCatalogModel.modelId}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">
                                  via {selectedCatalogModel.provider} · x402
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedCatalogModel(null)}
                                className="text-[10px] text-muted-foreground hover:text-foreground h-5 px-1"
                              >
                                Change
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <ModelSelector
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Search 1300+ models..."
                            showTypeFilter
                          />
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Description + Knowledge side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }: { field: ControllerRenderProps<FormValues, "description"> }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className="font-mono text-foreground text-sm">Purpose & Capabilities</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe what this agent does..."
                            className="resize-none bg-background/50 flex-1 min-h-[90px] border-sidebar-border focus:border-cyan-500"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="rounded-sm border border-sidebar-border bg-background/30 p-3 space-y-2 flex flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs text-cyan-400 uppercase flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        Identity Knowledge
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => identityInputRef.current?.click()}
                        className="border-cyan-500/40 text-cyan-300 hover:text-cyan-200 shrink-0 h-7 text-xs"
                      >
                        <Upload className="w-3 h-3 mr-1.5" />
                        Add files
                      </Button>
                    </div>
                    {identityFiles.length > 0 ? (
                      <div className="space-y-1 flex-1 overflow-y-auto max-h-[100px]">
                        {identityFiles.map((file) => (
                          <div
                            key={`${file.name}:${file.size}:${file.lastModified}`}
                            className="flex items-center justify-between gap-2 rounded-sm border border-sidebar-border px-2.5 py-1.5"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs text-foreground">{file.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {Math.max(1, Math.round(file.size / 1024))} KB
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeIdentityFile(file)}
                              className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground flex-1">
                        Optional Filecoin-backed <code className="text-cyan-500/70">ipfs://</code> URIs added to the minted agent card. The agent reads this material via the knowledge tool.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Plugins + Financial side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Plugins */}
                <div className="glass-panel border border-green-500/20 rounded-sm p-3 space-y-2 relative z-10">
                  <div className="flex items-center gap-2 text-green-400 text-sm font-display font-bold uppercase">
                    <Plug className="w-4 h-4" />
                    Plugins
                  </div>
                  {selectedPlugins.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPlugins.map(plugin => (
                        <Badge
                          key={plugin.id}
                          variant="outline"
                          className={`${getOriginColor(plugin.origin)} pl-2 pr-1 py-0.5 text-[10px] font-mono`}
                        >
                          {plugin.name}
                          <button
                            type="button"
                            onClick={() => removePlugin(plugin.id)}
                            className="ml-1 p-0.5 rounded hover:bg-white/10"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search plugins..."
                        value={pluginSearch}
                        onChange={(e) => {
                          setPluginSearch(e.target.value);
                          setShowPluginPicker(true);
                        }}
                        onFocus={() => setShowPluginPicker(true)}
                        className="pl-10 bg-background/50 font-mono border-sidebar-border focus:border-green-500"
                      />
                    </div>
                    {showPluginPicker && (
                      <div className="absolute z-50 w-full mt-1 bg-sidebar border border-sidebar-border rounded-sm shadow-lg">
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-sidebar-border">
                          <span className="text-[10px] font-mono text-muted-foreground uppercase">
                            {pluginSearch ? "Search Results" : "Popular Plugins"}
                          </span>
                          <Link href="/registry">
                            <Button type="button" variant="ghost" size="sm" className="text-[10px] text-green-400 hover:text-green-300 h-auto py-0.5 px-1">
                              See all <ChevronRight className="w-3 h-3 ml-0.5" />
                            </Button>
                          </Link>
                        </div>
                        <ScrollArea className="h-40">
                          {isLoadingPlugins ? (
                            <div className="flex items-center justify-center py-6">
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : availablePlugins.length === 0 ? (
                            <div className="py-6 text-center text-xs text-muted-foreground">No plugins found</div>
                          ) : (
                            <div className="p-1">
                              {availablePlugins.map(server => {
                                const isSelected = selectedPlugins.some(p => p.id === server.registryId);
                                const isTestable = server.origin === "goat";
                                return (
                                  <button
                                    key={server.registryId}
                                    type="button"
                                    onClick={() => addPlugin(server)}
                                    disabled={isSelected}
                                    className={`w-full text-left p-1.5 rounded-sm text-xs transition-all ${isSelected ? "opacity-50 cursor-not-allowed" : "hover:bg-green-500/10"}`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className={`${getOriginColor(server.origin)} text-[9px] px-1 py-0`}>
                                        {getOriginLabel(server.origin)}
                                      </Badge>
                                      <span className="font-mono text-foreground truncate flex-1">{server.name}</span>
                                      {isTestable && (
                                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-cyan-500/30 text-cyan-400">
                                          <Play className="w-2 h-2 mr-0.5" />Testable
                                        </Badge>
                                      )}
                                      {isSelected && <span className="text-green-400 text-[10px]">Added</span>}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </ScrollArea>
                        <div className="px-3 py-1.5 border-t border-sidebar-border">
                          <button type="button" onClick={() => setShowPluginPicker(false)} className="text-[10px] text-muted-foreground hover:text-foreground">Close</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Financial */}
                <div className="glass-panel border border-fuchsia-500/20 rounded-sm p-3 space-y-2">
                  <div className="flex items-center gap-2 text-fuchsia-400 text-sm font-display font-bold uppercase">
                    <DollarSign className="w-4 h-4" />
                    Financial (x402)
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="licensePrice"
                      render={({ field }: { field: ControllerRenderProps<FormValues, "licensePrice"> }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-foreground text-sm">Price (USDC)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.001" {...field} className="bg-background/50 font-mono border-sidebar-border focus:border-fuchsia-500" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="licenses"
                      render={({ field }: { field: ControllerRenderProps<FormValues, "licenses"> }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-foreground text-sm">Supply</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="∞" {...field} className="bg-background/50 font-mono border-sidebar-border focus:border-fuchsia-500" />
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
                      <FormItem className="flex items-center justify-between rounded-sm border border-sidebar-border px-3 py-2 bg-background/30">
                        <FormLabel className="text-sm font-mono text-foreground cursor-pointer">Allow Cloning</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Mint Progress */}
              {mintStep === "uploading" && (
                <div className="flex items-center gap-2 p-2 rounded-sm bg-cyan-500/10 border border-cyan-500/30">
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                  <p className="font-mono text-xs text-foreground">Uploading to IPFS...</p>
                </div>
              )}

              {/* Mobile Mint Button */}
              <Button
                type="submit"
                size="lg"
                disabled={!account || isProcessing}
                className="w-full lg:hidden bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold font-mono hover:from-cyan-400 hover:to-fuchsia-400 h-11 text-sm shadow-[0_0_20px_-5px_hsl(var(--primary))] tracking-wider disabled:opacity-50"
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
            </form>
          </Form>
        </div>

        {/* Right Sidebar: Avatar + Mint */}
        <div className="hidden lg:flex flex-col gap-4">
          {/* Avatar */}
          <div className="glass-panel border border-fuchsia-500/20 rounded-sm p-4 space-y-3">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
            <div className="relative w-full aspect-square max-w-[180px] mx-auto">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-full rounded-sm bg-background/50 border border-sidebar-border border-dashed flex flex-col items-center justify-center text-muted-foreground cursor-pointer hover:border-cyan-500 hover:text-cyan-400 transition-colors overflow-hidden"
              >
                {isGeneratingAvatar ? (
                  <div className="flex flex-col items-center gap-1">
                    <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                    <span className="text-[10px] font-mono text-cyan-400">GENERATING...</span>
                  </div>
                ) : avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <Upload className="w-5 h-5 mb-1" />
                    <span className="text-xs font-mono">UPLOAD AVATAR</span>
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
                        className={`absolute bottom-1.5 right-1.5 w-8 h-8 rounded-full flex items-center justify-center transition-all ${generationCount >= MAX_GENERATIONS
                          ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                          : "bg-fuchsia-500/80 hover:bg-fuchsia-500 text-white shadow-lg"
                          }`}
                      >
                        <Sparkles className="w-4 h-4" />
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
              <div className="flex gap-2 justify-center">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" variant="outline" size="sm" onClick={handleAcceptAvatar} className="border-green-500/50 text-green-400 hover:bg-green-500/10 h-7 w-7 p-0">
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Accept</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" variant="outline" size="sm" onClick={handleRegenerateAvatar} disabled={generationCount >= MAX_GENERATIONS}
                        className={`h-7 w-7 p-0 ${generationCount >= MAX_GENERATIONS ? "border-muted text-muted-foreground" : "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"}`}
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
              <Button type="button" variant="ghost" size="sm" onClick={() => { setAvatarFile(null); setAvatarPreview(null); setGeneratedAvatarUrl(null); }} className="w-full text-[10px] text-muted-foreground h-6">
                Remove
              </Button>
            )}
          </div>

          {/* Mint Info */}
          <div className="glass-panel border border-sidebar-border rounded-sm p-4 space-y-2 text-sm">
            <div className="space-y-1">
              <span className="text-muted-foreground font-mono text-xs">Network</span>
              <NetworkSelector showBalance={false} compact />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground font-mono">Contract</span>
              <span className="font-mono text-cyan-400">ERC8004</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground font-mono">Gas</span>
              <span className="font-mono text-green-400">Sponsored</span>
            </div>
          </div>

          {/* Mint Button */}
          <Button
            type="button"
            onClick={form.handleSubmit(onSubmit)}
            disabled={!account || isProcessing}
            className="w-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold font-mono hover:from-cyan-400 hover:to-fuchsia-400 h-12 text-base shadow-[0_0_20px_-5px_hsl(var(--primary))] tracking-wider disabled:opacity-50"
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
      </div>


      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="bg-background border-sidebar-border max-w-md">
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
            <div className="space-y-3 py-4 border-y border-sidebar-border">
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
              {selectedPlugins.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Plugins</span>
                  <span className="font-mono text-fuchsia-400">{selectedPlugins.length} selected</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Network</span>
                <span className="font-mono text-cyan-400">{CHAIN_CONFIG[selectedChainId]?.name || "Unknown"}</span>
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
  );
}
