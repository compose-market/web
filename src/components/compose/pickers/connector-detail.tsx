/**
 * Connector Detail Dialog Component
 * 
 * Shows detailed info about a connector/plugin with test execution capability.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Plug, Loader2, Github, Zap, Server, FlaskConical, Wrench, Copy
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { RegistryServer } from "@/hooks/use-registry";
import type { ConnectorTool } from "@/lib/services";
import { executeRegistryTool } from "@/lib/services";

interface ConnectorDetailDialogProps {
    server: RegistryServer | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAdd: (connectorId: string, tool: ConnectorTool) => void;
}

export function ConnectorDetailDialog({
    server,
    open,
    onOpenChange,
    onAdd,
}: ConnectorDetailDialogProps) {
    const { toast } = useToast();
    const [selectedTool, setSelectedTool] = useState<string>("");
    const [testArgs, setTestArgs] = useState("{}");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; content?: unknown; error?: string } | null>(null);
    const [dynamicTools, setDynamicTools] = useState<Array<{ name: string; description?: string }>>([]);
    const [loadingTools, setLoadingTools] = useState(false);

    // Fetch tools dynamically for MCP servers that don't have pre-cached tools
    useEffect(() => {
        if (!server || !open) return;

        // Reset state when server changes
        setSelectedTool("");
        setTestResult(null);
        setDynamicTools([]);

        // Only fetch dynamically for MCP servers without pre-cached tools
        if (server.origin === "mcp" && (!server.tools || server.tools.length === 0)) {
            setLoadingTools(true);
            import("@/lib/services").then(({ fetchMcpServerTools }) => {
                fetchMcpServerTools(server.slug)
                    .then((tools) => {
                        setDynamicTools(tools);
                        if (tools.length > 0) {
                            setSelectedTool(tools[0].name);
                        }
                    })
                    .catch((err) => {
                        toast({
                            title: "Failed to load tools",
                            description: err.message,
                            variant: "destructive",
                        });
                    })
                    .finally(() => setLoadingTools(false));
            });
        }
    }, [server, open, toast]);

    if (!server) return null;

    // Use dynamic tools if available, otherwise use pre-cached tools
    const tools = dynamicTools.length > 0 ? dynamicTools : (server.tools || []);
    const hasTools = tools.length > 0;

    const getOriginStyle = () => {
        switch (server.origin) {
            case "goat": return { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400" };
            case "eliza": return { bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/30", text: "text-fuchsia-400" };
            default: return { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400" };
        }
    };

    const style = getOriginStyle();

    const handleTest = async () => {
        if (!selectedTool && !hasTools) return;

        let args: Record<string, unknown>;
        try {
            args = JSON.parse(testArgs);
        } catch {
            toast({
                title: "Invalid JSON",
                description: "Please enter valid JSON for arguments",
                variant: "destructive",
            });
            return;
        }

        setTesting(true);
        setTestResult(null);

        try {
            const toolName = selectedTool || tools[0]?.name || "execute";
            const result = await executeRegistryTool(
                server.registryId,
                server.origin,
                server.slug,
                toolName,
                args,
                undefined
            );

            setTestResult({
                success: result.success,
                content: result.result || result.content,
                error: result.error,
            });

            toast({
                title: result.success ? "Test Successful" : "Test Failed",
                description: result.success
                    ? "The tool executed successfully"
                    : result.error || "Unknown error",
                variant: result.success ? "default" : "destructive",
            });
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            setTestResult({ success: false, error: errorMsg });
            toast({
                title: "Test Error",
                description: errorMsg,
                variant: "destructive",
            });
        } finally {
            setTesting(false);
        }
    };

    const handleAdd = () => {
        const toolName = selectedTool || (hasTools ? tools[0].name : "execute");
        const tool: ConnectorTool = {
            name: toolName,
            description: tools.find(t => t.name === toolName)?.description || `Execute ${server.name}`,
            inputSchema: { type: "object", properties: {} },
        };
        onAdd(server.registryId, tool);
        onOpenChange(false);
    };

    const copyResult = () => {
        if (testResult) {
            navigator.clipboard.writeText(JSON.stringify(testResult, null, 2));
            toast({ title: "Copied to clipboard" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-card border-cyan-500/30">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-sm flex items-center justify-center border ${style.bg} ${style.border}`}>
                            {server.origin === "goat" ? (
                                <Zap className={`w-5 h-5 ${style.text}`} />
                            ) : server.origin === "eliza" ? (
                                <Plug className={`w-5 h-5 ${style.text}`} />
                            ) : (
                                <Server className={`w-5 h-5 ${style.text}`} />
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
                    {/* Description */}
                    <p className="text-sm text-muted-foreground">{server.description}</p>

                    {/* Badges */}
                    <div className="flex flex-wrap gap-2">
                        <Badge className={`${style.bg} ${style.text}`}>
                            {server.origin === "goat" ? "GOAT SDK" :
                                server.origin === "eliza" ? "ElizaOS" : "MCP"}
                        </Badge>
                        {server.category && (
                            <Badge variant="outline">{server.category}</Badge>
                        )}
                        {server.executable && (
                            <Badge variant="outline" className="border-green-500/30 text-green-400">
                                <FlaskConical className="w-3 h-3 mr-1" />
                                Testable
                            </Badge>
                        )}
                        {server.toolCount > 0 && (
                            <Badge variant="outline" className="border-sidebar-border">
                                <Wrench className="w-3 h-3 mr-1" />
                                {server.toolCount} tools
                            </Badge>
                        )}
                    </div>

                    {/* Tags */}
                    {server.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {server.tags.slice(0, 8).map((tag) => (
                                <span key={tag} className="text-[10px] text-muted-foreground">
                                    #{tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Tools List */}
                    {hasTools && (
                        <div>
                            <Label className="text-xs font-mono text-muted-foreground mb-2 block">
                                AVAILABLE TOOLS ({tools.length})
                            </Label>
                            <ScrollArea className="h-32">
                                <div className="space-y-1 pr-2">
                                    {tools.map((tool) => (
                                        <button
                                            key={tool.name}
                                            onClick={() => setSelectedTool(tool.name)}
                                            className={`w-full text-left p-2 rounded-sm border transition-all ${selectedTool === tool.name
                                                ? "border-cyan-500/50 bg-cyan-500/10"
                                                : "border-sidebar-border hover:border-cyan-500/30"
                                                }`}
                                        >
                                            <div className="font-mono text-xs text-cyan-400">{tool.name}</div>
                                            {tool.description && (
                                                <p className="text-[10px] text-muted-foreground mt-0.5">{tool.description}</p>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                    )}

                    {/* Test Section */}
                    {server.executable && (
                        <div className="space-y-2 p-3 rounded-sm bg-background/50 border border-sidebar-border">
                            <Label className="text-xs font-mono text-muted-foreground">
                                TEST ARGUMENTS (JSON)
                            </Label>
                            <Textarea
                                value={testArgs}
                                onChange={(e) => setTestArgs(e.target.value)}
                                placeholder='{"key": "value"}'
                                className="font-mono text-xs h-16 bg-background/50 border-sidebar-border"
                            />

                            {/* Test Result */}
                            {testResult && (
                                <div className={`p-2 rounded-sm border ${testResult.success
                                    ? "bg-green-500/10 border-green-500/30"
                                    : "bg-red-500/10 border-red-500/30"
                                    }`}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-xs font-bold ${testResult.success ? "text-green-400" : "text-red-400"}`}>
                                            {testResult.success ? "Success" : "Failed"}
                                        </span>
                                        <Button variant="ghost" size="sm" onClick={copyResult} className="h-5 px-1">
                                            <Copy className="w-3 h-3" />
                                        </Button>
                                    </div>
                                    <pre className="text-[10px] font-mono overflow-auto max-h-20">
                                        {JSON.stringify(testResult.content || testResult.error, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <DialogFooter className="gap-2 pt-4 border-t border-sidebar-border">
                    {server.repoUrl && (
                        <Button variant="outline" asChild>
                            <a href={server.repoUrl} target="_blank" rel="noopener noreferrer">
                                <Github className="w-4 h-4 mr-2" />
                                Repository
                            </a>
                        </Button>
                    )}
                    {server.executable && (
                        <Button
                            variant="outline"
                            onClick={handleTest}
                            disabled={testing}
                            className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                        >
                            {testing ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <FlaskConical className="w-4 h-4 mr-2" />
                            )}
                            Test
                        </Button>
                    )}
                    <Button
                        onClick={handleAdd}
                        className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold"
                    >
                        <Plug className="w-4 h-4 mr-2" />
                        Add to Workflow
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
