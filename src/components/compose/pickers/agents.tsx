/**
 * Agents Picker Component
 * 
 * Displays available agents from multiple registries with drag-drop support.
 * Includes both on-chain Manowar agents and external registry agents.
 */

import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Filter, Star, Shield, Sparkles, ExternalLink } from "lucide-react";
import { useAgents } from "@/hooks/use-agents";
import { getIpfsUrl } from "@/lib/pinata";
import {
    type Agent,
    formatInteractions,
    COMMON_TAGS,
} from "@/lib/agents";

interface AgentsPickerProps {
    onSelect: (agent: Agent) => void;
}

export function AgentsPicker({ onSelect }: AgentsPickerProps) {
    const [selectedTag, setSelectedTag] = useState("all");
    const { data, isLoading: isLoadingExternal, error } = useAgents({
        tags: selectedTag !== "all" ? [selectedTag] : undefined,
        registries: ["agentverse"],
        status: "active",
        limit: 20,
        sort: "interactions",
        direction: "desc",
    });
    const { data: native, isLoading: isLoadingNative } = useAgents({
        tags: selectedTag !== "all" ? [selectedTag] : undefined,
        registries: ["manowar"],
        status: "active",
        limit: 20,
        sort: "interactions",
        direction: "desc",
    });

    const manowarAgents = useMemo((): Agent[] => native?.agents || [], [native?.agents]);

    // Merge all agents
    const allAgents = useMemo(() => {
        const external = data?.agents || [];
        return [...manowarAgents, ...external];
    }, [data?.agents, manowarAgents]);

    const isLoading = isLoadingExternal || isLoadingNative;

    const availableTags = useMemo(() => {
        const tagSet = new Set<string>(COMMON_TAGS);
        if (data?.tags) {
            data.tags.forEach(t => tagSet.add(t));
        }
        return Array.from(tagSet).sort();
    }, [data?.tags]);

    return (
        <div className="space-y-3">
            {/* Filter by Tag */}
            <div className="snap-start">
                <Label className="text-xs font-mono text-muted-foreground mb-1.5 block">FILTER BY TAG</Label>
                <Select value={selectedTag} onValueChange={setSelectedTag}>
                    <SelectTrigger className="w-full bg-background/50 border-sidebar-border text-sm">
                        <Filter className="w-3 h-3 mr-2 text-muted-foreground" />
                        <SelectValue placeholder="All tags" />
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

            {/* Agent List */}
            <div>
                <Label className="text-xs font-mono text-muted-foreground mb-1.5 block">
                    SELECT AGENT {manowarAgents.length > 0 && `(${manowarAgents.length} on-chain)`}
                </Label>
                {isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading agents...
                    </div>
                ) : error ? (
                    <div className="text-xs text-red-400 font-mono">
                        Failed to load agents
                    </div>
                ) : allAgents.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No agents found</div>
                ) : (
                    <div className="space-y-1.5">
                        {allAgents.map((agent) => (
                            <AgentPickerCard key={agent.id} agent={agent} onSelect={onSelect} />
                        ))}
                    </div>
                )}
            </div>

            {/* Browse More Link */}
            <div className="pt-2 border-t border-sidebar-border snap-start">
                <Link href="/market">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-fuchsia-400 hover:text-fuchsia-300 p-0 h-auto w-full justify-start"
                    >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Browse all agents →
                    </Button>
                </Link>
            </div>
        </div>
    );
}

interface AgentPickerCardProps {
    agent: Agent;
    onSelect: (agent: Agent) => void;
}

export function AgentPickerCard({ agent, onSelect }: AgentPickerCardProps) {
    const initials = agent.name
        .split(" ")
        .map(w => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    const isManowar = agent.registry === "manowar";

    // Resolve avatar URL - handle both IPFS URIs (ipfs://) and gateway URLs (https://)
    let resolvedAvatarUrl: string | null = null;
    if (agent.avatarUrl) {
        if (agent.avatarUrl.startsWith("ipfs://")) {
            resolvedAvatarUrl = getIpfsUrl(agent.avatarUrl.replace("ipfs://", ""));
        } else if (agent.avatarUrl.startsWith("https://")) {
            resolvedAvatarUrl = agent.avatarUrl;
        }
    }

    return (
        <div
            role="button"
            tabIndex={0}
            draggable="true"
            onClick={() => onSelect(agent)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(agent)}
            onDragStart={(e) => {
                e.dataTransfer.setData("application/compose-agent", JSON.stringify(agent));
                e.dataTransfer.effectAllowed = "copy";
            }}
            className={`w-full p-2 rounded-sm border bg-background/30 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5 transition-all text-left group cursor-grab active:cursor-grabbing snap-start ${isManowar ? "border-cyan-500/30" : "border-sidebar-border"}`}
        >
            <div className="flex items-start gap-2">
                <Avatar className={`w-8 h-8 border group-hover:border-fuchsia-500/50 ${isManowar ? "border-cyan-500/50" : "border-sidebar-border"}`}>
                    <AvatarImage src={resolvedAvatarUrl || undefined} alt={agent.name} />
                    <AvatarFallback className={`font-mono text-xs ${isManowar ? "bg-cyan-500/10 text-cyan-400" : "bg-fuchsia-500/10 text-fuchsia-400"}`}>
                        {initials}
                    </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                        <span className="font-mono text-xs font-medium truncate group-hover:text-fuchsia-400 transition-colors">
                            {agent.name}
                        </span>
                        {isManowar && (
                            <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                        )}
                        {agent.verified && !isManowar && (
                            <Shield className="w-3 h-3 text-green-400 shrink-0" />
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {isManowar ? (
                            <span className="text-cyan-400">on-chain</span>
                        ) : (
                            <>
                                <span className="flex items-center gap-0.5">
                                    <Star className="w-2.5 h-2.5 text-yellow-400" />
                                    {agent.rating.toFixed(1)}
                                </span>
                                <span>{formatInteractions(agent.totalInteractions)} uses</span>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
