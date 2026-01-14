/**
 * Connector Picker Component
 * 
 * Unified search across MCP, GOAT, and Eliza plugin registries.
 * Single-click adds plugin to canvas, drag-drop also supported.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plug, Loader2, Info } from "lucide-react";
import {
    useRegistryServers,
    useRegistrySearch,
    type RegistryServer,
} from "@/hooks/use-registry";
import type { ConnectorTool } from "@/lib/services";
import { ConnectorDetailDialog } from "./connector-detail";

interface ConnectorPickerProps {
    onSelect: (connectorId: string, tool: ConnectorTool) => void;
}

export function ConnectorPicker({ onSelect }: ConnectorPickerProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [detailServer, setDetailServer] = useState<RegistryServer | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    // Fetch all servers with search (only plugins, not agents)
    const { data: searchData, isLoading: isSearching } = useRegistrySearch(
        searchQuery,
        30
    );

    // Fetch all servers when no search (only plugins)
    const { data: allData, isLoading: isLoadingAll } = useRegistryServers({
        type: "plugin",
        limit: 50,
    });

    const servers = searchQuery.trim()
        ? searchData?.servers || []
        : allData?.servers || [];
    const isLoading = searchQuery.trim() ? isSearching : isLoadingAll;

    // Open detail dialog
    const handleShowDetails = (server: RegistryServer, e: React.MouseEvent) => {
        e.stopPropagation();
        setDetailServer(server);
        setDetailOpen(true);
    };

    const getOriginBadge = (origin: string) => {
        switch (origin) {
            case "mcp": return <Badge variant="secondary" className="text-[8px] h-4 px-1">MCP</Badge>;
            case "goat": return <Badge variant="outline" className="text-[8px] h-4 px-1 border-green-500/50 text-green-400">GOAT</Badge>;
            case "eliza": return <Badge variant="outline" className="text-[8px] h-4 px-1 border-fuchsia-500/50 text-fuchsia-400">Eliza</Badge>;
            default: return null;
        }
    };

    return (
        <div className="space-y-3">
            {/* Search Input */}
            <div>
                <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
                    SEARCH TOOLS
                </Label>
                <Input
                    placeholder="Search connectors, plugins, MCPs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 text-xs bg-background/50 border-sidebar-border"
                />
            </div>

            {/* Server/Plugin List */}
            <div>
                <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
                    SELECT CONNECTOR
                </Label>
                {isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading...
                    </div>
                ) : servers.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-4 text-center">
                        {searchQuery ? "No matches found" : "No tools available"}
                    </div>
                ) : (
                    <ScrollArea className="h-40">
                        <div className="space-y-1 pr-2">
                            {servers.map((server) => {
                                // Direct add function for single-click
                                const handleDirectAdd = () => {
                                    const defaultTool: ConnectorTool = {
                                        name: "execute",
                                        description: `Execute ${server.name}`,
                                        inputSchema: { type: "object", properties: {} },
                                    };
                                    onSelect(server.registryId, defaultTool);
                                };

                                return (
                                    <div
                                        key={server.registryId}
                                        role="button"
                                        tabIndex={0}
                                        draggable="true"
                                        onClick={handleDirectAdd}
                                        onKeyDown={(e) => e.key === "Enter" && handleDirectAdd()}
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData("application/compose-plugin", JSON.stringify(server));
                                            e.dataTransfer.effectAllowed = "copy";
                                        }}
                                        className="w-full text-left p-2 rounded-sm border transition-all group cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-500/10 border-sidebar-border"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Plug className="w-3 h-3 text-cyan-400" />
                                            <span className="font-mono text-xs truncate flex-1">{server.name}</span>
                                            {/* Info button - stops propagation to prevent adding */}
                                            <button
                                                onClick={(e) => handleShowDetails(server, e)}
                                                className="p-1 hover:bg-cyan-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="View details"
                                            >
                                                <Info className="w-3 h-3 text-muted-foreground hover:text-cyan-400" />
                                            </button>
                                            {getOriginBadge(server.origin)}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground truncate mt-0.5 ml-5">
                                            {server.description}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                )}
            </div>

            {/* Detail Dialog */}
            <ConnectorDetailDialog
                server={detailServer}
                open={detailOpen}
                onOpenChange={setDetailOpen}
                onAdd={onSelect}
            />
        </div>
    );
}
