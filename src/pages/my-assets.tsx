import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  Layers,
  Sparkles,
  ExternalLink,
  Zap,
  DollarSign,
  Copy,
  Plus,
  Activity,
  Users,
  Clock,
  Shield,
  ArrowRightLeft,
  Award,
  Target,
  XCircle,
  CheckCircle,
  FileSearch,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { prepareContractCall } from "thirdweb";
import { useAgentsByCreator, useManowarsByCreator, useRFAsByPublisher, type OnchainAgent, type OnchainManowar, type OnchainRFA } from "@/hooks/use-onchain";
import { getIpfsUrl } from "@/lib/pinata";
import { CHAIN_CONFIG, CHAIN_IDS } from "@/lib/chains";
import { useChain } from "@/contexts/ChainContext";
import { getContractAddress, getRFAContract, RFA_BOUNTY_LIMITS } from "@/lib/contracts";
import { RFADetails } from "@/components/RFADetails";

export default function MyAssetsPage() {
  const { toast } = useToast();
  const account = useActiveAccount();
  const { paymentChainId } = useChain();
  const [activeTab, setActiveTab] = useState("agents");

  const { data: agents, isLoading: isLoadingAgents } = useAgentsByCreator(account?.address);
  const { data: manowars, isLoading: isLoadingManowars } = useManowarsByCreator(account?.address);
  const { data: rfas, isLoading: isLoadingRFAs, refetch: refetchRFAs } = useRFAsByPublisher(account?.address);

  // RFA detail dialog state
  const [selectedRfaId, setSelectedRfaId] = useState<number | null>(null);
  const [showRFADetails, setShowRFADetails] = useState(false);

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast({ title: "Address copied!" });
  };

  if (!account) {
    return (
      <div className="max-w-4xl mx-auto pb-20 px-1">
        <div className="mb-6 sm:mb-8 space-y-3 sm:space-y-4 border-b border-sidebar-border pb-4 sm:pb-6">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-white">
            <span className="text-cyan-500 mr-2">//</span>
            MY ASSETS
          </h1>
          <p className="text-muted-foreground font-mono text-xs sm:text-sm">
            View and manage your on-chain agents and workflows.
          </p>
        </div>

        <Card className="bg-background border-sidebar-border">
          <CardContent className="p-8 sm:p-12 text-center space-y-3 sm:space-y-4">
            <Shield className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground/50" />
            <h2 className="text-lg sm:text-xl font-display text-foreground">Sign In Required</h2>
            <p className="text-muted-foreground font-mono text-xs sm:text-sm max-w-md mx-auto">
              Connect with email, social, or wallet to view your on-chain assets.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading = isLoadingAgents || isLoadingManowars || isLoadingRFAs;
  const agentCount = agents?.length || 0;
  const manowarCount = manowars?.length || 0;
  const rfaCount = rfas?.length || 0;
  const openRfaCount = rfas?.filter(r => r.status === 'Open').length || 0;

  return (
    <div className="max-w-6xl mx-auto pb-20 px-1">
      {/* Header */}
      <div className="mb-6 sm:mb-8 space-y-3 sm:space-y-4 border-b border-sidebar-border pb-4 sm:pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-white">
              <span className="text-cyan-500 mr-2">//</span>
              MY ASSETS
            </h1>
            <p className="text-muted-foreground font-mono text-xs sm:text-sm mt-1">
              Manage your on-chain agents and Manowar workflows.
            </p>
          </div>
          <Link href="/create-agent" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto bg-cyan-500 text-black hover:bg-cyan-400 font-bold font-mono text-sm h-9 sm:h-10">
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
              CREATE AGENT
            </Button>
          </Link>
        </div>

        {/* Account Info */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-sm bg-sidebar-accent border border-sidebar-border">
          <div className="flex items-center gap-2.5 sm:gap-3 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs sm:text-sm text-foreground truncate">
                {account.address.slice(0, 6)}...{account.address.slice(-4)}
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">{CHAIN_CONFIG[paymentChainId]?.name || 'testnet'}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyAddress(account.address)}
              className="text-muted-foreground hover:text-cyan-400 h-8 w-8"
            >
              <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </Button>
          </div>
          <div className="flex items-center justify-center sm:justify-end gap-4 sm:gap-6 text-xs sm:text-sm font-mono pt-2 sm:pt-0 border-t sm:border-t-0 border-sidebar-border sm:ml-auto">
            <div className="text-center">
              <p className="text-cyan-400 font-bold">{agentCount}</p>
              <p className="text-muted-foreground text-[10px] sm:text-xs">Agents</p>
            </div>
            <div className="text-center">
              <p className="text-fuchsia-400 font-bold">{manowarCount}</p>
              <p className="text-muted-foreground text-[10px] sm:text-xs">Workflows</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
        <TabsList className="bg-sidebar-accent border border-sidebar-border p-1 w-full sm:w-auto">
          <TabsTrigger
            value="agents"
            className="flex-1 sm:flex-none font-mono data-[state=active]:bg-cyan-500 data-[state=active]:text-black text-xs sm:text-sm px-3 sm:px-4"
          >
            <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
            AGENTS ({agentCount})
          </TabsTrigger>
          <TabsTrigger
            value="workflows"
            className="flex-1 sm:flex-none font-mono data-[state=active]:bg-fuchsia-500 data-[state=active]:text-black text-xs sm:text-sm px-3 sm:px-4"
          >
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
            WORKFLOWS ({manowarCount})
          </TabsTrigger>
          <TabsTrigger
            value="rfas"
            className="flex-1 sm:flex-none font-mono data-[state=active]:bg-amber-500 data-[state=active]:text-black text-xs sm:text-sm px-3 sm:px-4"
          >
            <Award className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
            RFAs ({openRfaCount})
          </TabsTrigger>
        </TabsList>

        {/* Agents Tab */}
        <TabsContent value="agents" className="space-y-4">
          {isLoadingAgents && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="bg-background border-sidebar-border">
                  <CardContent className="p-4 sm:p-5 space-y-3 sm:space-y-4">
                    <div className="flex items-start gap-2.5 sm:gap-3">
                      <Skeleton className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0" />
                      <div className="flex-1 space-y-2 min-w-0">
                        <Skeleton className="h-4 sm:h-5 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                    <Skeleton className="h-14 sm:h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!isLoadingAgents && agents && agents.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {agents.map((agent) => (
                <AgentAssetCard key={agent.id} agent={agent} chainId={paymentChainId} />
              ))}
            </div>
          )}

          {!isLoadingAgents && (!agents || agents.length === 0) && (
            <Card className="bg-background border-sidebar-border">
              <CardContent className="p-8 sm:p-12 text-center space-y-3 sm:space-y-4">
                <Bot className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground/50" />
                <h3 className="text-base sm:text-lg font-display text-foreground">No Agents Yet</h3>
                <p className="text-muted-foreground font-mono text-xs sm:text-sm max-w-md mx-auto">
                  Create your first ERC8004 agent to start earning from AI workflows.
                </p>
                <Link href="/create-agent">
                  <Button className="bg-cyan-500 text-black hover:bg-cyan-400 font-bold font-mono text-sm">
                    <Plus className="w-4 h-4 mr-2" />
                    CREATE AGENT
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Workflows Tab */}
        <TabsContent value="workflows" className="space-y-4">
          {isLoadingManowars && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <Card key={i} className="bg-background border-sidebar-border">
                  <CardContent className="p-4 sm:p-5 space-y-3 sm:space-y-4">
                    <Skeleton className="h-24 sm:h-32 w-full rounded-sm" />
                    <Skeleton className="h-4 sm:h-5 w-3/4" />
                    <Skeleton className="h-14 sm:h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!isLoadingManowars && manowars && manowars.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {manowars.map((manowar) => (
                <ManowarAssetCard key={manowar.id} manowar={manowar} chainId={paymentChainId} />
              ))}
            </div>
          )}

          {!isLoadingManowars && (!manowars || manowars.length === 0) && (
            <Card className="bg-background border-sidebar-border">
              <CardContent className="p-8 sm:p-12 text-center space-y-3 sm:space-y-4">
                <Layers className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground/50" />
                <h3 className="text-base sm:text-lg font-display text-foreground">No Workflows Yet</h3>
                <p className="text-muted-foreground font-mono text-xs sm:text-sm max-w-md mx-auto">
                  Compose your first Manowar workflow by combining multiple agents.
                </p>
                <Link href="/compose">
                  <Button className="bg-fuchsia-500 text-white hover:bg-fuchsia-400 font-bold font-mono text-sm">
                    <Layers className="w-4 h-4 mr-2" />
                    START COMPOSING
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* RFAs Tab */}
        <TabsContent value="rfas" className="space-y-4">
          {isLoadingRFAs && (
            <div className="grid grid-cols-1 gap-3 sm:gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="bg-background border-sidebar-border">
                  <CardContent className="p-4 sm:p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                      <Skeleton className="h-8 w-24" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!isLoadingRFAs && rfas && rfas.length > 0 && (
            <div className="space-y-3">
              {rfas.map((rfa) => (
                <RFAAssetCard
                  key={rfa.id}
                  rfa={rfa}
                  onViewDetails={() => {
                    setSelectedRfaId(rfa.id);
                    setShowRFADetails(true);
                  }}
                  onRefresh={refetchRFAs}
                />
              ))}
            </div>
          )}

          {!isLoadingRFAs && (!rfas || rfas.length === 0) && (
            <Card className="bg-background border-sidebar-border">
              <CardContent className="p-8 sm:p-12 text-center space-y-3 sm:space-y-4">
                <FileSearch className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground/50" />
                <h3 className="text-base sm:text-lg font-display text-foreground">No RFAs Published</h3>
                <p className="text-muted-foreground font-mono text-xs sm:text-sm max-w-md mx-auto">
                  You haven't published any Request-For-Agent bounties yet. Create one from the Compose page.
                </p>
                <Link href="/compose">
                  <Button className="bg-amber-500 text-black hover:bg-amber-400 font-bold font-mono text-sm">
                    <Award className="w-4 h-4 mr-2" />
                    GO TO COMPOSE
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* RFA Details Dialog */}
          <RFADetails
            rfaId={selectedRfaId}
            open={showRFADetails}
            onOpenChange={setShowRFADetails}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AgentAssetCard({ agent, chainId }: { agent: OnchainAgent; chainId: number }) {
  const metadata = agent.metadata;
  const name = metadata?.name || `Agent #${agent.id}`;
  const description = metadata?.description || "No description available";

  let avatarUrl: string | null = null;
  if (metadata?.image && metadata.image !== "none") {
    // Convert IPFS URI to gateway URL if needed
    if (metadata.image.startsWith("ipfs://")) {
      avatarUrl = getIpfsUrl(metadata.image.replace("ipfs://", ""));
    } else if (metadata.image.startsWith("https://")) {
      avatarUrl = metadata.image;
    }
  }

  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  // Use chainId from agent metadata (source of truth for where it was minted)
  const agentChainId = agent.metadata?.chain;
  const explorerUrl = agentChainId && CHAIN_CONFIG[agentChainId]
    ? `${CHAIN_CONFIG[agentChainId].explorer}/token/${getContractAddress("AgentFactory", agentChainId)}?a=${agent.id}`
    : null;

  // Agent page URL using wallet address (primary) or ID (fallback)
  const agentPageUrl = agent.walletAddress
    ? `/agent/${agent.walletAddress}`
    : `/agent/${agent.id}`;

  return (
    <Link href={agentPageUrl} className="block">
      <Card
        className="bg-background border-sidebar-border hover:border-cyan-500/50 transition-colors cursor-pointer group"
      >
        <CardContent className="p-4 sm:p-5 space-y-3 sm:space-y-4">
          <div className="flex items-start gap-2.5 sm:gap-3">
            <Avatar className="w-10 h-10 sm:w-12 sm:h-12 border-2 border-cyan-500/30 group-hover:border-cyan-500/60 transition-colors shrink-0">
              <AvatarImage src={avatarUrl || undefined} alt={name} />
              <AvatarFallback className="bg-cyan-500/10 text-cyan-400 font-mono text-xs sm:text-sm">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display font-bold text-foreground truncate group-hover:text-cyan-400 transition-colors text-sm sm:text-base">
                  {name}
                </h3>
                {explorerUrl && (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-muted-foreground hover:text-cyan-400 transition-colors shrink-0"
                    title="View on explorer"
                  >
                    <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </a>
                )}
              </div>
              <p className="text-[10px] sm:text-xs font-mono text-muted-foreground">
                Agent #{agent.id} • ERC8004
              </p>
            </div>
          </div>

          <p className="text-[10px] sm:text-xs text-muted-foreground line-clamp-2">
            {description}
          </p>

          <div className="flex flex-wrap gap-1 sm:gap-1.5">
            <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-cyan-500/30 text-cyan-400 bg-cyan-500/10 px-1 sm:px-1.5 py-0">
              <Sparkles className="w-2 h-2 sm:w-2.5 sm:h-2.5 mr-0.5 sm:mr-1" />
              on-chain
            </Badge>
            {agent.isWarped && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10 px-1 sm:px-1.5 py-0">
                <ArrowRightLeft className="w-2 h-2 sm:w-2.5 sm:h-2.5 mr-0.5 sm:mr-1" />
                warped
              </Badge>
            )}
            {agent.cloneable && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-purple-500/30 text-purple-400 bg-purple-500/10 px-1 sm:px-1.5 py-0">
                cloneable
              </Badge>
            )}
            {agent.isClone && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-orange-500/30 text-orange-400 bg-orange-500/10 px-1 sm:px-1.5 py-0">
                clone #{agent.parentAgentId}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:gap-3 text-[10px] sm:text-xs font-mono">
            <div className="text-center p-1.5 sm:p-2 rounded-sm bg-sidebar-accent">
              <DollarSign className="w-3 h-3 sm:w-3.5 sm:h-3.5 mx-auto mb-0.5 sm:mb-1 text-green-400" />
              <p className="text-foreground font-bold truncate">{agent.licensePriceFormatted}</p>
              <p className="text-muted-foreground text-[8px] sm:text-[10px]">license cost</p>
            </div>
            <div className="text-center p-1.5 sm:p-2 rounded-sm bg-sidebar-accent">
              <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5 mx-auto mb-0.5 sm:mb-1 text-cyan-400" />
              <p className="text-foreground font-bold">{agent.licensesMinted}</p>
              <p className="text-muted-foreground text-[8px] sm:text-[10px]">minted</p>
            </div>
            <div className="text-center p-1.5 sm:p-2 rounded-sm bg-sidebar-accent">
              <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 mx-auto mb-0.5 sm:mb-1 text-fuchsia-400" />
              <p className="text-foreground font-bold">
                {agent.licenses === 0 ? "∞" : agent.licensesAvailable}
              </p>
              <p className="text-muted-foreground text-[8px] sm:text-[10px]">available</p>
            </div>
          </div>

          {/* Global API Endpoint */}
          {agent.walletAddress && (
            <div className="pt-2 border-t border-sidebar-border">
              <p className="text-[9px] sm:text-[10px] text-muted-foreground mb-1">API Endpoint</p>
              <code className="text-[9px] sm:text-[10px] font-mono text-cyan-400 break-all block bg-sidebar-accent/50 p-1 sm:p-1.5 rounded">
                api.compose.market/agent/{agent.walletAddress.slice(0, 8)}...
              </code>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function ManowarAssetCard({ manowar, chainId }: { manowar: OnchainManowar; chainId: number }) {
  let bannerUrl: string | null = null;
  if (manowar.image && manowar.image.startsWith("ipfs://")) {
    bannerUrl = getIpfsUrl(manowar.image.replace("ipfs://", ""));
  }

  // Use chainId from manowar's first agent metadata (source of truth)
  const manowarChainId = manowar.metadata?.agents?.[0]?.chain;
  const explorerUrl = manowarChainId && CHAIN_CONFIG[manowarChainId]
    ? `${CHAIN_CONFIG[manowarChainId].explorer}/token/${getContractAddress("Manowar", manowarChainId)}?a=${manowar.id}`
    : null;

  // Use wallet address for navigation (primary), fallback to numeric ID
  const manowarPageUrl = manowar.walletAddress
    ? `/manowar/${manowar.walletAddress}`
    : `/manowar/${manowar.id}`;

  return (
    <Link href={manowarPageUrl} className="block">
      <Card
        className="bg-background border-sidebar-border hover:border-fuchsia-500/50 transition-colors overflow-hidden cursor-pointer group"
      >
        {bannerUrl ? (
          <div className="h-24 sm:h-32 bg-cover bg-center" style={{ backgroundImage: `url(${bannerUrl})` }} />
        ) : (
          <div className="h-24 sm:h-32 bg-gradient-to-br from-fuchsia-500/20 to-cyan-500/20 flex items-center justify-center">
            <Layers className="w-10 h-10 sm:w-12 sm:h-12 text-fuchsia-400/50" />
          </div>
        )}

        <CardContent className="p-4 sm:p-5 space-y-3 sm:space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-display font-bold text-foreground text-sm sm:text-base truncate group-hover:text-fuchsia-400 transition-colors">
                {manowar.title || `Workflow #${manowar.id}`}
              </h3>
              <p className="text-[10px] sm:text-xs font-mono text-muted-foreground">
                Manowar #{manowar.id} • ERC7401
              </p>
            </div>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-muted-foreground hover:text-fuchsia-400 transition-colors shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </a>
            )}
          </div>

          {manowar.description && (
            <p className="text-[10px] sm:text-xs text-muted-foreground line-clamp-2">
              {manowar.description}
            </p>
          )}

          <div className="flex flex-wrap gap-1 sm:gap-1.5">
            <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10 px-1 sm:px-1.5 py-0">
              <Sparkles className="w-2 h-2 sm:w-2.5 sm:h-2.5 mr-0.5 sm:mr-1" />
              nestable NFT
            </Badge>
            {manowar.leaseEnabled && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-green-500/30 text-green-400 bg-green-500/10 px-1 sm:px-1.5 py-0">
                <Clock className="w-2 h-2 sm:w-2.5 sm:h-2.5 mr-0.5 sm:mr-1" />
                leasable ({manowar.leasePercent}%)
              </Badge>
            )}
            {manowar.hasActiveRfa && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-yellow-500/30 text-yellow-400 bg-yellow-500/10 px-1 sm:px-1.5 py-0">
                active RFA
              </Badge>
            )}
            {manowar.coordinatorModel && (
              <Badge variant="outline" className="text-[8px] sm:text-[10px] font-mono border-purple-500/30 text-purple-400 bg-purple-500/10 px-1 sm:px-1.5 py-0">
                + coordinator
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:gap-3 text-[10px] sm:text-xs font-mono">
            <div className="text-center p-1.5 sm:p-2 rounded-sm bg-sidebar-accent">
              <DollarSign className="w-3 h-3 sm:w-3.5 sm:h-3.5 mx-auto mb-0.5 sm:mb-1 text-green-400" />
              <p className="text-foreground font-bold truncate">${manowar.totalPrice}</p>
              <p className="text-muted-foreground text-[8px] sm:text-[10px]">total cost</p>
            </div>
            <div className="text-center p-1.5 sm:p-2 rounded-sm bg-sidebar-accent">
              <Layers className="w-3 h-3 sm:w-3.5 sm:h-3.5 mx-auto mb-0.5 sm:mb-1 text-cyan-400" />
              <p className="text-foreground font-bold">{manowar.agentIds?.length || 0}</p>
              <p className="text-muted-foreground text-[8px] sm:text-[10px]">agents</p>
            </div>
            <div className="text-center p-1.5 sm:p-2 rounded-sm bg-sidebar-accent">
              <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 mx-auto mb-0.5 sm:mb-1 text-fuchsia-400" />
              <p className="text-foreground font-bold">
                {manowar.units === 0 ? "∞" : manowar.units - manowar.unitsMinted}
              </p>
              <p className="text-muted-foreground text-[8px] sm:text-[10px]">avail</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// RFA Asset Card Component
function RFAAssetCard({
  rfa,
  onViewDetails,
  onRefresh,
}: {
  rfa: OnchainRFA;
  onViewDetails: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const { mutateAsync: sendTransaction, isPending } = useSendTransaction();
  const [isCancelling, setIsCancelling] = useState(false);

  // Calculate bounty breakdown
  const offerNum = parseFloat(rfa.offerAmount);
  const basicBounty = RFA_BOUNTY_LIMITS.BASIC_BOUNTY;
  const readmeBonus = Math.max(0, offerNum - basicBounty);

  // Format dates
  const createdDate = new Date(rfa.createdAt * 1000);

  // Handle cancel
  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      setIsCancelling(true);

      const contract = getRFAContract();
      const tx = prepareContractCall({
        contract,
        method: "function cancelRFA(uint256 rfaId)",
        params: [BigInt(rfa.id)],
      });

      await sendTransaction(tx);

      toast({
        title: "RFA Cancelled",
        description: `Bounty of ${rfa.offerAmountFormatted} has been refunded to your wallet.`,
      });

      onRefresh();
    } catch (error) {
      console.error("Cancel error:", error);
      toast({
        title: "Failed to Cancel",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const statusColor = {
    Open: "border-green-500/30 text-green-400 bg-green-500/10",
    Fulfilled: "border-cyan-500/30 text-cyan-400 bg-cyan-500/10",
    Cancelled: "border-red-500/30 text-red-400 bg-red-500/10",
    None: "border-gray-500/30 text-gray-400 bg-gray-500/10",
  }[rfa.status];

  return (
    <Card
      className="bg-background border-sidebar-border hover:border-amber-500/50 transition-colors cursor-pointer"
      onClick={onViewDetails}
    >
      <CardContent className="p-4 sm:p-5 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px]">
                <Target className="w-2 h-2 mr-1" />
                RFA #{rfa.id}
              </Badge>
              <Badge variant="outline" className={`text-[9px] ${statusColor}`}>
                {rfa.status === 'Open' && <Clock className="w-2 h-2 mr-1" />}
                {rfa.status === 'Fulfilled' && <CheckCircle className="w-2 h-2 mr-1" />}
                {rfa.status === 'Cancelled' && <XCircle className="w-2 h-2 mr-1" />}
                {rfa.status}
              </Badge>
            </div>
            <h3 className="font-display font-bold text-foreground truncate text-sm sm:text-base">
              {rfa.title}
            </h3>
            <p className="text-[10px] sm:text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {rfa.description}
            </p>
          </div>

          {/* Bounty Amount */}
          <div className="text-right shrink-0">
            <p className="text-[9px] text-muted-foreground uppercase">Bounty</p>
            <p className="font-mono font-bold text-amber-400 text-lg">
              {rfa.offerAmountFormatted}
            </p>
          </div>
        </div>

        {/* Meta Row */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>For: Manowar #{rfa.manowarId}</span>
          <span>{createdDate.toLocaleDateString()}</span>
        </div>

        {/* Actions */}
        {rfa.status === 'Open' && (
          <div className="flex items-center gap-2 pt-2 border-t border-sidebar-border">
            <Button
              variant="outline"
              size="sm"
              onClick={onViewDetails}
              className="flex-1 text-xs h-8"
            >
              <Bot className="w-3 h-3 mr-1" />
              View Submissions
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={isCancelling || isPending}
              className="text-xs h-8 border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              {isCancelling ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <>
                  <XCircle className="w-3 h-3 mr-1" />
                  Cancel
                </>
              )}
            </Button>
          </div>
        )}

        {rfa.status === 'Fulfilled' && (
          <div className="flex items-center gap-2 p-2 rounded-sm bg-cyan-500/5 border border-cyan-500/20 text-[10px]">
            <CheckCircle className="w-3 h-3 text-cyan-400" />
            <span className="text-cyan-400">Fulfilled by Agent #{rfa.fulfilledByAgentId}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
