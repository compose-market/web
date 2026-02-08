/**
 * Backpack Component
 * 
 * User's personal permission and account management popup.
 * Two tabs:
 * - Permissions: Toggle browser permissions (filesystem, camera, mic, etc.)
 * - Connected Accounts: Connect/disconnect external accounts via Composio
 * 
 * OAuth is handled entirely by Composio as a credential broker —
 * the app never sees or stores user credentials. Composio manages
 * the full OAuth handshake, token storage, and refresh lifecycle.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
    Backpack,
    FolderOpen,
    Camera,
    Mic,
    MapPin,
    Clipboard,
    Bell,
    Link2,
    Shield,
    Check,
    Loader2,
    ExternalLink,
    RefreshCw,
    Unplug,
    Search,
    X,
    MessageCircle,
    Send,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");

// =============================================================================
// Types
// =============================================================================

interface Permission {
    type: string;
    label: string;
    description: string;
    icon: React.ReactNode;
    granted: boolean;
}

/** Provider display info — slugs match Composio toolkit slugs */
interface ProviderDisplay {
    slug: string;        // Composio toolkit slug (e.g., "gmail", "github")
    name: string;        // Human-readable name
    logo: string;        // Brand logo URL
    color: string;       // Brand color (for subtle tinting)
    description: string; // Short description of what connects
    connectionType?: "oauth" | "channel" | "disabled"; // how to connect
    badge?: string;      // optional badge label (e.g., "Business Only")
}

interface ConnectionStatus {
    slug: string;
    name: string;
    connected: boolean;
    accountId?: string;
}

interface ToolkitResult {
    slug: string;
    name: string;
    logo: string;
    description: string;
    categories: string[];
    authSchemes: string[];
}

// =============================================================================
// Permission Definitions
// =============================================================================

const PERMISSION_TYPES: Omit<Permission, "granted">[] = [
    {
        type: "filesystem",
        label: "File System",
        description: "Access files and folders on your device",
        icon: <FolderOpen className="w-4 h-4" />,
    },
    {
        type: "camera",
        label: "Camera",
        description: "Use your camera for photos and video",
        icon: <Camera className="w-4 h-4" />,
    },
    {
        type: "microphone",
        label: "Microphone",
        description: "Record audio with your microphone",
        icon: <Mic className="w-4 h-4" />,
    },
    {
        type: "geolocation",
        label: "Location",
        description: "Access your current location",
        icon: <MapPin className="w-4 h-4" />,
    },
    {
        type: "clipboard",
        label: "Clipboard",
        description: "Read and write to your clipboard",
        icon: <Clipboard className="w-4 h-4" />,
    },
    {
        type: "notifications",
        label: "Notifications",
        description: "Send you desktop notifications",
        icon: <Bell className="w-4 h-4" />,
    },
];

// =============================================================================
// Featured Provider Definitions (Composio toolkit slugs)
// =============================================================================

const FEATURED_PROVIDERS: ProviderDisplay[] = [
    {
        slug: "gmail",
        name: "Google (Gmail)",
        logo: "https://logos.composio.dev/api/gmail",
        color: "#4285F4",
        description: "Email, Calendar, Drive access",
    },
    {
        slug: "notion",
        name: "Notion",
        logo: "https://logos.composio.dev/api/notion",
        color: "#000000",
        description: "Pages, databases, content",
    },
    {
        slug: "twitter",
        name: "X (Twitter)",
        logo: "https://logos.composio.dev/api/twitter",
        color: "#000000",
        description: "Tweets, DMs, analytics",
    },
    {
        slug: "github",
        name: "GitHub",
        logo: "https://logos.composio.dev/api/github",
        color: "#24292F",
        description: "Repos, issues, pull requests",
    },
    {
        slug: "discord",
        name: "Discord",
        logo: "https://logos.composio.dev/api/discord",
        color: "#5865F2",
        description: "Servers, channels, messaging",
    },
    {
        slug: "slack",
        name: "Slack",
        logo: "https://logos.composio.dev/api/slack",
        color: "#4A154B",
        description: "Channels, messages, files",
    },
    {
        slug: "linkedin",
        name: "LinkedIn",
        logo: "https://logos.composio.dev/api/linkedin",
        color: "#0A66C2",
        description: "Profile, connections, posts",
    },
    {
        slug: "spotify",
        name: "Spotify",
        logo: "https://logos.composio.dev/api/spotify",
        color: "#1DB954",
        description: "Playlists, tracks, playback",
    },
    {
        slug: "telegram",
        name: "Telegram",
        logo: "https://logos.composio.dev/api/telegram",
        color: "#229ED9",
        description: "Bot messaging & notifications",
        connectionType: "channel",
    },
    {
        slug: "whatsapp",
        name: "WhatsApp",
        logo: "https://logos.composio.dev/api/whatsapp",
        color: "#25D366",
        description: "Business messaging",
        connectionType: "disabled",
        badge: "Coming Soon",
    },
];

