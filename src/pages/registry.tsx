/**
 * MCP Registry Browser
 * 
 * Browse and search MCP servers from official registry + Compose internal tools.
 * Includes test console for GOAT plugins.
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { usePostHog } from "@posthog/react";
import {
  useRegistryServers,
  useRegistrySearch,
  useRegistryMeta,
  useRegistryCategories,
  type RegistryServer,
  getOriginLabel,
  isRemoteCapable,
  formatToolCount,
} from "@/hooks/use-registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Loader2,
  Server,
  ExternalLink,
  Wrench,
  Plus,
  Database,
  Cloud,
  Sparkles,
  Filter,
  RefreshCw,
  Play,
  Zap,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS_PER_PAGE = 50;

// Note: Executability is now determined by the `executable` field from the backend
// Plugin testing is now consolidated in the Playground page (/playground?tab=plugins)

// =============================================================================
// Pagination Component
// =============================================================================

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const getVisiblePages = () => {
    const pages: (number | "ellipsis")[] = [];

    // Always show first page
    pages.push(1);

    if (currentPage > 3) {
      pages.push("ellipsis");
    }

    // Show pages around current
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      if (!pages.includes(i)) {
        pages.push(i);
      }
    }

    if (currentPage < totalPages - 2) {
      pages.push("ellipsis");
    }

    // Always show last page
    if (totalPages > 1 && !pages.includes(totalPages)) {
      pages.push(totalPages);
    }

    return pages;
  };

  const visiblePages = getVisiblePages();

  return (
    <div className="flex items-center justify-center gap-1 mt-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="border-sidebar-border h-8 w-8 p-0"
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>

      {visiblePages.map((page, i) => (
        page === "ellipsis" ? (
          <span key={`ellipsis-${i}`} className="text-muted-foreground px-2">...</span>
        ) : (
          <Button
            key={page}
            variant={currentPage === page ? "default" : "outline"}
            size="sm"
            onClick={() => onPageChange(page)}
            className={cn(
              "h-8 min-w-8 px-2",
              currentPage === page
                ? "bg-cyan-500 text-black hover:bg-cyan-600"
                : "border-sidebar-border"
            )}
          >
            {page}
          </Button>
        )
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="border-sidebar-border h-8 w-8 p-0"
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// =============================================================================
// Server Card Component
// =============================================================================

function ServerCard({
  server,
  onSelect
}: {
  server: RegistryServer;
  onSelect: (s: RegistryServer) => void;
}) {
  const isGoat = server.origin === "goat";
  const isEliza = server.origin === "eliza";
  const isRemote = isRemoteCapable(server);
  const isExecutable = server.executable === true;

  const getOriginStyle = () => {
    if (isGoat) return { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400" };
    if (isEliza) return { bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/30", text: "text-fuchsia-400" };
    return { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400" };
  };

  const style = getOriginStyle();

  return (
    <Card
      className={`glass-panel border-cyan-500/20 hover:border-cyan-500/50 transition-all cursor-pointer group ${isExecutable ? "ring-1 ring-green-500/20" : ""
        }`}
      onClick={() => onSelect(server)}
    >
      <CardHeader className="p-3 sm:p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-sm flex items-center justify-center border shrink-0 ${style.bg} ${style.border}`}>
              {isGoat ? (
                <Zap className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${style.text}`} />
              ) : isEliza ? (
                <Sparkles className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${style.text}`} />
              ) : (
                <Server className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${style.text}`} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-xs sm:text-sm font-display font-bold truncate group-hover:text-cyan-400 transition-colors">
                {server.name}
              </CardTitle>
              <p className="text-[9px] sm:text-[10px] font-mono text-muted-foreground truncate">
                {server.namespace}/{server.slug}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge
              variant="secondary"
              className={`text-[8px] sm:text-[10px] h-4 sm:h-5 ${style.bg} ${style.text} ${style.border}`}
            >
              {getOriginLabel(server.origin)}
            </Badge>
            {isExecutable && (
              <Badge variant="outline" className="text-[8px] sm:text-[9px] h-3.5 sm:h-4 border-green-500/30 text-green-400 px-1">
                <Play className="w-1.5 h-1.5 sm:w-2 sm:h-2 mr-0.5" />
                Test
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 pt-0">
        <CardDescription className="text-[10px] sm:text-xs line-clamp-2 mb-2 sm:mb-3 h-7 sm:h-8">
          {server.description}
        </CardDescription>

        <div className="flex flex-wrap gap-1 mb-2 sm:mb-3">
          {server.category && (
            <Badge variant="outline" className="text-[8px] sm:text-[10px] h-4 sm:h-5 border-sidebar-border">
              {server.category}
            </Badge>
          )}
          {isRemote && (
            <Badge variant="outline" className="text-[8px] sm:text-[10px] h-4 sm:h-5 border-green-500/30 text-green-400">
              <Cloud className="w-2 h-2 sm:w-2.5 sm:h-2.5 mr-0.5 sm:mr-1" />
              Remote
            </Badge>
          )}
          {server.toolCount > 0 && (
            <Badge variant="outline" className="text-[8px] sm:text-[10px] h-4 sm:h-5 border-sidebar-border">
              <Wrench className="w-2 h-2 sm:w-2.5 sm:h-2.5 mr-0.5 sm:mr-1" />
              {formatToolCount(server.toolCount)}
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-sidebar-border">
          <div className="flex gap-1 min-w-0 flex-1 overflow-hidden">
            {server.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[9px] sm:text-[10px] text-muted-foreground truncate max-w-[60px] sm:max-w-[80px]">
                #{tag}
              </span>
            ))}
          </div>
          {server.repoUrl && (
            <a
              href={server.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-cyan-400 transition-colors"
            >
              <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Server Detail Dialog
// =============================================================================

function ServerDetailDialog({
  server,
  open,
  onOpenChange,
}: {
  server: RegistryServer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const posthog = usePostHog();

  if (!server) return null;

  const isGoat = server.origin === "goat";
  const isExecutable = server.executable === true;

  const handleAddToWorkflow = () => {
    posthog?.capture("registry_server_added_to_workflow", {
      server_id: server.registryId,
      server_name: server.name,
      server_origin: server.origin,
      server_category: server.category,
    });
    // Store server data and navigate to compose
    sessionStorage.setItem("selectedMcpServer", JSON.stringify({
      registryId: server.registryId,
      name: server.name,
      namespace: server.namespace,
      slug: server.slug,
      description: server.description,
      tools: server.tools,
      origin: server.origin,
    }));
    navigate("/compose");
    onOpenChange(false);
  };

  const isEliza = server.origin === "eliza";

  const handleTestPlugin = () => {
    posthog?.capture("registry_server_tested", {
      server_id: server.registryId,
      server_name: server.name,
      server_origin: server.origin,
    });
    // Determine source based on origin
    const source = isGoat ? "goat" : isEliza ? "eliza" : "mcp";

    // For GOAT/Eliza plugins, use the registryId; for MCP servers, use the slug
    const pluginParam = (isGoat || isEliza) ? server.registryId : server.slug;

    // Navigate to playground with source and plugin pre-selected
    navigate(`/playground?tab=plugins&source=${source}&plugin=${encodeURIComponent(pluginParam)}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-cyan-500/30">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center border ${isGoat
              ? "bg-green-500/10 border-green-500/30"
              : "bg-cyan-500/10 border-cyan-500/30"
              }`}>
              {isGoat ? (
                <Zap className="w-5 h-5 text-green-400" />
              ) : (
                <Server className="w-5 h-5 text-cyan-400" />
              )}
            </div>
            <div>
              <DialogTitle className="font-display text-lg">{server.name}</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {server.namespace}/{server.slug}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">{server.description}</p>

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge variant={isGoat ? "default" : "secondary"} className={
              isGoat
                ? "bg-green-500/20 text-green-400"
                : "bg-cyan-500/20 text-cyan-400"
            }>
              {getOriginLabel(server.origin)}
            </Badge>
            {server.category && (
              <Badge variant="outline">{server.category}</Badge>
            )}
            {isRemoteCapable(server) && (
              <Badge variant="outline" className="border-green-500/30 text-green-400">
                <Cloud className="w-3 h-3 mr-1" />
                Remote Capable
              </Badge>
            )}
            {isExecutable && (
              <Badge variant="outline" className="border-cyan-500/30 text-cyan-400">
                <Play className="w-3 h-3 mr-1" />
                Executable
              </Badge>
            )}
            {server.available ? (
              <Badge variant="outline" className="border-green-500/30 text-green-400">
                Available
              </Badge>
            ) : (
              <Badge variant="outline" className="border-red-500/30 text-red-400">
                Unavailable
              </Badge>
            )}
          </div>

          {/* Missing env vars */}
          {server.missingEnv && server.missingEnv.length > 0 && (
            <div className="p-3 rounded-sm bg-red-500/10 border border-red-500/30">
              <p className="text-xs font-mono text-red-400">
                Missing environment variables: {server.missingEnv.join(", ")}
              </p>
            </div>
          )}

          {/* Tools */}
          {server.tools && server.tools.length > 0 && (
            <div>
              <h4 className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wider">
                Available Tools ({server.tools.length})
              </h4>
              <ScrollArea className="h-40">
                <div className="space-y-2 pr-3">
                  {server.tools.map((tool) => (
                    <div
                      key={tool.name}
                      className="p-2 rounded-sm bg-background/50 border border-sidebar-border"
                    >
                      <div className="font-mono text-xs text-cyan-400">{tool.name}</div>
                      {tool.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {tool.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Tags */}
          {server.tags.length > 0 && (
            <div>
              <h4 className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wider">
                Tags
              </h4>
              <div className="flex flex-wrap gap-1">
                {server.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t border-sidebar-border">
            {/* Show test button for GOAT plugins, Eliza plugins (executable) OR MCP servers */}
            {(isExecutable || server.origin === "mcp" || isEliza) && (
              <Button
                onClick={handleTestPlugin}
                className={cn(
                  "flex-1 font-bold",
                  isGoat
                    ? "bg-green-500 hover:bg-green-600 text-black"
                    : isEliza
                      ? "bg-fuchsia-500 hover:bg-fuchsia-600 text-white"
                      : "bg-purple-500 hover:bg-purple-600 text-white"
                )}
              >
                <Play className="w-4 h-4 mr-2" />
                Test in Playground
              </Button>
            )}
            <Button
              onClick={handleAddToWorkflow}
              className={cn(
                "bg-cyan-500 hover:bg-cyan-600 text-black font-bold",
                !(isExecutable || server.origin === "mcp" || isEliza) && "flex-1"
              )}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add to Workflow
            </Button>
            {server.repoUrl && (
              <Button variant="outline" asChild>
                <a href={server.repoUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Repository
                </a>
              </Button>
            )}
            {server.uiUrl && (
              <Button variant="outline" asChild>
                <a href={server.uiUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View
                </a>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Main Registry Page
// =============================================================================

export default function RegistryPage() {
  const posthog = usePostHog();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrigin, setSelectedOrigin] = useState<"all" | "mcp" | "goat" | "eliza">("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedServer, setSelectedServer] = useState<RegistryServer | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Data fetching - no limits, fetch all
  const { data: meta } = useRegistryMeta();
  const { data: categories } = useRegistryCategories();

  const { data: serversData, isLoading: loadingServers, forceRefresh } = useRegistryServers({
    origin: selectedOrigin === "all" ? undefined : selectedOrigin,
    category: selectedCategory === "all" ? undefined : selectedCategory,
  });

  const { data: searchData, isLoading: loadingSearch } = useRegistrySearch(searchQuery);

  // Reset page when filters change
  const handleFilterChange = (setter: (v: any) => void) => (value: any) => {
    setter(value);
    setCurrentPage(1);
  };

  // Determine which servers to show
  const allServers = useMemo(() => {
    if (searchQuery.length > 0 && searchData) {
      return searchData.servers;
    }
    return serversData?.servers || [];
  }, [searchQuery, searchData, serversData]);

  // Paginate servers
  const totalPages = Math.ceil(allServers.length / ITEMS_PER_PAGE);
  const displayServers = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return allServers.slice(start, start + ITEMS_PER_PAGE);
  }, [allServers, currentPage]);

  const isLoading = searchQuery.length > 0 ? loadingSearch : loadingServers;

  const handleSelectServer = (server: RegistryServer) => {
    posthog?.capture("registry_server_viewed", {
      server_id: server.registryId,
      server_name: server.name,
      server_origin: server.origin,
      server_category: server.category,
    });
    setSelectedServer(server);
    setDetailOpen(true);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-cyan-400 neon-text">
              MCP REGISTRY
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse and install MCP servers for your workflows
            </p>
          </div>
          <div className="flex items-center gap-2">
            {meta && (
              <Badge variant="outline" className="font-mono text-xs">
                <Database className="w-3 h-3 mr-1" />
                {meta.totalServers.toLocaleString()} servers
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => forceRefresh()}
              className="border-sidebar-border"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search servers by name, description, or tags..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-10 bg-background/50 border-sidebar-border font-mono"
            />
          </div>

          <div className="flex gap-2">
            <Select value={selectedOrigin} onValueChange={handleFilterChange(setSelectedOrigin)}>
              <SelectTrigger className="w-[140px] bg-background/50 border-sidebar-border">
                <Filter className="w-3 h-3 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Origin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="mcp">MCP Tools</SelectItem>
                <SelectItem value="goat">GOAT SDK</SelectItem>
                <SelectItem value="eliza">ElizaOS</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedCategory} onValueChange={handleFilterChange(setSelectedCategory)}>
              <SelectTrigger className="w-[140px] bg-background/50 border-sidebar-border">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories?.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : allServers.length === 0 ? (
        <div className="text-center py-20">
          <Server className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">
            {searchQuery ? "No servers match your search" : "No servers found"}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? (
                <>Found <span className="text-cyan-400 font-mono">{allServers.length.toLocaleString()}</span> servers matching "{searchQuery}"</>
              ) : (
                <>Showing <span className="text-cyan-400 font-mono">{displayServers.length}</span> of <span className="text-cyan-400 font-mono">{allServers.length.toLocaleString()}</span> servers</>
              )}
              {totalPages > 1 && (
                <span className="ml-2 text-muted-foreground/70">
                  (Page {currentPage} of {totalPages})
                </span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {displayServers.map((server) => (
              <ServerCard
                key={server.registryId}
                server={server}
                onSelect={handleSelectServer}
              />
            ))}
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </>
      )}

      {/* Detail Dialog */}
      <ServerDetailDialog
        server={selectedServer}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
