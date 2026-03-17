import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { usePostHog } from "@posthog/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Search,
  Bot,
  Layers,
  Sparkles,
  Check,
  CheckCircle2,
  ExternalLink,
  Zap,
  Filter,
  Star,
  Activity,
  Shield,
  Globe,
  ArrowRightLeft,
  Eye,
} from "lucide-react";
import { useAgents } from "@/hooks/use-agents";
import { useOnchainAgents, type OnchainAgent } from "@/hooks/use-onchain";
import { useIsExternalWarped } from "@/hooks/use-warp";
import { getIpfsUrl } from "@/lib/pinata";
import {
  type Agent,
  type AgentRegistryId,
  AGENT_REGISTRIES,
  getEnabledRegistries,
  formatInteractions,
  getReadmeExcerpt,
  COMMON_TAGS
} from "@/lib/agents";

export default function AgentsPage() {
  const [, setLocation] = useLocation();
  const posthog = usePostHog();
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [selectedRegistries, setSelectedRegistries] = useState<AgentRegistryId[]>(getEnabledRegistries());
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search
  useMemo(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch external registry agents
  const { data, isLoading: isLoadingExternal, error } = useAgents({
    search: debouncedSearch || undefined,
    tags: selectedTag !== "all" ? [selectedTag] : undefined,
    registries: selectedRegistries.filter(r => r !== "manowar"),
    status: "active",
    limit: 60,
    sort: "interactions",
    direction: "desc",
  });

  // Fetch on-chain Manowar agents
  const { data: onchainAgents, isLoading: isLoadingOnchain } = useOnchainAgents();

  // Convert on-chain agents to unified Agent format
  const manowarAgents = useMemo((): ExtendedAgent[] => {
    if (!onchainAgents || !selectedRegistries.includes("manowar")) return [];

    return onchainAgents
      .filter(a => {
        // Filter by search
        if (debouncedSearch) {
          const searchLower = debouncedSearch.toLowerCase();
          const name = a.metadata?.name || `Agent #${a.id}`;
          const desc = a.metadata?.description || "";
          if (!name.toLowerCase().includes(searchLower) &&
            !desc.toLowerCase().includes(searchLower)) {
            return false;
          }
        }
        return true;
      })
      .map((a): ExtendedAgent => {
        const avatarUri = a.metadata?.image;
        let avatarUrl: string | null = null;
        if (avatarUri && avatarUri !== "none" && avatarUri.startsWith("ipfs://")) {
          avatarUrl = getIpfsUrl(avatarUri.replace("ipfs://", ""));
        }

        return {
          id: `manowar-${a.id}`,
          address: a.creator,
          name: a.metadata?.name || `Agent #${a.id}`,
          description: a.metadata?.description || "",
          registry: "manowar" as AgentRegistryId,
          protocols: a.metadata?.protocols || [{ name: "Manowar", version: "1.0" }],
          avatarUrl,
          totalInteractions: 0, // On-chain agents don't track this yet
          recentInteractions: 0,
          rating: 5.0, // Default rating for new agents
          status: "active" as const,
          type: a.metadata?.endpoint ? "hosted" as const : "local" as const,
          featured: false,
          verified: true, // On-chain = verified
          category: "ai-agent",
          tags: a.metadata?.skills || [],
          owner: a.creator,
          createdAt: a.metadata?.createdAt || new Date().toISOString(),
          updatedAt: a.metadata?.createdAt || new Date().toISOString(),
          // Manowar-specific fields
          price: a.licensePriceFormatted,
          units: a.licenses === 0 ? "∞" : `${a.licensesAvailable}/${a.licenses}`,
          cloneable: a.cloneable,
          isClone: a.isClone,
          isWarped: a.isWarped,
          walletAddress: a.walletAddress, // Derived wallet address
        };
      });
  }, [onchainAgents, selectedRegistries, debouncedSearch]);

  // Merge agents from all sources
  const allAgents = useMemo(() => {
    const external = data?.agents || [];
    return [...manowarAgents, ...external];
  }, [data?.agents, manowarAgents]);

  const isLoading = isLoadingExternal || isLoadingOnchain;

  const handleSelectAgent = (agent: Agent) => {
    posthog?.capture("agent_selected", {
      agent_id: agent.id,
      agent_name: agent.name,
      agent_registry: agent.registry,
      agent_category: agent.category,
    });
    // Store selected agent in sessionStorage and navigate back to compose
    sessionStorage.setItem("selectedAgent", JSON.stringify({
      id: agent.id,
      address: agent.address,
      name: agent.name,
      description: agent.description,
      protocols: agent.protocols,
      avatarUrl: agent.avatarUrl,
      category: agent.category,
      tags: agent.tags,
      registry: agent.registry,
    }));
    setLocation("/compose");
  };

  const toggleRegistry = (registryId: AgentRegistryId) => {
    setSelectedRegistries(prev =>
      prev.includes(registryId)
        ? prev.filter(r => r !== registryId)
        : [...prev, registryId]
    );
  };

  // Combine API tags with common tags for filter dropdown
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>(COMMON_TAGS);
    if (data?.tags) {
      data.tags.forEach(t => tagSet.add(t));
    }
    return Array.from(tagSet).sort();
  }, [data?.tags]);

  return (
    <div className="max-w-6xl mx-auto pb-20 px-1">
      {/* Header */}
      <div className="mb-6 sm:mb-8 space-y-3 sm:space-y-4 border-b border-sidebar-border pb-4 sm:pb-6">
        <Link href="/compose">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-fuchsia-400 -ml-2 mb-2 text-xs sm:text-sm">
            <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
            Back to Compose
          </Button>
        </Link>

        <div className="flex items-center gap-4">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-white">
            <span className="text-fuchsia-500 mr-2">//</span>
            AGENT DISCOVERY
          </h1>
          <div className="hidden md:flex h-px w-32 bg-gradient-to-r from-fuchsia-500 to-transparent"></div>
        </div>
        <p className="text-muted-foreground font-mono text-xs sm:text-sm">
          Browse autonomous agents from multiple registries and ecosystems.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:gap-4 mb-6 sm:mb-8">
        {/* Registry Filters */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-4">
          <Label className="text-[10px] sm:text-xs font-mono text-muted-foreground uppercase shrink-0">Registries:</Label>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {(Object.keys(AGENT_REGISTRIES) as AgentRegistryId[]).map((registryId) => {
              const registry = AGENT_REGISTRIES[registryId];
              const isEnabled = registry.enabled;
              const isSelected = selectedRegistries.includes(registryId);

              return (
                <div key={registryId} className="flex items-center gap-1.5 sm:gap-2">
                  <Checkbox
                    id={`registry-${registryId}`}
                    checked={isSelected}
                    onCheckedChange={() => isEnabled && toggleRegistry(registryId)}
                    disabled={!isEnabled}
                    className="border-sidebar-border data-[state=checked]:bg-fuchsia-500 data-[state=checked]:border-fuchsia-500 w-4 h-4"
                  />
                  <Label
                    htmlFor={`registry-${registryId}`}
                    className={`text-xs sm:text-sm font-mono cursor-pointer ${!isEnabled
                      ? "text-muted-foreground/50 cursor-not-allowed"
                      : isSelected
                        ? "text-fuchsia-400"
                        : "text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    {registry.name}
                    {!isEnabled && <span className="ml-1 text-[8px] sm:text-[10px]">(soon)</span>}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>

        {/* Search and Tag Filter */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-background/50 border-sidebar-border focus:border-fuchsia-500 font-mono text-sm h-9"
            />
          </div>

          <div className="flex gap-2 sm:gap-4">
            <Select value={selectedTag} onValueChange={setSelectedTag}>
              <SelectTrigger className="w-full sm:w-[180px] lg:w-[220px] bg-background/50 border-sidebar-border h-9 text-sm">
                <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 text-muted-foreground" />
                <SelectValue placeholder="Filter by tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tags</SelectItem>
                {availableTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      {!isLoading && (
        <div className="flex flex-wrap items-center gap-3 sm:gap-6 mb-4 sm:mb-6 text-xs sm:text-sm font-mono text-muted-foreground">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-fuchsia-400" />
            <span>{allAgents.length} agents</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
            <span>{selectedRegistries.length} {selectedRegistries.length === 1 ? "registry" : "registries"}</span>
          </div>
          {manowarAgents.length > 0 && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
              <span>{manowarAgents.length} on-chain</span>
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 sm:p-6 rounded-sm border border-red-500/30 bg-red-500/10 text-red-400">
          <p className="font-mono text-xs sm:text-sm">Failed to load agents. Please try again.</p>
          <p className="font-mono text-[10px] sm:text-xs mt-2 opacity-70">{error instanceof Error ? error.message : "Unknown error"}</p>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i} className="bg-background border-sidebar-border">
              <CardContent className="p-4 sm:p-5 space-y-3 sm:space-y-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2 min-w-0">
                    <Skeleton className="h-4 sm:h-5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <Skeleton className="h-10 sm:h-12 w-full" />
                <div className="flex gap-2">
                  <Skeleton className="h-4 sm:h-5 w-14 sm:w-16" />
                  <Skeleton className="h-4 sm:h-5 w-16 sm:w-20" />
                </div>
                <Skeleton className="h-8 sm:h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Agents Grid */}
      {!isLoading && allAgents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {allAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onSelect={handleSelectAgent} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {allAgents.length === 0 && !isLoading && (
        <div className="text-center py-12 sm:py-16 space-y-3 sm:space-y-4">
          <Bot className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground/50" />
          <p className="text-muted-foreground font-mono text-sm">No agents found matching your criteria.</p>
          <Button
            variant="outline"
            onClick={() => {
              setSearch("");
              setSelectedTag("all");
              setSelectedRegistries(getEnabledRegistries());
            }}
            className="border-sidebar-border text-sm"
          >
            Reset Filters
          </Button>
        </div>
      )}
    </div>
  );
}

// Extended Agent type with Manowar fields
interface ExtendedAgent extends Agent {
  price?: string;
  units?: string;
  cloneable?: boolean;
  isClone?: boolean;
  isWarped?: boolean; // True if this manowar agent was created via warp
  walletAddress?: string; // Derived wallet address for manowar agents
}

function AgentCard({ agent, onSelect }: { agent: ExtendedAgent; onSelect: (a: Agent) => void }) {
  const [, setLocation] = useLocation();
  const posthog = usePostHog();
  const excerpt = agent.description || (agent.readme ? getReadmeExcerpt(agent.readme, 100) : "");
  const initials = agent.name
    .split(" ")
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const registryInfo = AGENT_REGISTRIES[agent.registry];
  const isManowar = agent.registry === "manowar";

  // Extract numeric ID for manowar agents (e.g., "manowar-5" -> 5)
  const manowarId = isManowar ? parseInt(agent.id.replace("manowar-", "")) : null;

  // Check if external agent has been warped
  const externalRegistry = !isManowar ? agent.registry : null;
  const externalAddress = !isManowar ? agent.address : null;
  const { data: externalWarpData } = useIsExternalWarped(externalRegistry, externalAddress);

  // Determine if agent is warped (either manowar isWarped or external has been warped)
  const isAgentWarped = isManowar ? agent.isWarped : externalWarpData?.isWarped;

  const handleWarp = () => {
    posthog?.capture("agent_warp_initiated", {
      agent_id: agent.id,
      agent_name: agent.name,
      agent_registry: agent.registry,
    });
    // Store agent for warp flow
    sessionStorage.setItem("warpAgent", JSON.stringify(agent));
    setLocation("/create-agent?warp=true");
  };

  const handleViewEndpoint = () => {
    // Use wallet address for navigation (consistent with backend)
    if (agent.walletAddress) {
      setLocation(`/agent/${agent.walletAddress}`);
    } else if (manowarId) {
      // Fallback for legacy agents without walletAddress
      setLocation(`/agent/${manowarId}`);
    }
  };

  return (
    <Card className={`group bg-background border-sidebar-border hover:border-fuchsia-500/50 transition-all duration-300 corner-decoration overflow-hidden ${isManowar ? "ring-1 ring-cyan-500/20" : ""}`}>
      <CardContent className="p-4 sm:p-5 space-y-3 sm:space-y-4">
        {/* Header with Avatar */}
        <div className="flex items-start gap-2.5 sm:gap-3">
          <Avatar className={`w-10 h-10 sm:w-12 sm:h-12 border-2 ${isManowar ? "border-cyan-500/50" : "border-sidebar-border"} group-hover:border-fuchsia-500/50 transition-colors shrink-0`}>
            <AvatarImage src={agent.avatarUrl || undefined} alt={agent.name} />
            <AvatarFallback className={`${isManowar ? "bg-cyan-500/10 text-cyan-400" : "bg-fuchsia-500/10 text-fuchsia-400"} font-mono text-xs sm:text-sm`}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display font-bold text-foreground truncate group-hover:text-fuchsia-400 transition-colors text-sm sm:text-base">
                {agent.name}
              </h3>
              {agent.externalUrl && (
                <a
                  href={agent.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-muted-foreground hover:text-fuchsia-400 transition-colors shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                </a>
              )}
            </div>
            <p className="text-[10px] sm:text-xs font-mono text-muted-foreground truncate">
              {registryInfo?.name || agent.registry}
            </p>
          </div>
        </div>

        {/* Description */}
        {excerpt && (
          <p className="text-[10px] sm:text-xs text-muted-foreground line-clamp-2 min-h-[2rem] sm:min-h-[2.5rem]">
            {excerpt}
          </p>
        )}

        {/* Badges */}
        <div className="flex flex-wrap gap-1 sm:gap-1.5">
          {isManowar && (
            <Badge variant="outline" className="text-[10px] font-mono border-cyan-500/30 text-cyan-400 bg-cyan-500/10 px-1.5 py-0">
              <Sparkles className="w-2.5 h-2.5 mr-1" />
              on-chain
            </Badge>
          )}
          {isAgentWarped && (
            <Badge variant="outline" className="text-[10px] font-mono border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10 px-1.5 py-0">
              <ArrowRightLeft className="w-2.5 h-2.5 mr-1" />
              warped
            </Badge>
          )}
          {agent.verified && (
            <Badge variant="outline" className="text-[10px] font-mono border-green-500/30 text-green-400 bg-green-500/10 px-1.5 py-0">
              <Shield className="w-2.5 h-2.5 mr-1" />
              verified
            </Badge>
          )}
          {agent.featured && (
            <Badge variant="outline" className="text-[10px] font-mono border-yellow-500/30 text-yellow-400 bg-yellow-500/10 px-1.5 py-0">
              <Star className="w-2.5 h-2.5 mr-1" />
              featured
            </Badge>
          )}
          {agent.cloneable && (
            <Badge variant="outline" className="text-[10px] font-mono border-purple-500/30 text-purple-400 bg-purple-500/10 px-1.5 py-0">
              cloneable
            </Badge>
          )}
          {agent.isClone && (
            <Badge variant="outline" className="text-[10px] font-mono border-orange-500/30 text-orange-400 bg-orange-500/10 px-1.5 py-0">
              clone
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] font-mono border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10 px-1.5 py-0">
            {agent.category}
          </Badge>
          {agent.type === "hosted" && (
            <Badge variant="outline" className="text-[10px] font-mono border-cyan-500/30 text-cyan-400 bg-cyan-500/10 px-1.5 py-0">
              hosted
            </Badge>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 text-[10px] sm:text-xs font-mono">
          {isManowar && agent.price ? (
            <>
              <div className="flex items-center gap-1.5 sm:gap-2 text-muted-foreground">
                <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-400 shrink-0" />
                <span className="truncate">{agent.price}</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 text-muted-foreground">
                <Layers className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">{agent.units} units</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 sm:gap-2 text-muted-foreground">
                <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-400 shrink-0" />
                <span>{formatInteractions(agent.totalInteractions)} uses</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 text-muted-foreground">
                <Star className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-yellow-400 shrink-0" />
                <span>{agent.rating.toFixed(1)} rating</span>
              </div>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-1.5 sm:gap-2">
          <Button
            onClick={() => onSelect(agent)}
            className={`flex-1 bg-sidebar-accent border border-sidebar-border text-foreground hover:border-fuchsia-500 hover:text-fuchsia-400 font-mono text-[10px] sm:text-xs transition-colors group-hover:bg-fuchsia-500/10 h-8 sm:h-9 ${isManowar ? "hover:border-cyan-500 hover:text-cyan-400 group-hover:bg-cyan-500/10" : ""}`}
          >
            <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 sm:mr-1.5" />
            SELECT
          </Button>

          {/* WARP button for non-manowar agents that haven't been warped yet */}
          {!isManowar && !externalWarpData?.isWarped && (
            <Button
              onClick={handleWarp}
              variant="outline"
              className="border-fuchsia-500/50 text-fuchsia-400 hover:bg-fuchsia-500/20 font-mono text-[10px] sm:text-xs h-8 sm:h-9"
            >
              <ArrowRightLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
              WARP
            </Button>
          )}

          {/* Show WARPED indicator for already warped external agents */}
          {!isManowar && externalWarpData?.isWarped && (
            <Button
              variant="outline"
              disabled
              className="border-green-500/50 text-green-400 font-mono text-[10px] sm:text-xs cursor-default h-8 sm:h-9"
            >
              <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
              WARPED
            </Button>
          )}

          {/* VIEW ENDPOINT button for manowar agents */}
          {isManowar && (
            <Button
              onClick={handleViewEndpoint}
              variant="outline"
              className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/20 font-mono text-[10px] sm:text-xs h-8 sm:h-9"
            >
              <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
              VIEW
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