// =============================================================================
// Component
// =============================================================================

interface BackpackDialogProps {
    userId?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    showTrigger?: boolean;
}

export function BackpackDialog({
    userId,
    open,
    onOpenChange,
    showTrigger = true
}: BackpackDialogProps) {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("permissions");
    const [loadingPermission, setLoadingPermission] = useState<string | null>(null);
    const [loadingAccount, setLoadingAccount] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    // Search state
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<ToolkitResult[]>([]);
    const [searching, setSearching] = useState(false);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Permission states (from sessionStorage)
    const [permissions, setPermissions] = useState<Record<string, boolean>>(() => {
        const stored: Record<string, boolean> = {};
        PERMISSION_TYPES.forEach(p => {
            stored[p.type] = sessionStorage.getItem(`consent_${p.type}`) === "granted";
        });
        return stored;
    });

    // Connection states fetched from Composio via backend
    const [connections, setConnections] = useState<Record<string, ConnectionStatus>>({});

    const handleOpen = open !== undefined ? open : isOpen;
    const handleOpenChange = onOpenChange || setIsOpen;

    // Effective userId — fallback to anonymous session id
    const effectiveUserId = userId || sessionStorage.getItem("composio_anon_id") || (() => {
        const id = `anon_${crypto.randomUUID()}`;
        sessionStorage.setItem("composio_anon_id", id);
        return id;
    })();

    // ==========================================================================
    // Fetch Connection Status from Backend
    // ==========================================================================

    const fetchConnections = useCallback(async () => {
        try {
            setRefreshing(true);
            const res = await fetch(
                `${API_BASE}/api/backpack/connections?userId=${encodeURIComponent(effectiveUserId)}`
            );

            if (!res.ok) {
                console.warn("[Backpack] Failed to fetch connections:", res.status);
                return;
            }

            const data = await res.json();
            const connMap: Record<string, ConnectionStatus> = {};

            // Map Composio connections to our featured providers
            if (data.connections) {
                for (const conn of data.connections) {
                    connMap[conn.slug] = conn;
                }
            }

            setConnections(connMap);
        } catch (err) {
            console.warn("[Backpack] Could not fetch connections:", err);
        } finally {
            setRefreshing(false);
        }
    }, [effectiveUserId]);

    // Fetch connections when the accounts tab is opened
    useEffect(() => {
        if (handleOpen && activeTab === "accounts") {
            fetchConnections();
        }
    }, [handleOpen, activeTab, fetchConnections]);

    // ==========================================================================
    // Toolkit Search
    // ==========================================================================

    const searchToolkits = useCallback(async (query: string) => {
        if (!query.trim()) {
            setSearchResults([]);
            return;
        }

        setSearching(true);
        try {
            const res = await fetch(
                `${API_BASE}/api/backpack/toolkits?search=${encodeURIComponent(query)}&limit=15`
            );
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data.toolkits || []);
            }
        } catch (err) {
            console.warn("[Backpack] Search error:", err);
        } finally {
            setSearching(false);
        }
    }, []);

    // Debounced search
    useEffect(() => {
        if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
        }
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }
        searchDebounceRef.current = setTimeout(() => {
            searchToolkits(searchQuery);
        }, 300);
        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchQuery, searchToolkits]);

    // Convert a search result to a ProviderDisplay for the connect flow
    const toolkitToProvider = useCallback((tk: ToolkitResult): ProviderDisplay => ({
        slug: tk.slug,
        name: tk.name,
        logo: tk.logo,
        color: "#6366f1",
        description: tk.description?.substring(0, 60) || tk.categories.join(", ") || "Connect account",
    }), []);

    // ==========================================================================
    // Permission Handlers
    // ==========================================================================

    const requestPermission = useCallback(async (type: string) => {
        setLoadingPermission(type);

        try {
            let granted = false;

            switch (type) {
                case "filesystem":
                    if ("showDirectoryPicker" in window) {
                        await (window as any).showDirectoryPicker();
                        granted = true;
                    } else {
                        throw new Error("File System Access API not supported");
                    }
                    break;

                case "camera":
                    await navigator.mediaDevices.getUserMedia({ video: true });
                    granted = true;
                    break;

                case "microphone":
                    await navigator.mediaDevices.getUserMedia({ audio: true });
                    granted = true;
                    break;

                case "geolocation":
                    await new Promise<void>((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(() => resolve(), reject);
                    });
                    granted = true;
                    break;

                case "clipboard":
                    await navigator.clipboard.readText();
                    granted = true;
                    break;

                case "notifications":
                    const result = await Notification.requestPermission();
                    granted = result === "granted";
                    break;
            }

            if (granted) {
                sessionStorage.setItem(`consent_${type}`, "granted");
                setPermissions(prev => ({ ...prev, [type]: true }));
                toast({ title: "Permission Granted", description: `${type} access enabled.` });
            }
        } catch (err) {
            toast({
                title: "Permission Denied",
                description: `Could not get ${type} access.`,
                variant: "destructive"
            });
        } finally {
            setLoadingPermission(null);
        }
    }, [toast]);

    const revokePermission = useCallback((type: string) => {
        sessionStorage.removeItem(`consent_${type}`);
        setPermissions(prev => ({ ...prev, [type]: false }));
        toast({ title: "Permission Revoked", description: `${type} access disabled.` });
    }, [toast]);

    // ==========================================================================
    // OAuth Handlers — Composio Credential Broker
    // ==========================================================================

    const connectAccount = useCallback(async (provider: ProviderDisplay) => {
        setLoadingAccount(provider.slug);

        try {
            // Step 1: Call backend to get OAuth redirect URL from Composio
            const res = await fetch(`${API_BASE}/api/backpack/connect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: effectiveUserId,
                    toolkit: provider.slug,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to initiate connection (${res.status})`);
            }

            const { redirectUrl } = await res.json();

            if (!redirectUrl) {
                throw new Error("No redirect URL returned from server");
            }

            // Step 2: Open Composio's hosted auth page in a popup
            window.open(
                redirectUrl,
                `Connect ${provider.name}`,
                "width=600,height=700,scrollbars=yes"
            );

            // Step 3: Poll the BACKEND for connection status instead of
            // checking popup.closed (which triggers COOP errors on cross-origin popups)
            toast({
                title: "Authentication Started",
                description: `Complete authentication in the popup, then click Refresh.`,
            });

            // Auto-poll status every 3 seconds for up to 2 minutes
            let attempts = 0;
            const maxAttempts = 40; // 40 × 3s = 2min
            const pollInterval = setInterval(async () => {
                attempts++;
                try {
                    const statusRes = await fetch(
                        `${API_BASE}/api/backpack/status/${encodeURIComponent(provider.slug)}?userId=${encodeURIComponent(effectiveUserId)}`
                    );
                    if (statusRes.ok) {
                        const statusData = await statusRes.json();
                        if (statusData.connected) {
                            clearInterval(pollInterval);
                            setConnections(prev => ({
                                ...prev,
                                [provider.slug]: {
                                    slug: provider.slug,
                                    name: provider.name,
                                    connected: true,
                                    accountId: statusData.accountId,
                                },
                            }));
                            toast({
                                title: "Connected!",
                                description: `${provider.name} account connected successfully.`,
                            });
                            setLoadingAccount(null);
                        }
                    }
                } catch {
                    // Ignore poll errors
                }
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    setLoadingAccount(null);
                }
            }, 3000);

        } catch (err) {
            console.error("[Backpack] Connection error:", err);
            toast({
                title: "Connection Failed",
                description: err instanceof Error ? err.message : "Could not connect account.",
                variant: "destructive"
            });
            setLoadingAccount(null);
        }
    }, [effectiveUserId, toast]);

    // ==========================================================================
    // Channel-Based Connection (Telegram)
    // ==========================================================================

    const connectTelegram = useCallback(async () => {
        setLoadingAccount("telegram");

        try {
            // Generate a deep link
            const res = await fetch(`${API_BASE}/api/backpack/telegram/link`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: effectiveUserId }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to generate link (${res.status})`);
            }

            const { deepLinkUrl } = await res.json();

            // Open Telegram deep link
            window.open(deepLinkUrl, "_blank");

            toast({
                title: "Open Telegram",
                description: 'Tap "Start" in Telegram to connect your account.',
            });

            // Poll for binding confirmation
            let attempts = 0;
            const maxAttempts = 40; // 40 × 3s = 2min
            const pollInterval = setInterval(async () => {
                attempts++;
                try {
                    const statusRes = await fetch(
                        `${API_BASE}/api/backpack/telegram/status?userId=${encodeURIComponent(effectiveUserId)}`
                    );
                    if (statusRes.ok) {
                        const statusData = await statusRes.json();
                        if (statusData.bound) {
                            clearInterval(pollInterval);
                            setConnections(prev => ({
                                ...prev,
                                telegram: {
                                    slug: "telegram",
                                    name: "Telegram",
                                    connected: true,
                                },
                            }));
                            toast({
                                title: "Connected!",
                                description: "Telegram bot connected successfully.",
                            });
                            setLoadingAccount(null);
                        }
                    }
                } catch {
                    // Ignore poll errors
                }
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    setLoadingAccount(null);
                }
            }, 3000);
        } catch (err) {
            console.error("[Backpack] Telegram connection error:", err);
            toast({
                title: "Connection Failed",
                description: err instanceof Error ? err.message : "Could not connect Telegram.",
                variant: "destructive",
            });
            setLoadingAccount(null);
        }
    }, [effectiveUserId, toast]);

    const disconnectAccount = useCallback(async (provider: ProviderDisplay) => {
        setLoadingAccount(provider.slug);

        try {
            const res = await fetch(`${API_BASE}/api/backpack/disconnect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: effectiveUserId,
                    toolkit: provider.slug,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to disconnect (${res.status})`);
            }

            // Update local state
            setConnections(prev => ({
                ...prev,
                [provider.slug]: { ...prev[provider.slug], connected: false, accountId: undefined },
            }));

            toast({
                title: "Disconnected",
                description: `${provider.name} account disconnected.`,
            });
        } catch (err) {
            console.error("[Backpack] Disconnect error:", err);
            toast({
                title: "Disconnect Failed",
                description: err instanceof Error ? err.message : "Could not disconnect account.",
                variant: "destructive"
            });
        } finally {
            setLoadingAccount(null);
        }
    }, [effectiveUserId, toast]);

    // ==========================================================================
    // Filtered search results (exclude featured providers from search)
    // ==========================================================================

    const featuredSlugs = useMemo(() => new Set(FEATURED_PROVIDERS.map(p => p.slug)), []);
    const filteredSearchResults = useMemo(
        () => searchResults.filter(tk => !featuredSlugs.has(tk.slug)),
        [searchResults, featuredSlugs]
    );

    // ==========================================================================
    // Render
    // ==========================================================================

    const grantedPermissionsCount = Object.values(permissions).filter(Boolean).length;
    const connectedAccountsCount = Object.values(connections).filter(c => c.connected).length;

    // Provider card renderer — shared between featured and search results
    const renderProviderCard = (provider: ProviderDisplay) => {
        const connection = connections[provider.slug];
        const isConnected = connection?.connected ?? false;
        const isLoading = loadingAccount === provider.slug;
        const isDisabled = provider.connectionType === "disabled";
        const isChannel = provider.connectionType === "channel";

        return (
            <div
                key={provider.slug}
                className={`flex items-center justify-between p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 ${isDisabled ? "opacity-60" : ""
                    }`}
            >
                <div className="flex items-center gap-3">
                    <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden"
                        style={{ backgroundColor: `${provider.color}15` }}
                    >
                        <img
                            src={provider.logo}
                            alt={provider.name}
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-zinc-200 truncate flex items-center gap-1.5">
                            {provider.name}
                            {provider.badge && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 border-zinc-600 text-zinc-400 font-normal">
                                    {provider.badge}
                                </Badge>
                            )}
                        </div>
                        <div className="text-xs text-zinc-500 truncate">
                            {isConnected ? (
                                <span className="flex items-center gap-1 text-green-400">
                                    <Check className="w-3 h-3" /> Connected
                                </span>
                            ) : (
                                provider.description
                            )}
                        </div>
                    </div>
                </div>

                {isDisabled ? (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled
                        className="shrink-0 ml-2 opacity-50"
                    >
                        <MessageCircle className="w-3 h-3 mr-1" />
                        Soon
                    </Button>
                ) : (
                    <Button
                        variant={isConnected ? "destructive" : "outline"}
                        size="sm"
                        disabled={isLoading}
                        className="shrink-0 ml-2"
                        onClick={() => {
                            if (isConnected) {
                                disconnectAccount(provider);
                            } else if (isChannel && provider.slug === "telegram") {
                                connectTelegram();
                            } else {
                                connectAccount(provider);
                            }
                        }}
                    >
                        {isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isConnected ? (
                            <>
                                <Unplug className="w-3 h-3 mr-1" />
                                Disconnect
                            </>
                        ) : isChannel ? (
                            <>
                                <Send className="w-3 h-3 mr-1" />
                                Link Bot
                            </>
                        ) : (
                            <>
                                <ExternalLink className="w-3 h-3 mr-1" />
                                Connect
                            </>
                        )}
                    </Button>
                )}
            </div>
        );
    };

    return (
        <Dialog open={handleOpen} onOpenChange={handleOpenChange}>
            {showTrigger && (
                <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                        <Backpack className="w-4 h-4" />
                        Backpack
                    </Button>
                </DialogTrigger>
            )}

            <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Backpack className="w-5 h-5 text-fuchsia-400" />
                        Your Backpack
                    </DialogTitle>
                    <DialogDescription>
                        Manage permissions and connected accounts for AI agents.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="permissions" className="gap-2">
                            <Shield className="w-4 h-4" />
                            Permissions
                            {grantedPermissionsCount > 0 && (
                                <Badge variant="secondary" className="ml-1 text-xs px-1.5">
                                    {grantedPermissionsCount}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="accounts" className="gap-2">
                            <Link2 className="w-4 h-4" />
                            Accounts
                            {connectedAccountsCount > 0 && (
                                <Badge variant="secondary" className="ml-1 text-xs px-1.5">
                                    {connectedAccountsCount}
                                </Badge>
                            )}
                        </TabsTrigger>
                    </TabsList>

                    {/* Permissions Tab */}
                    <TabsContent value="permissions" className="flex-1 overflow-y-auto mt-4 space-y-3">
                        {PERMISSION_TYPES.map(perm => (
                            <div key={perm.type} className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-md bg-zinc-800 text-zinc-400">
                                        {perm.icon}
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-zinc-200">{perm.label}</div>
                                        <div className="text-xs text-zinc-500">{perm.description}</div>
                                    </div>
                                </div>

                                {loadingPermission === perm.type ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                                ) : (
                                    <Switch
                                        checked={permissions[perm.type]}
                                        onCheckedChange={(checked) => {
                                            if (checked) {
                                                requestPermission(perm.type);
                                            } else {
                                                revokePermission(perm.type);
                                            }
                                        }}
                                    />
                                )}
                            </div>
                        ))}
                    </TabsContent>

                    {/* Connected Accounts Tab */}
                    <TabsContent value="accounts" className="flex-1 overflow-y-auto mt-4 space-y-3">
                        {/* Search + Refresh row */}
                        <div className="flex items-center gap-2 mb-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                                <input
                                    type="text"
                                    placeholder="Search 870+ integrations..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full h-8 pl-8 pr-8 text-sm bg-zinc-900/80 border border-zinc-700 rounded-md text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/20 transition-colors"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery("")}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs text-zinc-400 hover:text-zinc-200 shrink-0"
                                onClick={fetchConnections}
                                disabled={refreshing}
                            >
                                <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                        </div>

                        {/* Search results */}
                        {searchQuery.trim() && (
                            <div className="space-y-2">
                                {searching && (
                                    <div className="flex items-center justify-center py-4 text-zinc-500 text-sm">
                                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                        Searching...
                                    </div>
                                )}
                                {!searching && filteredSearchResults.length === 0 && searchResults.length === 0 && (
                                    <div className="text-center py-4 text-zinc-500 text-sm">
                                        No integrations found for "{searchQuery}"
                                    </div>
                                )}
                                {filteredSearchResults.map(tk =>
                                    renderProviderCard(toolkitToProvider(tk))
                                )}
                                {filteredSearchResults.length > 0 && (
                                    <div className="border-t border-zinc-800 my-3" />
                                )}
                            </div>
                        )}

                        {/* Featured Providers */}
                        {(!searchQuery.trim() || filteredSearchResults.length > 0 || searchResults.some(sr => featuredSlugs.has(sr.slug))) && (
                            <>
                                {searchQuery.trim() && (
                                    <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                                        Popular
                                    </div>
                                )}
                                {FEATURED_PROVIDERS.map(provider =>
                                    renderProviderCard(provider)
                                )}
                            </>
                        )}

                        <p className="text-xs text-zinc-500 text-center pt-4">
                            Compose Market never sees or stores your tokens.
                        </p>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

export default BackpackDialog;
