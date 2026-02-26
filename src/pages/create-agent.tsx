import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Cpu, DollarSign, ShieldCheck, Upload, ExternalLink, Sparkles, Plug, Search, X, ChevronRight, Loader2, Play, AlertCircle, CheckCircle2, Boxes, Brain, ArrowRightLeft, Plus, Globe, RefreshCw, Check } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WarpAgentForm, type WarpAgentData } from "@/components/warp-form";
import { ModelSelector } from "@/components/model-selector";
import { type AIModel } from "@/lib/models";
import { useRegistryServers, useRegistrySearch, type RegistryServer, type ServerOrigin } from "@/hooks/use-registry";
import {
  uploadAgentAvatar,
  uploadAgentCard,
  getIpfsUri,
  getIpfsUrl,
  fileToDataUrl,
  isPinataConfigured,
  type AgentCard
} from "@/lib/pinata";
import {
  getAgentFactoryContract,
  computeDnaHash,
  deriveAgentWalletAddress,
  usdcToWei,
  getContractAddress
} from "@/lib/contracts";
import { CHAIN_IDS, CHAIN_CONFIG, inferencePriceWei, isCronosChain } from "@/lib/chains";
import { useChain } from "@/contexts/ChainContext";
import { NetworkSelector } from "@/components/ui/network-selector";
import { useActiveAccount, useAdminWallet } from "thirdweb/react";
import { useSendTransaction } from "thirdweb/react";
import { prepareContractCall, type Hex } from "thirdweb";
import { accountAbstraction } from "../lib/chains";
import { getAgentFactoryContractForChain } from "@/lib/contracts";
import { submitCronosTransaction, encodeContractCall } from "@/lib/cronos/aa";
import { saveMintSuccessForShare } from "@/lib/share";

const RUNTIME_URL = import.meta.env.VITE_RUNTIME_URL || "https://runtime.compose.market".replace(/\/+$/, "");
const MANOWAR_URL = import.meta.env.VITE_MANOWAR_URL || "https://manowar.compose.market".replace(/\/+$/, "");

interface SelectedHFModel {
  id: string;
  name: string;
  provider: string;
  priceMultiplier: number;
  contextLength: number;
}

interface SelectedPlugin {
  id: string;
  name: string;
  description: string;
  origin: ServerOrigin;
}

type FrameworkType = "eliza" | "langchain" | "openclaw";

interface Framework {
  id: FrameworkType;
  name: string;
  description: string;
  color: string;
  features: string[];
}

const FRAMEWORKS: Framework[] = [
  {
    id: "langchain",
    name: "LangChain",
    description: "LLM framework with LangGraph for stateful agents",
    color: "orange",
    features: ["Memory", "RAG", "Tool Calling", "State Graphs"],
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    description: "Skills-based autonomous agents with infinite memory and Backpack integrations",
    color: "emerald",
    features: ["Infinite Memory", "Skills", "Tool Calling", "Backpack Connectors"],
  },
  {
    id: "eliza",
    name: "ElizaOS",
    description: "Agent framework with 200+ plugins for blockchain, social, AI",
    color: "fuchsia",
    features: ["Memory", "RAG", "Natural Language Actions", "200+ Plugins"],
  },
];

const formSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().min(10),
  framework: z.enum(["eliza", "langchain", "openclaw"]),
  model: z.string(),
  licensePrice: z.string(),
  endpoint: z.string().url().optional().or(z.literal("")),
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
  const { selectedChainId } = useChain();
  const { mutateAsync: sendTransaction, isPending: isSending } = useSendTransaction();
  const adminWallet = useAdminWallet(); // EOA signer for Smart Account (needed for Cronos AA deployment)

  // Parse URL params
  const urlParams = new URLSearchParams(searchString);
  const isWarpMode = urlParams.get("warp") === "true";

  // Mode state: choice, scratch (create from scratch), or warp
  const [mode, setMode] = useState<CreateMode>("choice");
  const [warpAgent, setWarpAgent] = useState<WarpAgentData | null>(null);

  const [selectedHFModel, setSelectedHFModel] = useState<SelectedHFModel | null>(null);
  const [selectedPlugins, setSelectedPlugins] = useState<SelectedPlugin[]>([]);
  const [pluginSearch, setPluginSearch] = useState("");
  const [showPluginPicker, setShowPluginPicker] = useState(false);

  // Avatar upload state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [mintStep, setMintStep] = useState<"idle" | "uploading" | "minting" | "done">("idle");

  // Avatar generation state
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [generationCount, setGenerationCount] = useState(0);
  const [generatedAvatarUrl, setGeneratedAvatarUrl] = useState<string | null>(null);
  const MAX_GENERATIONS = 3;
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Check for selected HF model from models page
  useEffect(() => {
    const stored = sessionStorage.getItem("selectedHFModel");
    if (stored) {
      try {
        const model = JSON.parse(stored) as SelectedHFModel;
        setSelectedHFModel(model);
        sessionStorage.removeItem("selectedHFModel");
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Fetch plugins/MCPs
  const { data: searchData, isLoading: isSearching } = useRegistrySearch(
    pluginSearch,
    20
  );

  const { data: defaultPlugins, isLoading: isLoadingDefault } = useRegistryServers({
    origin: "goat,eliza,mcp",
    limit: 30,
  });

  const isLoadingPlugins = pluginSearch.trim() ? isSearching : isLoadingDefault;

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
      case "eliza": return "border-fuchsia-500/50 text-fuchsia-400 bg-fuchsia-500/10";
      case "mcp": return "border-cyan-500/50 text-cyan-400 bg-cyan-500/10";
      default: return "border-slate-500/50 text-slate-400 bg-slate-500/10";
    }
  };

  const getOriginLabel = (origin: ServerOrigin) => {
    switch (origin) {
      case "goat": return "GOAT";
      case "eliza": return "Eliza";
      case "mcp": return "MCP";
      default: return origin;
    }
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      framework: "langchain",
      model: "asi1-mini",
      licensePrice: "0.01",
      endpoint: "",
      isCloneable: false,
      licenses: "",
    },
  });

  const selectedFramework = form.watch("framework");

  // Filter plugins based on selected framework
  const availablePlugins = useMemo(() => {
    const servers = pluginSearch.trim() ? searchData?.servers : defaultPlugins?.servers;
    if (!servers) return [];

    // ElizaOS framework: show Eliza + GOAT plugins
    // LangChain framework: show GOAT + MCP plugins (MCP compatible)
    if (selectedFramework === "eliza") {
      return servers.filter(s => s.origin === "goat" || s.origin === "eliza");
    }
    return servers.filter(s => s.origin === "goat" || s.origin === "mcp");
  }, [pluginSearch, searchData?.servers, defaultPlugins?.servers, selectedFramework]);

  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

  // Update form when HF model is selected
  useEffect(() => {
    if (selectedHFModel) {
      form.setValue("model", selectedHFModel.id);
    }
  }, [selectedHFModel, form]);

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

  // Prepare transaction data for minting
  const [preparedTx, setPreparedTx] = useState<{
    chainId: number;
    dnaHash: `0x${string}`;
    walletAddress: `0x${string}`;
    walletTimestamp: number;
    licenses: bigint;
    licensePrice: bigint;
    cloneable: boolean;
    agentCardUri: string;
  } | null>(null);

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
      const modelId = selectedHFModel?.id || values.model;
      const skills = selectedPlugins.map(p => p.id);
      const timestamp = Date.now();

      // dnaHash = hash(skills, chainId, model) - NO timestamp (contract expects this)
      const dnaHash = computeDnaHash(skills, chainId, modelId);

      // Derive wallet from dnaHash + timestamp (timestamp makes each wallet unique)
      const walletAddress = deriveAgentWalletAddress(dnaHash, timestamp);

      // 3. Build and upload Agent Card to IPFS
      // walletAddress is stored here as the single source of truth
      // Both frontend and backend rely on this, not derive their own
      const agentCard: AgentCard = {
        schemaVersion: "1.0.0",
        name: values.name,
        description: values.description,
        skills,
        image: avatarUri || "none",
        avatar: avatarUri || "none",
        dnaHash, // Store computed dnaHash (skills, chainId, model)
        walletAddress,
        walletTimestamp: timestamp, // Backend needs this to derive the same private key
        chain: chainId,
        model: modelId,
        framework: values.framework,
        licensePrice: usdcToWei(parseFloat(values.licensePrice)).toString(),
        licenses: values.licenses ? parseInt(values.licenses) : 0,
        cloneable: values.isCloneable,
        endpoint: values.endpoint || undefined, // Optional - x402 handles routing
        protocols: [{ name: "Manowar", version: "1.0" }],
        plugins: selectedPlugins.map(p => ({
          registryId: p.id,
          name: p.name,
          origin: p.origin,
        })),
        createdAt: new Date(timestamp).toISOString(), // Use same timestamp
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

      setPreparedTx(txData);
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

  const handleMintSuccess = async (result: { transactionHash: string }) => {
    if (!preparedTx) {
      toast({
        title: "Minting Error",
        description: "Missing prepared mint transaction data",
        variant: "destructive",
      });
      return;
    }

    const chainId = preparedTx.chainId;
    const values = form.getValues();

    const walletAddress = preparedTx.walletAddress || null;

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

    if (account?.address && walletAddress) {
      try {
        const response = await fetch(`${MANOWAR_URL}/agent/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chainId,
            walletAddress,
            walletTimestamp: preparedTx.walletTimestamp,
            dnaHash: preparedTx.dnaHash,
            name: values.name,
            description: values.description,
            agentCardUri: preparedTx.agentCardUri,
            creator: account.address,
            model: selectedHFModel?.id || values.model,
            framework: values.framework,
            plugins: selectedPlugins.map(p => p.id),
          }),
        });

        if (!response.ok) {
          console.warn("Backend registration failed:", await response.text());
        }
      } catch (err) {
        console.error("Failed to register agent:", err);
      }
    }

    setLocation("/my-assets");
  };

  const handleMintError = (error: Error) => {
    console.error("Mint error:", error);
    setMintStep("idle");
    setPreparedTx(null);
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
      const factoryAddress = contract.address as `0x${string}`;

      // Chain-aware transaction execution
      if (isCronosChain(selectedChainId) && account) {
        // Cronos: Use our custom AA Paymaster flow (no ThirdWeb bundler available)
        console.log(`[mint] Using Cronos AA for chain ${selectedChainId}`);

        const mintData = encodeContractCall({
          abi: [{
            name: "mintAgent",
            type: "function",
            inputs: [
              { name: "dnaHash", type: "bytes32" },
              { name: "licenses", type: "uint256" },
              { name: "licensePrice", type: "uint256" },
              { name: "cloneable", type: "bool" },
              { name: "agentCardUri", type: "string" },
            ],
            outputs: [{ name: "agentId", type: "uint256" }],
          }],
          functionName: "mintAgent",
          args: [
            txData.dnaHash,
            txData.licenses,
            txData.licensePrice,
            txData.cloneable,
            txData.agentCardUri,
          ],
        });

        // Get admin wallet for signing (Smart Accounts return wrapped EIP-1271 signatures)
        const adminAddress = adminWallet?.getAccount()?.address as `0x${string}` | undefined;
        const adminAccount = adminWallet?.getAccount();
        if (adminAddress) {
          console.log(`[mint] Admin wallet (EOA signer): ${adminAddress}`);
        }

        const result = await submitCronosTransaction({
          account,
          to: factoryAddress,
          data: mintData,
          value: BigInt(0),
          chainId: selectedChainId,
          adminAddress, // For first-time Cronos transactions to deploy Smart Account
          adminWallet: adminAccount, // EOA for signing (raw ECDSA)
        });

        if (!result.success) {
          throw new Error(result.error || "Cronos transaction failed");
        }

        // Handle success
        await handleMintSuccess({ transactionHash: result.txHash! });
      } else {
        // Fuji/other chains: Use ThirdWeb sendTransaction (bundler available)
        console.log(`[mint] Using ThirdWeb for chain ${selectedChainId}`);

        const transaction = prepareContractCall({
          contract,
          method: "function mintAgent(bytes32 dnaHash, uint256 licenses, uint256 licensePrice, bool cloneable, string agentCardUri) returns (uint256 agentId)",
          params: [
            txData.dnaHash,
            txData.licenses,
            txData.licensePrice,
            txData.cloneable,
            txData.agentCardUri,
          ],
        });

        // Send transaction (gasless sponsorship configured on ThirdWeb)
        const result = await sendTransaction(transaction);

        // Handle success
        await handleMintSuccess({ transactionHash: result.transactionHash });
      }
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
    <div className="max-w-3xl mx-auto pb-20 px-1">
      {/* Page Header */}
      <div className="mb-6 sm:mb-8 space-y-2 border-b border-sidebar-border pb-4 sm:pb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode("choice")}
          className="text-muted-foreground hover:text-cyan-400 -ml-2 mb-2 text-xs sm:text-sm"
        >
          <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 rotate-180" />
          Back to Choice
        </Button>
        <div className="flex items-center gap-4">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-white">
            <span className="text-fuchsia-500 mr-2">//</span>
            MINT NEW AGENT
          </h1>
          <div className="hidden md:flex h-px w-32 bg-gradient-to-r from-fuchsia-500 to-transparent"></div>
        </div>
        <p className="text-muted-foreground font-mono text-xs sm:text-sm">Deploy a new autonomous entity with ERC8004 Identity.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        <div className="lg:col-span-2 order-2 lg:order-1">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <Card className="glass-panel border-cyan-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-bold font-display text-cyan-400">
                    <Cpu className="w-5 h-5" />
                    AGENT IDENTITY
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }: { field: ControllerRenderProps<FormValues, "name"> }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-foreground">Agent Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Alpha Sniper V1" {...field} className="bg-background/50 font-mono border-sidebar-border focus:border-cyan-500" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }: { field: ControllerRenderProps<FormValues, "description"> }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-foreground">Purpose & Capabilities</FormLabel>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="model"
                      render={({ field }: { field: ControllerRenderProps<FormValues, "model"> }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-foreground text-sm">LLM Model</FormLabel>
                          {selectedHFModel ? (
                            <div className="space-y-2">
                              <div className="p-3 rounded-sm bg-cyan-500/10 border border-cyan-500/30">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-mono font-bold text-cyan-400 text-sm">{selectedHFModel.name}</p>
                                    <p className="text-xs text-muted-foreground font-mono">
                                      via {selectedHFModel.provider} · ${(inferencePriceWei / 1_000_000).toFixed(3)}/call (x402)
                                    </p>
                                  </div>
                                  <Sparkles className="w-4 h-4 text-cyan-400" />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedHFModel(null)}
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                  Use built-in model
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <ModelSelector
                                value={field.value}
                                onChange={field.onChange}
                                placeholder="Search 1300+ models..."
                                showTaskFilter={true}
                              />
                              <p className="text-[10px] text-muted-foreground">
                                x402 pricing: ${(inferencePriceWei / 1_000_000).toFixed(3)}/call
                              </p>
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="endpoint"
                      render={({ field }: { field: ControllerRenderProps<FormValues, "endpoint"> }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-foreground">
                            API Endpoint <span className="text-muted-foreground text-xs">(optional)</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="https://api.myagent.com/v1" {...field} className="bg-background/50 font-mono border-sidebar-border focus:border-cyan-500" />
                          </FormControl>
                          <FormDescription className="text-xs">
                            Custom endpoint for self-hosted agents. Leave empty to use Compose.Market's hosted infrastructure.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Framework Selection */}
              <Card className="glass-panel border-orange-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-bold font-display text-orange-400">
                    <Boxes className="w-5 h-5" />
                    AGENT FRAMEWORK
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="framework"
                    render={({ field }: { field: ControllerRenderProps<FormValues, "framework"> }) => (
                      <FormItem>
                        <FormDescription className="text-xs mb-3">
                          Choose the runtime framework for your agent. Each includes built-in memory & RAG.
                          <Link href="/playground?tab=plugins">
                            <span className="text-orange-400 hover:text-orange-300 ml-1">Test plugins first →</span>
                          </Link>
                        </FormDescription>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                          {FRAMEWORKS.map((fw) => {
                            const isSelected = field.value === fw.id;
                            const colorClass = fw.color === "fuchsia"
                              ? "border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-400"
                              : "border-orange-500 bg-orange-500/10 text-orange-400";
                            return (
                              <button
                                key={fw.id}
                                type="button"
                                onClick={() => {
                                  field.onChange(fw.id);
                                  // Clear incompatible plugins when switching frameworks
                                  // GOAT works with both, Eliza plugins only with Eliza, MCP only with LangChain
                                  if (fw.id !== selectedFramework) {
                                    setSelectedPlugins(prev =>
                                      prev.filter(p => p.origin === "goat" ||
                                        (fw.id === "eliza" && p.origin === "eliza") ||
                                        (fw.id === "langchain" && p.origin === "mcp")
                                      )
                                    );
                                  }
                                }}
                                className={`p-2.5 sm:p-3 rounded-sm border text-left transition-all touch-manipulation ${isSelected
                                  ? colorClass
                                  : "border-sidebar-border bg-background/30 hover:border-sidebar-border/80"
                                  }`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  {fw.id === "eliza" ? (
                                    <Brain className="w-4 h-4" />
                                  ) : (
                                    <Boxes className="w-4 h-4" />
                                  )}
                                  <span className="font-mono font-bold text-xs sm:text-sm">{fw.name}</span>
                                  {isSelected && <CheckCircle2 className="w-3 h-3 ml-auto" />}
                                </div>
                                <p className="text-[9px] sm:text-[10px] text-muted-foreground line-clamp-2">{fw.description}</p>
                                <div className="flex flex-wrap gap-1 mt-1.5 sm:mt-2">
                                  {fw.features.slice(0, 2).map((f) => (
                                    <span key={f} className="text-[7px] sm:text-[8px] px-1 py-0.5 rounded bg-white/5 text-muted-foreground">
                                      {f}
                                    </span>
                                  ))}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Plugin/Capability Picker */}
              <Card className="glass-panel border-green-500/20 relative z-10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-bold font-display text-green-400">
                    <Plug className="w-5 h-5" />
                    PLUGINS & CAPABILITIES
                    <Badge variant="outline" className="ml-2 text-[10px] border-sidebar-border">
                      {selectedFramework === "eliza" ? "ElizaOS + GOAT" : "MCP + GOAT"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Selected Plugins */}
                  {selectedPlugins.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedPlugins.map(plugin => (
                        <Badge
                          key={plugin.id}
                          variant="outline"
                          className={`${getOriginColor(plugin.origin)} pl-2 pr-1 py-1 text-xs font-mono`}
                        >
                          {plugin.name}
                          <button
                            type="button"
                            onClick={() => removePlugin(plugin.id)}
                            className="ml-1 p-0.5 rounded hover:bg-white/10"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Plugin Search */}
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder={`Search ${selectedFramework === "eliza" ? "ElizaOS, GOAT" : "MCP, GOAT"} plugins...`}
                        value={pluginSearch}
                        onChange={(e) => {
                          setPluginSearch(e.target.value);
                          setShowPluginPicker(true);
                        }}
                        onFocus={() => setShowPluginPicker(true)}
                        className="pl-10 bg-background/50 font-mono border-sidebar-border focus:border-green-500"
                      />
                    </div>

                    {/* Dropdown Results */}
                    {showPluginPicker && (
                      <div className="absolute z-50 w-full mt-1 bg-sidebar border border-sidebar-border rounded-sm shadow-lg">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
                          <span className="text-[10px] font-mono text-muted-foreground uppercase">
                            {pluginSearch ? "Search Results" : "Popular Plugins"}
                          </span>
                          <Link href="/registry">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-[10px] text-green-400 hover:text-green-300 h-auto py-0.5 px-1"
                            >
                              See all <ChevronRight className="w-3 h-3 ml-0.5" />
                            </Button>
                          </Link>
                        </div>
                        <ScrollArea className="h-48">
                          {isLoadingPlugins ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : availablePlugins.length === 0 ? (
                            <div className="py-8 text-center text-xs text-muted-foreground">
                              No plugins found
                            </div>
                          ) : (
                            <div className="p-1">
                              {availablePlugins.map(server => {
                                const isSelected = selectedPlugins.some(p => p.id === server.registryId);
                                const isTestable = server.origin === "goat" || server.origin === "eliza";
                                return (
                                  <button
                                    key={server.registryId}
                                    type="button"
                                    onClick={() => addPlugin(server)}
                                    disabled={isSelected}
                                    className={`w-full text-left p-2 rounded-sm text-xs transition-all ${isSelected
                                      ? "opacity-50 cursor-not-allowed"
                                      : "hover:bg-green-500/10"
                                      }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className={`${getOriginColor(server.origin)} text-[9px] px-1 py-0`}
                                      >
                                        {getOriginLabel(server.origin)}
                                      </Badge>
                                      <span className="font-mono text-foreground truncate flex-1">
                                        {server.name}
                                      </span>
                                      {isTestable && (
                                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-cyan-500/30 text-cyan-400">
                                          <Play className="w-2 h-2 mr-0.5" />
                                          Testable
                                        </Badge>
                                      )}
                                      {isSelected && <span className="text-green-400 text-[10px]">Added</span>}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5 ml-12">
                                      {server.description}
                                    </p>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </ScrollArea>
                        <div className="px-3 py-2 border-t border-sidebar-border">
                          <button
                            type="button"
                            onClick={() => setShowPluginPicker(false)}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Add DeFi tools (GOAT) or AI capabilities (ElizaOS) to your agent.
                  </p>
                </CardContent>
              </Card>

              <Card className="glass-panel border-fuchsia-500/20">
                <CardHeader className="p-4 sm:p-6">
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg font-bold font-display text-fuchsia-400">
                    <DollarSign className="w-4 h-4 sm:w-5 sm:h-5" />
                    FINANCIAL SPECS (x402)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 p-4 sm:p-6 pt-0 sm:pt-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="licensePrice"
                      render={({ field }: { field: ControllerRenderProps<FormValues, "licensePrice"> }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-foreground text-sm">License Price (USDC)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.001" {...field} className="bg-background/50 font-mono border-sidebar-border focus:border-fuchsia-500" />
                          </FormControl>
                          <FormDescription className="text-muted-foreground text-[10px] sm:text-xs">
                            Cost to license into a Manowar
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="licenses"
                      render={({ field }: { field: ControllerRenderProps<FormValues, "licenses"> }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-foreground text-sm">License Supply</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="∞ (leave empty)" {...field} className="bg-background/50 font-mono border-sidebar-border focus:border-fuchsia-500" />
                          </FormControl>
                          <FormDescription className="text-muted-foreground text-[10px] sm:text-xs">
                            Max licenses (empty = infinite)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="isCloneable"
                    render={({ field }: { field: ControllerRenderProps<FormValues, "isCloneable"> }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-sm border border-sidebar-border p-4 bg-background/30">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base font-mono text-foreground">Allow Cloning?</FormLabel>
                          <FormDescription className="text-muted-foreground">
                            Let others fork this agent with modified parameters.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
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
                        <p className="text-xs text-muted-foreground">Storing avatar and agent card metadata</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Single mint button - confirmation triggers IPFS upload + on-chain mint */}
              <Button
                type="submit"
                size="lg"
                disabled={!account || isProcessing}
                className="w-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold font-mono hover:from-cyan-400 hover:to-fuchsia-400 h-14 text-lg shadow-[0_0_20px_-5px_hsl(var(--primary))] tracking-wider disabled:opacity-50"
              >
                {mintStep === "uploading" ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    UPLOADING TO IPFS...
                  </>
                ) : mintStep === "minting" ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    MINTING ON-CHAIN...
                  </>
                ) : !account ? (
                  "SIGN IN TO MINT"
                ) : (
                  "MINT AGENT"
                )}
              </Button>
            </form>
          </Form>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-4 sm:space-y-6 order-1 lg:order-2">
          {/* Avatar Upload */}
          <div className="glass-panel p-4 sm:p-6 rounded-sm space-y-4 border border-fuchsia-500/20 corner-decoration">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarSelect}
              className="hidden"
            />
            {/* Avatar canvas with generate button overlay */}
            <div className="relative w-full aspect-square max-w-[200px] lg:max-w-none mx-auto">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-full rounded-sm bg-background/50 border border-sidebar-border border-dashed flex flex-col items-center justify-center text-muted-foreground cursor-pointer hover:border-cyan-500 hover:text-cyan-400 transition-colors overflow-hidden touch-manipulation"
              >
                {isGeneratingAvatar ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                    <span className="text-xs font-mono text-cyan-400">GENERATING...</span>
                  </div>
                ) : avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <Upload className="w-6 h-6 sm:w-8 sm:h-8 mb-2" />
                    <span className="text-[10px] sm:text-xs font-mono">UPLOAD AVATAR</span>
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

            {/* Remove avatar button - only show when not in generated state */}
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
                className="w-full text-xs text-muted-foreground"
              >
                Remove avatar
              </Button>
            )}
            <div className="space-y-2">
              <h3 className="font-bold font-display text-white">Minting Info</h3>
              <div className="space-y-1">
                <span className="text-muted-foreground font-mono text-sm">Network</span>
                <NetworkSelector showBalance={false} compact />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground font-mono">Contract</span>
                <span className="font-mono text-cyan-400">ERC8004</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground font-mono">Storage</span>
                <span className="font-mono text-cyan-400">Pinata IPFS</span>
              </div>
            </div>
          </div>

          {/* Account Status */}
          <div className={`p-4 rounded-sm border text-sm ${account
            ? "bg-green-500/10 border-green-500/20 text-green-200"
            : "bg-yellow-500/10 border-yellow-500/20 text-yellow-200"
            }`}>
            {account ? (
              <>
                <CheckCircle2 className="w-5 h-5 mb-2 text-green-400" />
                <p>
                  Signed in: <span className="font-mono">{account.address.slice(0, 6)}...{account.address.slice(-4)}</span>
                </p>
                <p className="text-xs text-green-300/70 mt-1">Gas sponsored • No fees</p>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 mb-2 text-yellow-400" />
                <p>Sign in with email, social, or wallet to mint.</p>
              </>
            )}
          </div>

          <div className="p-4 rounded-sm bg-cyan-500/10 border border-cyan-500/20 text-sm text-cyan-200">
            <ShieldCheck className="w-5 h-5 mb-2 text-cyan-400" />
            <p>
              Your agent will be verified by the <strong>Manowar Curator Protocol</strong>.
              Initial reputation score will be assigned based on metadata quality.
            </p>
          </div>
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
                <span className={`font-mono ${pendingValues.framework === "langchain"
                  ? "text-orange-400"
                  : pendingValues.framework === "openclaw"
                    ? "text-emerald-400"
                    : "text-fuchsia-400"
                  }`}>
                  {pendingValues.framework === "langchain"
                    ? "LangChain"
                    : pendingValues.framework === "openclaw"
                      ? "OpenClaw"
                      : "ElizaOS"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Model</span>
                <span className="font-mono text-cyan-400">{selectedHFModel?.name || pendingValues.model}</span>
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
