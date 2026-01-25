/**
 * Compose Page
 * 
 * Visual workflow builder for orchestrating AI agents and MCP tools.
 * Uses ReactFlow for the canvas and x402 for payment integration.
 * 
 * Refactored from 3369 lines using extracted components:
 * - @/components/compose/nodes (StepNode, AgentNode, TriggerNode, HookNode)
 * - @/components/compose/pickers (ConnectorPicker, AgentsPicker, TriggerPicker)
 * - @/components/compose (FloatingToolbox, FullscreenOverlay)
 * - @/hooks/use-workflow
 */

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  MarkerType,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Loader2, CheckCircle2,
  Plug, Settings, Bot, ExternalLink,
  Sparkles, Upload, DollarSign, Clock, AlertCircle,
  ArrowRightLeft, Globe, Maximize2, RefreshCw, Check
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useActiveAccount, useActiveWallet, useSendTransaction } from "thirdweb/react";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { prepareContractCall } from "thirdweb";
import { readContract } from "thirdweb";
import {
  getManowarContract, getContractAddress, getAgentFactoryContract,
  weiToUsdc, computeManowarDnaHash, deriveManowarWalletAddress
} from "@/lib/contracts";
import {
  uploadManowarBanner, uploadManowarMetadata, getIpfsUri, getIpfsUrl,
  fileToDataUrl, isPinataConfigured, fetchFromIpfs,
  type ManowarMetadata, type AgentCard
} from "@/lib/pinata";
import { CHAIN_IDS, CHAIN_CONFIG, thirdwebClient, getPaymentTokenContract } from "@/lib/facilitator";
import { useChain } from "@/contexts/ChainContext";
import { NetworkSelector } from "@/components/ui/network-selector";
import { createNormalizedFetch } from "@/lib/payment";
import { coordinatorModels } from "@/hooks/use-coordinator";
import { useSession } from "@/hooks/use-session.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useWorkflowExecution } from "@/hooks/use-services";
import { useWorkflow } from "@/hooks/use-workflow";
import type { WorkflowStep } from "@/lib/services";
import { WorkflowOutputPanel, type WorkflowExecutionResult } from "@/components/output";
import { AGENT_REGISTRIES, type Agent } from "@/lib/agents";
import { RFAComponent } from "@/components/RFAComponent";

// Extracted components
import {
  StepNode, AgentNode, TriggerNode, HookNode,
  type StepNodeData, type AgentNodeData,
} from "@/components/compose/nodes";
import { ConnectorPicker, AgentsPicker } from "@/components/compose/pickers";
import { FullscreenOverlay } from "@/components/compose/overlay";

// =============================================================================
// Node Types Registration
// =============================================================================

const nodeTypes = {
  stepNode: StepNode,
  agentNode: AgentNode,
  triggerNode: TriggerNode,
  hookNode: HookNode,
};

// =============================================================================
// Mint Manowar Dialog
// =============================================================================

interface MintManowarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  workflowDescription: string;
  agentIds: number[];
  agentPrices?: Map<number, bigint>;
}

