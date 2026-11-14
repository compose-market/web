/**
 * Connector Picker Component
 *
 * Unified search across mcps, accounts and onchain Connectors.
 * Single-click adds connector to canvas, drag-drop also supported.
 */

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plug, Loader2, Info } from "lucide-react";
import {
    useRegistryServers,
    useRegistrySearch,
    type RegistryServer,
} from "@/hooks/use-registry";
import type { ConnectorTool } from "@/lib/services";
import { ConnectorDetailDialog } from "./details";

interface ConnectorPickerProps {
    onSelect: (connectorId: string, tool: ConnectorTool) => void;
}

export function ConnectorPicker({ onSelect }: ConnectorPickerProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [detailServer, setDetailServer] = useState<RegistryServer | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const searchReady = searchQuery.trim().length >= 2;
    const { data: searchData, isLoading: isSearching } = useRegistrySearch(searchQuery, 50, {
        origin: "onchain,mcp",
    });

    const { data: allData, isLoading: isLoadingAll } = useRegistryServers({
        type: "connector",
        origin: "onchain,mcp",
    });

    const allServers = allData?.servers || [];
    const servers = useMemo(() => (
        searchReady
            ? searchData?.servers ?? []
            : allServers
    ), [allServers, searchData?.servers, searchReady]);
    const isLoading = searchReady ? isSearching && servers.length === 0 : isLoadingAll;

    // Open detail dialog
    const handleShowDetails = (server: RegistryServer, e: React.MouseEvent) => {
        e.stopPropagation();
        setDetailServer(server);
        setDetailOpen(true);
    };

    const getOriginBadge = (origin: string) => {
        switch (origin) {
            case "mcp": return <Badge variant="secondary" className="text-xs h-4 px-1">Tools</Badge>;
            case "onchain": return <Badge variant="outline" className="text-xs h-4 px-1 border-green-500/50 text-green-400">Onchain</Badge>;
            default: return null;
        }
    };

    return (
        <div className="space-y-3">
            {/* Search Input */}
            <div className="snap-start">
                <Label className="text-xs font-mono text-muted-foreground mb-1.5 block">
                    SEARCH TOOLS
                </Label>
                <Input
                    placeholder="Search connectors and tools..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 text-xs bg-background/50 border-sidebar-border"
                />
            </div>

            {/* Server/Connector List */}
            <div>
                <Label className="text-xs font-mono text-muted-foreground mb-1.5 block">
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
                    <div className="space-y-1.5">
                        {servers.map((server) => {
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
                                        e.dataTransfer.setData("application/compose-connector", JSON.stringify(server));
                                        e.dataTransfer.effectAllowed = "copy";
                                    }}
                                    className="w-full text-left p-2 rounded-sm border transition-all group cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-500/10 border-sidebar-border snap-start"
                                >
                                    <div className="flex items-center gap-2">
                                        <Plug className="w-3 h-3 text-cyan-400 shrink-0" />
                                        <span className="font-mono text-xs truncate flex-1">{server.name}</span>
                                        <button
                                            type="button"
                                            aria-label={`View ${server.name} details`}
                                            onClick={(e) => handleShowDetails(server, e)}
                                            className="p-1 hover:bg-cyan-500/20 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                                            title="View details"
                                        >
                                            <Info className="w-3 h-3 text-muted-foreground hover:text-cyan-400" />
                                        </button>
                                        {getOriginBadge(server.origin)}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate mt-0.5 ml-5">
                                        {server.description}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
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