function MintManowarDialog({
  open, onOpenChange, workflowName, workflowDescription, agentIds,
  agentPrices = new Map()
}: MintManowarDialogProps) {
  const { toast } = useToast();
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const { selectedChainId } = useChain();
  const { mutateAsync: sendTransaction } = useSendTransaction();

  const [title, setTitle] = useState(workflowName);
  const [description, setDescription] = useState(workflowDescription);
  const [x402Price, setX402Price] = useState("0.01");
  const [units, setUnits] = useState("");
  const [leaseEnabled, setLeaseEnabled] = useState(false);
  const [leaseDuration, setLeaseDuration] = useState("30");
  const [leasePercent, setLeasePercent] = useState("10");
  const [coordinatorModel, setCoordinatorModel] = useState("");
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [isMinting, setIsMinting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Banner generation state
  const [isGeneratingBanner, setIsGeneratingBanner] = useState(false);
  const [generatedBannerUrl, setGeneratedBannerUrl] = useState<string | null>(null);
  const [bannerGenerationCount, setBannerGenerationCount] = useState(0);
  const MAX_BANNER_GENERATIONS = 3;

  const totalAgentPrice = useMemo(() => {
    let total = BigInt(0);
    for (const agentId of agentIds) {
      const price = agentPrices.get(agentId) || BigInt(0);
      total += price;
    }
    return total;
  }, [agentIds, agentPrices]);

  const totalAgentPriceFormatted = weiToUsdc(totalAgentPrice);

  useEffect(() => {
    setTitle(workflowName);
    setDescription(workflowDescription);
  }, [workflowName, workflowDescription]);

  const handleBannerSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file type", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large (max 5MB)", variant: "destructive" });
      return;
    }
    setBannerFile(file);
    const dataUrl = await fileToDataUrl(file);
    setBannerPreview(dataUrl);
    setGeneratedBannerUrl(null);
  };

  const API_URL = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");

  const handleGenerateBanner = async () => {
    if (bannerGenerationCount >= MAX_BANNER_GENERATIONS) {
      toast({
        title: "Generation limit reached",
        description: `You can generate up to ${MAX_BANNER_GENERATIONS} banners per session.`,
        variant: "destructive",
      });
      return;
    }
    if (!title?.trim() || !description?.trim()) {
      toast({
        title: "Title and description required",
        description: "Add both before generating a banner",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingBanner(true);
    try {
      const response = await fetch(`${API_URL}/api/generate-banner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Generation failed");
      }
      const { imageUrl } = await response.json();
      const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return new File([blob], filename, { type: blob.type });
      };
      const bannerFileName = `${title.replace(/\s+/g, "_")}_banner.png`;
      const generatedFile = await dataUrlToFile(imageUrl, bannerFileName);
      setGeneratedBannerUrl(imageUrl);
      setBannerPreview(imageUrl);
      setBannerFile(generatedFile);
      setBannerGenerationCount(prev => prev + 1);
      toast({ title: "Banner generated!", description: `Generation ${bannerGenerationCount + 1}/${MAX_BANNER_GENERATIONS}` });
    } catch (error) {
      toast({
        title: "Generation failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingBanner(false);
    }
  };

  const handleMintClick = () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    if (!wallet) {
      toast({ title: "Wallet not connected", variant: "destructive" });
      return;
    }
    if (!isPinataConfigured()) {
      toast({ title: "IPFS not configured", variant: "destructive" });
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleConfirmMint = async () => {
    setShowConfirmDialog(false);
    try {
      setIsMinting(true);
      let bannerImageUri = "";
      if (bannerFile) {
        const bannerCid = await uploadManowarBanner(bannerFile, title);
        bannerImageUri = getIpfsUri(bannerCid);
      }
      const mintTimestamp = Math.floor(Date.now() / 1000);
      const dnaHash = computeManowarDnaHash(agentIds, mintTimestamp);
      const walletAddress = deriveManowarWalletAddress(dnaHash, mintTimestamp);
      const agentFactoryContract = getAgentFactoryContract();
      const nestedAgentCards: AgentCard[] = [];
      for (const agentId of agentIds) {
        try {
          const agentData = await readContract({
            contract: agentFactoryContract,
            method: "function getAgentData(uint256 agentId) view returns ((bytes32 dnaHash, uint256 licenses, uint256 licensesMinted, uint256 licensePrice, address creator, bool cloneable, bool isClone, uint256 parentAgentId, string agentCardUri))",
            params: [BigInt(agentId)],
          }) as { agentCardUri: string };
          if (agentData.agentCardUri?.startsWith("ipfs://")) {
            const cid = agentData.agentCardUri.replace("ipfs://", "");
            const agentCard = await fetchFromIpfs<AgentCard>(cid);
            nestedAgentCards.push(agentCard);
          }
        } catch (err) {
          console.warn(`Failed to fetch agentCard for agent ${agentId}:`, err);
        }
      }
      const metadata: ManowarMetadata = {
        schemaVersion: "1.0.0",
        title,
        description,
        image: bannerImageUri ? getIpfsUrl(bannerImageUri.replace("ipfs://", "")) : undefined,
        dnaHash,
        walletAddress,
        walletTimestamp: mintTimestamp,
        agents: nestedAgentCards,
        coordinator: coordinatorModel ? { hasCoordinator: true, model: coordinatorModel } : undefined,
        pricing: { totalAgentPrice: totalAgentPrice.toString() },
        lease: leaseEnabled ? {
          enabled: true,
          durationDays: parseInt(leaseDuration),
          creatorPercent: parseInt(leasePercent),
        } : undefined,
        creator: account?.address || "",
        createdAt: new Date().toISOString(),
      };
      const metadataCid = await uploadManowarMetadata(metadata);
      const manowarCardUri = getIpfsUri(metadataCid);
      const manowarContract = getManowarContract();
      const usdcContract = getPaymentTokenContract();
      const manowarAddress = getContractAddress("Manowar");
      const mintTransaction = prepareContractCall({
        contract: manowarContract,
        method: "function mintManowar((string title, string description, string banner, string manowarCardUri, uint256 units, bool leaseEnabled, uint256 leaseDuration, uint8 leasePercent, bool hasCoordinator, string coordinatorModel) params, uint256[] agentIds) returns (uint256 manowarId)",
        params: [
          {
            title,
            description,
            banner: bannerImageUri,
            manowarCardUri,
            units: units ? BigInt(parseInt(units)) : BigInt(1),
            leaseEnabled,
            leaseDuration: BigInt(parseInt(leaseDuration) || 0),
            leasePercent: parseInt(leasePercent) || 0,
            hasCoordinator: !!coordinatorModel,
            coordinatorModel: coordinatorModel || "",
          },
          agentIds.map(id => BigInt(id)),
        ],
      });
      if (totalAgentPrice > BigInt(0)) {
        const approvalTx = prepareContractCall({
          contract: usdcContract,
          method: "function approve(address spender, uint256 amount) returns (bool)",
          params: [manowarAddress, totalAgentPrice],
        });
        await sendTransaction(approvalTx);
      }
      const result = await sendTransaction(mintTransaction);
      toast({
        title: "Manowar Minted!",
        description: (
          <div className="space-y-1">
            <p>{title} deployed to {CHAIN_CONFIG[selectedChainId]?.name || 'testnet'}.</p>
            {totalAgentPrice > BigInt(0) && (
              <p className="text-xs text-muted-foreground">
                ${totalAgentPriceFormatted} USDC paid to agent creators
              </p>
            )}
            <a
              href={`${CHAIN_CONFIG[selectedChainId].explorer}/tx/${result.transactionHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline text-xs flex items-center gap-1"
            >
              View transaction <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ),
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Minting Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg md:max-w-2xl bg-card border-fuchsia-500/30 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-lg sm:text-xl flex items-center gap-2">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-fuchsia-400" />
              Mint as Manowar
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Deploy this workflow as an ERC-7401 nestable NFT on {CHAIN_CONFIG[selectedChainId]?.name || 'testnet'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-4">
              <div>
                <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground mb-2 block">BANNER IMAGE</Label>
                <input ref={bannerInputRef} type="file" accept="image/*" onChange={handleBannerSelect} className="hidden" />
                <div className="relative w-full">
                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    className="w-full h-20 rounded-sm bg-background/50 border border-sidebar-border border-dashed flex items-center justify-center text-muted-foreground hover:border-fuchsia-500 hover:text-fuchsia-400 transition-colors overflow-hidden"
                  >
                    {isGeneratingBanner ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                        <span className="text-xs font-mono text-fuchsia-400">GENERATING...</span>
                      </div>
                    ) : bannerPreview ? (
                      <img src={bannerPreview} alt="Banner" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        <span className="text-xs font-mono">Upload banner</span>
                      </div>
                    )}
                  </button>
                  {!isGeneratingBanner && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleGenerateBanner(); }}
                            disabled={bannerGenerationCount >= MAX_BANNER_GENERATIONS}
                            className={`absolute bottom-1 right-1 w-8 h-8 rounded-full flex items-center justify-center transition-all ${bannerGenerationCount >= MAX_BANNER_GENERATIONS
                              ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                              : "bg-fuchsia-500/80 hover:bg-fuchsia-500 text-white shadow-lg"
                              }`}
                          >
                            <Sparkles className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {bannerGenerationCount >= MAX_BANNER_GENERATIONS
                            ? `Limit reached (${MAX_BANNER_GENERATIONS}/${MAX_BANNER_GENERATIONS})`
                            : `Generate Banner (${bannerGenerationCount}/${MAX_BANNER_GENERATIONS})`}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {generatedBannerUrl && !isGeneratingBanner && (
                  <div className="flex gap-2 justify-center mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setGeneratedBannerUrl(null); toast({ title: "Banner accepted" }); }}
                      className="border-green-500/50 text-green-400 h-7"
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateBanner}
                      disabled={bannerGenerationCount >= MAX_BANNER_GENERATIONS}
                      className="border-cyan-500/50 text-cyan-400 h-7"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground">TITLE</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My Workflow" className="bg-background/50 font-mono border-sidebar-border h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground">DESCRIPTION</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this workflow do?" className="bg-background/50 font-mono border-sidebar-border resize-none h-16" rows={2} />
              </div>
            </div>
            <div className="space-y-4">
              {/* Network Selector */}
              <div className="space-y-2">
                <Label className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                  <Globe className="w-3 h-3" /> DEPLOYMENT NETWORK
                </Label>
                <NetworkSelector showBalance />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> X402 PRICE (USDC)
                  </Label>
                  <Input type="number" step="0.001" value={x402Price} onChange={(e) => setX402Price(e.target.value)} className="bg-background/50 font-mono border-sidebar-border" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">SUPPLY CAP</Label>
                  <Input type="number" min="1" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="1 (default)" className="bg-background/50 font-mono border-sidebar-border" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-mono text-muted-foreground">COORDINATOR MODEL (optional)</Label>
                <Select value={coordinatorModel || "none"} onValueChange={(v) => setCoordinatorModel(v === "none" ? "" : v)}>
                  <SelectTrigger className="bg-background/50 border-sidebar-border">
                    <SelectValue placeholder="No coordinator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No coordinator</SelectItem>
                    {coordinatorModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-2">
                          <span>{model.name}</span>
                          <span className="text-[10px] text-muted-foreground">({model.provider})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between p-3 rounded-sm border border-sidebar-border bg-background/30">
                <div className="space-y-0.5">
                  <Label className="text-sm font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Enable Leasing
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Allow others to lease this workflow</p>
                </div>
                <Switch checked={leaseEnabled} onCheckedChange={setLeaseEnabled} />
              </div>
              {leaseEnabled && (
                <div className="grid grid-cols-2 gap-3 pl-4 border-l-2 border-fuchsia-500/30">
                  <div className="space-y-2">
                    <Label className="text-xs font-mono text-muted-foreground">DURATION (days)</Label>
                    <Input type="number" value={leaseDuration} onChange={(e) => setLeaseDuration(e.target.value)} className="bg-background/50 font-mono border-sidebar-border" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-mono text-muted-foreground">YOUR % (max 20)</Label>
                    <Input type="number" max={20} value={leasePercent} onChange={(e) => setLeasePercent(e.target.value)} className="bg-background/50 font-mono border-sidebar-border" />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="py-2">
            {!wallet && (
              <div className="flex items-center gap-2 p-2 rounded-sm bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-xs">
                <AlertCircle className="w-3 h-3" /> Connect wallet to mint (gas sponsored)
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
          {agentIds.length > 0 && (
            <div className="p-3 rounded-sm border border-sidebar-border bg-background/30">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{agentIds.length} agent{agentIds.length > 1 ? "s" : ""} • Total cost:</span>
                <span className="font-mono text-cyan-400 font-semibold">${totalAgentPriceFormatted} USDC</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMinting}>Cancel</Button>
            <Button onClick={handleMintClick} disabled={!wallet || isMinting} className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold">
              {isMinting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Minting...</> : <><Sparkles className="w-4 h-4 mr-2" />Mint Manowar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="bg-card border-cyan-500/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-cyan-400" /> Confirm Minting Cost
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center py-2 border-b border-sidebar-border">
                  <span>Agents included:</span><span className="font-mono">{agentIds.length}</span>
                </div>
                <div className="flex justify-between items-center text-lg font-semibold">
                  <span>Total Cost:</span><span className="text-cyan-400 font-mono">${totalAgentPriceFormatted} USDC</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {Number(totalAgentPriceFormatted) > 0 ? "This amount will be distributed to agent creators. Gas is sponsored." : "No USDC cost. Gas is sponsored."}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmMint} className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold">
              <Sparkles className="w-4 h-4 mr-2" /> Confirm & Mint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// =============================================================================
// Run Workflow Dialog
// =============================================================================

interface RunWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  stepCount: number;
  isRunning: boolean;
  onRun: (prompt: string) => void;
}

function RunWorkflowDialog({ open, onOpenChange, workflowName, stepCount, isRunning, onRun }: RunWorkflowDialogProps) {
  const [prompt, setPrompt] = useState("");
  const handleSubmit = () => {
    if (prompt.trim()) {
      onRun(prompt.trim());
      setPrompt("");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-green-500/30 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Play className="w-5 h-5 text-green-400" /> Run {workflowName || "Workflow"}
          </DialogTitle>
          <DialogDescription>
            Enter a task or prompt for the workflow coordinator to execute.
            The AI supervisor will delegate to the {stepCount} agent{stepCount !== 1 ? "s" : ""} in this workflow.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-xs font-mono text-muted-foreground">TASK / PROMPT</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Research the top 5 AI tokens by market cap..."
              className="bg-background/50 font-mono border-sidebar-border resize-none text-sm"
              rows={4}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRunning}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!prompt.trim() || isRunning} className="bg-green-500 hover:bg-green-600 text-white font-bold">
            {isRunning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Executing...</> : <><Play className="w-4 h-4 mr-2" />Execute Workflow</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Main ComposeFlow Component
// =============================================================================

function ComposeFlow() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const wallet = useActiveWallet();
  const { sessionActive, budgetRemaining } = useSession();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // UI state - start in fullscreen mode by default
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [showMintDialog, setShowMintDialog] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showOutputPanel, setShowOutputPanel] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showWarpDialog, setShowWarpDialog] = useState(false);
  const [showRFADialog, setShowRFADialog] = useState(false);
  const [pendingWarpAgent, setPendingWarpAgent] = useState<Agent | null>(null);
  const [workflowResult, setWorkflowResult] = useState<WorkflowExecutionResult | null>(null);
  const [pendingManowarId] = useState<number | null>(null);

  // Use the extracted workflow hook
  const {
    nodes, setNodes, onNodesChange,
    edges, onEdgesChange,
    onConnect, onInit, onDrop, onDragOver,
    workflowName, setWorkflowName,
    workflowDescription, setWorkflowDescription,
    inputJson, setInputJson,
    currentWorkflow,
    workflowAgentIds, agentPrices,
    handleAddStep, handleAddAgentStep,
  } = useWorkflow({
    onWarpRequired: (agent) => {
      setPendingWarpAgent(agent);
      setShowWarpDialog(true);
    },
  });

  // Add trigger handler
  const handleAddTrigger = useCallback((trigger: Partial<import("@/lib/triggers").TriggerDefinition>) => {
    const id = `trigger_${Date.now()}`;
    const newNode = {
      id,
      type: "triggerNode",
      position: { x: 100, y: nodes.length * 120 + 100 },
      data: {
        trigger: {
          id,
          name: trigger.name || "Trigger",
          type: trigger.type || "cron",
          cronExpression: trigger.cronExpression,
          cronReadable: trigger.cronReadable,
          enabled: trigger.enabled ?? true,
        },
        status: "pending",
      },
    };
    setNodes((nds) => [...nds, newNode]);
    toast({ title: "Trigger Added", description: trigger.cronReadable || trigger.name });
  }, [nodes.length, setNodes, toast]);

  const { isRunning } = useWorkflowExecution();

  // Handle warp navigation
  const handleWarpAgent = useCallback(() => {
    if (pendingWarpAgent) {
      sessionStorage.setItem("warpAgent", JSON.stringify(pendingWarpAgent));
      setLocation("/create-agent?warp=true");
    }
    setShowWarpDialog(false);
    setPendingWarpAgent(null);
  }, [pendingWarpAgent, setLocation]);

  // Run workflow with x402 payment via Manowar backend
  const handleRun = useCallback(async (userPrompt: string) => {
    if (currentWorkflow.steps.length === 0) {
      toast({ title: "No Steps", description: "Add at least one step to run the workflow", variant: "destructive" });
      return;
    }
    if (!wallet) {
      toast({ title: "Connect Wallet", description: "Please connect your wallet for x402 payment", variant: "destructive" });
      return;
    }
    setShowRunDialog(false);

    let additionalInput: Record<string, unknown> = {};
    try { additionalInput = JSON.parse(inputJson || "{}"); } catch { }
    const input = { task: userPrompt, prompt: userPrompt, message: userPrompt, ...additionalInput };

    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...(n.data as StepNodeData), status: "pending", error: undefined } as StepNodeData,
    })));

    try {
      setNodes((nds) => {
        const updated = [...nds];
        if (updated[0]) updated[0] = { ...updated[0], data: { ...(updated[0].data as StepNodeData), status: "running" } as StepNodeData };
        return updated;
      });

      const normalizedFetch = createNormalizedFetch();
      const fetchWithPayment = wrapFetchWithPayment(
        normalizedFetch, thirdwebClient, wallet,
        { maxValue: BigInt(10000 + (5000 * currentWorkflow.steps.length)) }
      );

      const workflowPayload = {
        workflow: {
          id: currentWorkflow.id,
          name: currentWorkflow.name || "Untitled",
          description: currentWorkflow.description || "",
          steps: nodes.map((node) => {
            const nodeData = node.data as StepNodeData | (AgentNodeData & { step: WorkflowStep });
            const step = nodeData.step;
            const agent = "agent" in nodeData ? (nodeData as AgentNodeData).agent : undefined;
            const isAgent = node.type === "agentNode" && agent;
            return {
              id: step.id, name: step.name || step.connectorId || "Step",
              type: isAgent ? "agent" : "mcpTool",
              connectorId: step.connectorId, toolName: step.toolName,
              agentId: isAgent && agent?.onchainAgentId ? agent.onchainAgentId : undefined,
              agentAddress: isAgent ? (step.inputTemplate?.agentAddress as string) : undefined,
              inputTemplate: step.inputTemplate || {}, saveAs: step.saveAs || `step_${step.id}`,
            };
          }),
          edges: edges.map(e => ({ source: e.source, target: e.target, label: e.label })),
        },
        input,
      };

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionActive && budgetRemaining > 0) {
        headers["x-session-active"] = "true";
        headers["x-session-budget-remaining"] = budgetRemaining.toString();
      }

      const response = await fetchWithPayment("https://manowar.compose.market/manowar/execute", {
        method: "POST", headers, body: JSON.stringify(workflowPayload),
      });

      if (!response.ok) throw new Error(`Workflow execution failed: ${await response.text()}`);

      const result = await response.json() as {
        success: boolean; workflowId: string; status: string;
        steps: Array<{ stepId: string; stepName: string; status: string; error?: string }>;
        output: Record<string, unknown>; totalCostWei: string; error?: string;
      };

      setNodes((nds) => nds.map((n) => {
        const stepResult = result.steps.find((s) => s.stepId === n.id);
        return { ...n, data: { ...(n.data as StepNodeData), status: stepResult?.status || "pending", error: stepResult?.error } as StepNodeData };
      }));

      setWorkflowResult({
        ...result,
        steps: result.steps.map(s => ({ ...s, status: s.status as "pending" | "running" | "success" | "error" }))
      });
      setShowOutputPanel(true);

      toast({
        title: result.success ? "Workflow Complete" : "Workflow Failed",
        description: result.success
          ? `Executed ${result.steps.length} steps. Cost: $${(parseInt(result.totalCostWei) / 1_000_000).toFixed(4)}`
          : `Failed: ${result.error || "Unknown error"}`,
        variant: result.success ? "default" : "destructive",
      });
    } catch (err) {
      toast({ title: "Execution Error", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  }, [currentWorkflow, inputJson, nodes, edges, setNodes, toast, wallet, sessionActive, budgetRemaining]);

  return (
    <div className="min-h-[calc(100vh-120px)] lg:h-[calc(100vh-100px)] flex flex-col lg:flex-row gap-3 lg:gap-4 pb-4">
      {/* Sidebar - Picker Tabs */}
      <Card className="w-full lg:w-80 h-auto max-h-[40vh] lg:max-h-none lg:h-full flex flex-col glass-panel border-cyan-500/20 shrink-0 overflow-hidden">
        <CardHeader className="pb-2 border-b border-sidebar-border shrink-0">
          <CardTitle className="text-base lg:text-lg font-display font-bold text-cyan-400">ADD STEPS</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 min-h-0">
          <Tabs defaultValue="connectors" className="h-full flex flex-col">
            <TabsList className="w-full rounded-none border-b border-sidebar-border bg-transparent p-0 h-auto shrink-0">
              <TabsTrigger value="connectors" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-cyan-500 data-[state=active]:text-cyan-400 py-2.5 font-mono text-xs">
                <Plug className="w-3 h-3 mr-1.5" />PLUGINS
              </TabsTrigger>
              <TabsTrigger value="agents" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-fuchsia-500 data-[state=active]:text-fuchsia-400 py-2.5 font-mono text-xs">
                <Bot className="w-3 h-3 mr-1.5" />AGENTS
              </TabsTrigger>
            </TabsList>
            <TabsContent value="connectors" className="flex-1 overflow-y-auto p-3 mt-0 min-h-0">
              <ConnectorPicker onSelect={handleAddStep} />
            </TabsContent>
            <TabsContent value="agents" className="flex-1 overflow-y-auto p-3 mt-0 min-h-0">
              <AgentsPicker onSelect={handleAddAgentStep} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Canvas Area */}
      <div className="flex-1 min-h-[50vh] lg:min-h-0 lg:h-full flex flex-col">
        <div className="flex-1 relative rounded-t-sm border border-cyan-500/20 overflow-hidden shadow-2xl bg-black/40 min-h-[300px]">
          {/* Toolbar */}
          <div className="absolute top-2 right-2 lg:top-4 lg:right-4 z-10 flex flex-wrap gap-1.5 lg:gap-2">
            <Button onClick={() => setShowRunDialog(true)} disabled={isRunning || nodes.length === 0} className="bg-green-500 text-white hover:bg-green-600 font-bold font-mono shadow-lg text-xs lg:text-sm h-8 lg:h-9 px-2.5 lg:px-4">
              {isRunning ? <Loader2 className="w-3.5 h-3.5 lg:w-4 lg:h-4 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 lg:w-4 lg:h-4 mr-1.5" />}
              <span className="hidden sm:inline">{isRunning ? "RUNNING..." : "RUN"}</span>
              <span className="sm:hidden">{isRunning ? "..." : "RUN"}</span>
            </Button>
            <Button onClick={() => setShowRFADialog(true)} variant="outline" className="border-fuchsia-500/30 hover:border-fuchsia-500 hover:bg-fuchsia-500/10 text-xs lg:text-sm h-8 lg:h-9 px-2.5 lg:px-4">
              <Bot className="w-3.5 h-3.5 lg:w-4 lg:h-4 mr-1.5" /><span className="hidden sm:inline">REQUEST</span>
            </Button>
            <Button onClick={() => setIsFullscreen(true)} variant="outline" className="border-sidebar-border hover:border-cyan-500 h-8 lg:h-9 w-8 lg:w-9">
              <Maximize2 className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
            </Button>
            <Sheet open={showSettingsSheet} onOpenChange={setShowSettingsSheet}>
              <SheetTrigger asChild>
                <Button variant="outline" className="border-sidebar-border h-8 lg:h-9 w-8 lg:w-9">
                  <Settings className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                </Button>
              </SheetTrigger>
              <SheetContent className="bg-card border-sidebar-border z-[60]">
                <SheetHeader>
                  <SheetTitle className="font-display text-cyan-400">Workflow Settings</SheetTitle>
                  <SheetDescription>Configure workflow metadata and input</SheetDescription>
                </SheetHeader>
                <div className="space-y-4 mt-6">
                  <div className="space-y-2">
                    <Label className="font-mono text-xs">WORKFLOW NAME</Label>
                    <Input value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} placeholder="My Workflow" className="bg-background/50 font-mono border-sidebar-border" />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-xs">DESCRIPTION</Label>
                    <Textarea value={workflowDescription} onChange={(e) => setWorkflowDescription(e.target.value)} placeholder="What does this workflow do?" className="bg-background/50 font-mono border-sidebar-border resize-none" rows={3} />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="font-mono text-xs">INPUT (JSON)</Label>
                    <Textarea value={inputJson} onChange={(e) => setInputJson(e.target.value)} placeholder='{"key": "value"}' className="bg-background/50 font-mono border-sidebar-border resize-none text-xs" rows={5} />
                    <p className="text-[10px] text-muted-foreground">Access in steps as {"{{input.key}}"}</p>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          <div className="absolute top-2 left-2 lg:top-4 lg:left-4 z-10">
            <Badge variant="outline" className="font-mono border-cyan-500/30 text-cyan-400 text-[10px] lg:text-xs">
              {nodes.length} step{nodes.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          <ReactFlowProvider>
            <div className="h-full w-full" ref={reactFlowWrapper}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onInit={onInit}
                nodeTypes={nodeTypes}
                onDrop={onDrop}
                onDragOver={onDragOver}
                fitView
                proOptions={{ hideAttribution: true }}
                className="bg-background"
                connectionRadius={50}
                edgesFocusable
                elementsSelectable
                selectNodesOnDrag={false}
                deleteKeyCode={["Backspace", "Delete"]}
                defaultEdgeOptions={{
                  type: "smoothstep",
                  animated: true,
                  style: { stroke: 'hsl(188 95% 43%)', strokeWidth: 2 },
                }}
              >
                <Background color="hsl(188 95% 43%)" gap={20} size={1} className="opacity-10" />
                <Controls className="bg-card border-sidebar-border fill-foreground" />
                <MiniMap className="bg-card border-sidebar-border" maskColor="hsl(222 47% 3% / 0.8)" nodeColor="hsl(188 95% 43%)" />
              </ReactFlow>
            </div>
          </ReactFlowProvider>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-4">
              <div className="text-center space-y-2">
                <div className="relative">
                  <Plug className="w-12 h-12 lg:w-16 lg:h-16 mx-auto text-muted-foreground/20" />
                  <div className="absolute -top-1 -right-1 lg:-top-2 lg:-right-2 animate-pulse">
                    <Sparkles className="w-4 h-4 lg:w-6 lg:h-6 text-cyan-500/40" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-foreground/80 font-display text-base lg:text-lg">Start Building</p>
                  <p className="text-muted-foreground font-mono text-[10px] lg:text-xs max-w-[200px] mx-auto">Select plugins or agents from the panel to add workflow steps</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Action Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-4 px-3 lg:px-4 py-2.5 lg:py-3 bg-card/60 border border-t-0 border-cyan-500/20 rounded-b-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-mono text-muted-foreground min-w-0">
            <span className="text-foreground/80 truncate max-w-[120px] sm:max-w-[150px]">{workflowName || "Untitled Workflow"}</span>
            {workflowDescription && <span className="text-[10px] opacity-60 truncate max-w-[150px] hidden sm:block">{workflowDescription}</span>}
          </div>
          <Button onClick={() => setShowMintDialog(true)} disabled={nodes.length === 0} className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white hover:from-cyan-400 hover:to-fuchsia-400 font-bold font-mono shadow-lg disabled:opacity-50 w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />MINT AS NFT
          </Button>
        </div>
      </div>

      {/* Fullscreen Canvas Overlay */}
      <FullscreenOverlay
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        onAddStep={handleAddStep}
        onAddAgentStep={handleAddAgentStep}
        onAddTrigger={handleAddTrigger}
        onRun={() => setShowRunDialog(true)}
        onRequest={() => setShowRFADialog(true)}
        onMint={() => setShowMintDialog(true)}
        onSettings={() => setShowSettingsSheet(true)}
        isRunning={isRunning}
        nodeCount={nodes.length}
      >
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-background"
            connectionRadius={50}
            edgesFocusable
            elementsSelectable
            selectNodesOnDrag={false}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{
              type: "smoothstep",
              animated: true,
              style: { stroke: 'hsl(188 95% 43%)', strokeWidth: 2 },
            }}
          >
            <Background color="hsl(188 95% 43%)" gap={20} size={1} className="opacity-10" />
            <Controls className="bg-card border-sidebar-border fill-foreground" />
            <MiniMap className="bg-card border-sidebar-border" maskColor="hsl(222 47% 3% / 0.8)" nodeColor="hsl(188 95% 43%)" />
          </ReactFlow>
        </ReactFlowProvider>
      </FullscreenOverlay>

      {/* Dialogs */}
      <MintManowarDialog open={showMintDialog} onOpenChange={setShowMintDialog} workflowName={workflowName} workflowDescription={workflowDescription} agentIds={workflowAgentIds} agentPrices={agentPrices} />
      <RunWorkflowDialog open={showRunDialog} onOpenChange={setShowRunDialog} workflowName={workflowName || "Workflow"} stepCount={nodes.length} isRunning={isRunning} onRun={handleRun} />
      <WorkflowOutputPanel open={showOutputPanel} onOpenChange={setShowOutputPanel} result={workflowResult} workflowName={workflowName || "Workflow"} />

      {/* Warp Required Dialog */}
      <AlertDialog open={showWarpDialog} onOpenChange={setShowWarpDialog}>
        <AlertDialogContent className="bg-background border-sidebar-border max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-fuchsia-400" /> Warp Required
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This agent needs to be warped into the Manowar ecosystem before it can be used in workflows.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingWarpAgent && (
            <div className="space-y-3 py-4 border-y border-sidebar-border">
              <div className="flex items-center gap-3 p-3 rounded-sm bg-sidebar-accent border border-sidebar-border">
                <div className="w-10 h-10 rounded-full bg-fuchsia-500/10 flex items-center justify-center border border-fuchsia-500/30">
                  <Globe className="w-5 h-5 text-fuchsia-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono font-bold text-foreground truncate">{pendingWarpAgent.name}</p>
                  <p className="text-xs text-muted-foreground">{AGENT_REGISTRIES[pendingWarpAgent.registry]?.name || pendingWarpAgent.registry}</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-2">
                <p>Warping brings external agents on-chain with:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>ERC8004 identity</li>
                  <li>x402 payment integration</li>
                  <li>80% royalties to you (the warper)</li>
                </ul>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="border-sidebar-border">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleWarpAgent} className="bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white hover:from-fuchsia-400 hover:to-cyan-400 font-bold">
              <ArrowRightLeft className="w-4 h-4 mr-2" /> Warp This Agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* RFA Component Dialog */}
      <RFAComponent
        open={showRFADialog}
        onOpenChange={setShowRFADialog}
        manowarId={pendingManowarId || 0}
        manowarTitle={workflowName || "New Workflow"}
        onSuccess={() => { toast({ title: "Agent Request Published", description: "Bounty hunters can now submit agents for your request." }); }}
      />
    </div>
  );
}

export default ComposeFlow;
