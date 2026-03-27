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

import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from "react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import {
    BACKPACK_CLOUD_PERMISSION_TYPES,
    fetchBackpackPermissions,
    getCachedBackpackPermissions,
    grantBackpackPermission,
    revokeBackpackPermission as revokeBackpackCloudPermission,
    type BackpackCloudPermission,
} from "@/lib/backpack";
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
    QrCode,
    Smartphone,
    ArrowLeft,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL || "https://api.compose.market").replace(/\/+$/, "");
const SOCKET_BASE = (import.meta.env.VITE_SOCKET_URL || "wss://services.compose.market/socket").replace(/\/+$/, "");

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

const PERMISSION_META: Record<BackpackCloudPermission, Omit<Permission, "type" | "granted">> = {
    filesystem: {
        label: "File System",
        description: "Access files and folders on your device",
        icon: <FolderOpen className="w-4 h-4" />,
    },
    camera: {
        label: "Camera",
        description: "Use your camera for photos and video",
        icon: <Camera className="w-4 h-4" />,
    },
    microphone: {
        label: "Microphone",
        description: "Record audio with your microphone",
        icon: <Mic className="w-4 h-4" />,
    },
    geolocation: {
        label: "Location",
        description: "Access your current location",
        icon: <MapPin className="w-4 h-4" />,
    },
    clipboard: {
        label: "Clipboard",
        description: "Read and write to your clipboard",
        icon: <Clipboard className="w-4 h-4" />,
    },
    notifications: {
        label: "Notifications",
        description: "Send you desktop notifications",
        icon: <Bell className="w-4 h-4" />,
    },
};

const PERMISSION_TYPES: Omit<Permission, "granted">[] = BACKPACK_CLOUD_PERMISSION_TYPES.map((type) => ({
    type,
    ...PERMISSION_META[type],
}));

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
        description: "Scan QR to link your account",
        connectionType: "channel",
    },
];

// =============================================================================
// Component
// =============================================================================

interface BackpackDialogProps {
    userAddress?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    showTrigger?: boolean;
}

export function BackpackDialog({
    userAddress,
    open,
    onOpenChange,
    showTrigger = true
}: BackpackDialogProps) {
    const { toast } = useToast();
    const isMobile = useIsMobile();
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("permissions");
    const [loadingPermission, setLoadingPermission] = useState<string | null>(null);
    const [loadingAccount, setLoadingAccount] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    // Search state
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<ToolkitResult[]>([]);
    const [searching, setSearching] = useState(false);

    // WhatsApp connect screen state
    const [whatsappScreen, setWhatsappScreen] = useState<null | "qr">(null);
    const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
    const [whatsappQrLoading, setWhatsappQrLoading] = useState(false);
    const [whatsappPairingCode, setWhatsappPairingCode] = useState<string | null>(null);
    const [whatsappPhoneInput, setWhatsappPhoneInput] = useState("");
    const whatsappWsRef = useRef<WebSocket | null>(null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchAbortRef = useRef<AbortController | null>(null);
    const connectionsAbortRef = useRef<AbortController | null>(null);
    const statusPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const statusPollAbortRef = useRef<AbortController | null>(null);
    const statusPollBusyRef = useRef(false);

    // Permission states (cached locally, sourced from Backpack)
    const [permissions, setPermissions] = useState<Record<string, boolean>>(() => {
        const cached = new Set(getCachedBackpackPermissions());
        return Object.fromEntries(
            PERMISSION_TYPES.map((permission) => [permission.type, cached.has(permission.type as BackpackCloudPermission)]),
        );
    });

    // Connection states fetched from Composio via backend
    const [connections, setConnections] = useState<Record<string, ConnectionStatus>>({});

    const handleOpen = open !== undefined ? open : isOpen;
    const handleOpenChange = onOpenChange || setIsOpen;

    const clearStatusPolling = useCallback(() => {
        if (statusPollIntervalRef.current) {
            clearInterval(statusPollIntervalRef.current);
            statusPollIntervalRef.current = null;
        }
        if (statusPollAbortRef.current) {
            statusPollAbortRef.current.abort();
            statusPollAbortRef.current = null;
        }
        statusPollBusyRef.current = false;
    }, []);

    const cleanupAsyncWork = useCallback(() => {
        if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = null;
        }
        if (searchAbortRef.current) {
            searchAbortRef.current.abort();
            searchAbortRef.current = null;
        }
        if (connectionsAbortRef.current) {
            connectionsAbortRef.current.abort();
            connectionsAbortRef.current = null;
        }
        clearStatusPolling();
        if (whatsappWsRef.current) {
            whatsappWsRef.current.close();
            whatsappWsRef.current = null;
        }
    }, [clearStatusPolling]);

    const resetTransientState = useCallback(() => {
        setLoadingAccount(null);
        setWhatsappScreen(null);
        setWhatsappQr(null);
        setWhatsappQrLoading(false);
        setWhatsappPairingCode(null);
        setWhatsappPhoneInput("");
        setSearching(false);
    }, []);

    const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen) {
            cleanupAsyncWork();
            resetTransientState();
        }
        handleOpenChange(nextOpen);
    }, [cleanupAsyncWork, handleOpenChange, resetTransientState]);

    // Effective userAddress — fallback to anonymous session id
    const effectiveUserId = userAddress || sessionStorage.getItem("composio_anon_id") || (() => {
        const id = `anon_${crypto.randomUUID()}`;
        sessionStorage.setItem("composio_anon_id", id);
        return id;
    })();

    // ==========================================================================
    // Fetch Connection Status from Backend
    // ==========================================================================

    const fetchConnections = useCallback(async () => {
        if (connectionsAbortRef.current) {
            connectionsAbortRef.current.abort();
        }

        const controller = new AbortController();
        connectionsAbortRef.current = controller;

        try {
            setRefreshing(true);
            const res = await fetch(
                `${API_BASE}/api/backpack/connections?userAddress=${encodeURIComponent(effectiveUserId)}`,
                { signal: controller.signal },
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
            if (controller.signal.aborted) {
                return;
            }
            console.warn("[Backpack] Could not fetch connections:", err);
        } finally {
            if (connectionsAbortRef.current === controller) {
                connectionsAbortRef.current = null;
                setRefreshing(false);
            }
        }
    }, [effectiveUserId]);

    const fetchPermissions = useCallback(async () => {
        try {
            const granted = await fetchBackpackPermissions(effectiveUserId);
            const grantedSet = new Set(granted);
            setPermissions(() => Object.fromEntries(
                PERMISSION_TYPES.map((permission) => [permission.type, grantedSet.has(permission.type as BackpackCloudPermission)]),
            ));
        } catch (err) {
            console.warn("[Backpack] Could not fetch permissions:", err);
        }
    }, [effectiveUserId]);

    useEffect(() => {
        if (handleOpen && activeTab === "permissions") {
            void fetchPermissions();
        }
    }, [activeTab, fetchPermissions, handleOpen]);

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
            if (searchAbortRef.current) {
                searchAbortRef.current.abort();
                searchAbortRef.current = null;
            }
            setSearchResults([]);
            return;
        }

        if (searchAbortRef.current) {
            searchAbortRef.current.abort();
        }

        const controller = new AbortController();
        searchAbortRef.current = controller;

        setSearching(true);
        try {
            const res = await fetch(
                `${API_BASE}/api/backpack/toolkits?search=${encodeURIComponent(query)}&limit=15`,
                { signal: controller.signal },
            );
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data.toolkits || []);
            }
        } catch (err) {
            if (controller.signal.aborted) {
                return;
            }
            console.warn("[Backpack] Search error:", err);
        } finally {
            if (searchAbortRef.current === controller) {
                searchAbortRef.current = null;
                setSearching(false);
            }
        }
    }, []);

    // Debounced search
    useEffect(() => {
        if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
        }
        if (!searchQuery.trim()) {
            if (searchAbortRef.current) {
                searchAbortRef.current.abort();
                searchAbortRef.current = null;
            }
            setSearchResults([]);
            setSearching(false);
            return;
        }
        searchDebounceRef.current = setTimeout(() => {
            searchToolkits(searchQuery);
        }, 300);
        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchQuery, searchToolkits]);

    const startStatusPolling = useCallback((poll: (signal: AbortSignal) => Promise<boolean>) => {
        clearStatusPolling();

        const controller = new AbortController();
        statusPollAbortRef.current = controller;

        let attempts = 0;
        const runPoll = async () => {
            if (controller.signal.aborted || statusPollBusyRef.current) {
                return;
            }

            statusPollBusyRef.current = true;
            attempts += 1;
            try {
                const isComplete = await poll(controller.signal);
                if (isComplete) {
                    clearStatusPolling();
                    setLoadingAccount(null);
                    return;
                }

                if (attempts >= 40) {
                    clearStatusPolling();
                    setLoadingAccount(null);
                }
            } catch (err) {
                if (!controller.signal.aborted) {
                    console.warn("[Backpack] Polling error:", err);
                }
            } finally {
                statusPollBusyRef.current = false;
            }
        };

        statusPollIntervalRef.current = setInterval(() => {
            void runPoll();
        }, 3000);
    }, [clearStatusPolling]);

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
                await grantBackpackPermission(effectiveUserId, type as BackpackCloudPermission);
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
    }, [effectiveUserId, toast]);

    const revokePermission = useCallback(async (type: string) => {
        try {
            await revokeBackpackCloudPermission(effectiveUserId, type as BackpackCloudPermission);
            setPermissions(prev => ({ ...prev, [type]: false }));
            toast({ title: "Permission Revoked", description: `${type} access disabled.` });
        } catch (err) {
            toast({
                title: "Revoke Failed",
                description: err instanceof Error ? err.message : `Could not revoke ${type} access.`,
                variant: "destructive",
            });
        }
    }, [effectiveUserId, toast]);

    // ==========================================================================
    // OAuth Handlers — Composio Credential Broker
    // ==========================================================================

    const connectAccount = useCallback(async (provider: ProviderDisplay) => {
        setLoadingAccount(provider.slug);
        clearStatusPolling();

        try {
            // Step 1: Call backend to get OAuth redirect URL from Composio
            const res = await fetch(`${API_BASE}/api/backpack/connect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userAddress: effectiveUserId,
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

            startStatusPolling(async (signal) => {
                const statusRes = await fetch(
                    `${API_BASE}/api/backpack/status/${encodeURIComponent(provider.slug)}?userAddress=${encodeURIComponent(effectiveUserId)}`,
                    { signal },
                );
                if (!statusRes.ok) {
                    return false;
                }

                const statusData = await statusRes.json();
                if (!statusData.connected) {
                    return false;
                }

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
                return true;
            });

        } catch (err) {
            console.error("[Backpack] Connection error:", err);
            toast({
                title: "Connection Failed",
                description: err instanceof Error ? err.message : "Could not connect account.",
                variant: "destructive"
            });
            setLoadingAccount(null);
        }
    }, [clearStatusPolling, effectiveUserId, startStatusPolling, toast]);

    // ==========================================================================
    // Channel-Based Connection (Telegram)
    // ==========================================================================

    const connectTelegram = useCallback(async () => {
        setLoadingAccount("telegram");
        clearStatusPolling();

        try {
            // Generate a deep link
            const res = await fetch(`${API_BASE}/api/backpack/telegram/link`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userAddress: effectiveUserId }),
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

            startStatusPolling(async (signal) => {
                const statusRes = await fetch(
                    `${API_BASE}/api/backpack/telegram/status?userAddress=${encodeURIComponent(effectiveUserId)}`,
                    { signal },
                );
                if (!statusRes.ok) {
                    return false;
                }

                const statusData = await statusRes.json();
                if (!statusData.bound) {
                    return false;
                }

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
                return true;
            });
        } catch (err) {
            console.error("[Backpack] Telegram connection error:", err);
            toast({
                title: "Connection Failed",
                description: err instanceof Error ? err.message : "Could not connect Telegram.",
                variant: "destructive",
            });
            setLoadingAccount(null);
        }
    }, [clearStatusPolling, effectiveUserId, startStatusPolling, toast]);

    // ==========================================================================
    // Channel-Based Connection (WhatsApp via Baileys WebSocket)
    // ==========================================================================

    const connectWhatsApp = useCallback(() => {
        clearStatusPolling();

        // Close any existing WS connection
        if (whatsappWsRef.current) {
            whatsappWsRef.current.close();
            whatsappWsRef.current = null;
        }

        setWhatsappScreen("qr");
        setWhatsappQr(null);
        setWhatsappQrLoading(true);
        setLoadingAccount("whatsapp");

        const wsUrl = `${SOCKET_BASE}/whatsapp?userAddress=${encodeURIComponent(effectiveUserId)}`;
        console.log(`[Backpack] Connecting WhatsApp WebSocket: ${wsUrl}`);

        const ws = new WebSocket(wsUrl);
        whatsappWsRef.current = ws;

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                console.log(`[Backpack] WhatsApp WS message:`, msg.type);

                switch (msg.type) {
                    case "qr":
                        setWhatsappQr(msg.qr);
                        setWhatsappQrLoading(false);
                        break;

                    case "connected":
                        setWhatsappScreen(null);
                        setWhatsappQr(null);
                        setConnections(prev => ({
                            ...prev,
                            whatsapp: {
                                slug: "whatsapp",
                                name: "WhatsApp",
                                connected: true,
                            },
                        }));
                        toast({
                            title: "Connected!",
                            description: `WhatsApp linked successfully${msg.phoneNumber ? ` (${msg.phoneNumber})` : ""}.`,
                        });
                        setLoadingAccount(null);
                        break;

                    case "already_connected":
                        setWhatsappScreen(null);
                        setConnections(prev => ({
                            ...prev,
                            whatsapp: {
                                slug: "whatsapp",
                                name: "WhatsApp",
                                connected: true,
                            },
                        }));
                        toast({
                            title: "Already Connected",
                            description: "WhatsApp is already linked.",
                        });
                        setLoadingAccount(null);
                        break;

                    case "error":
                        console.error(`[Backpack] WhatsApp error:`, msg.message);
                        toast({
                            title: "Connection Failed",
                            description: msg.message || "Could not connect WhatsApp.",
                            variant: "destructive",
                        });
                        setWhatsappScreen(null);
                        setWhatsappQrLoading(false);
                        setLoadingAccount(null);
                        break;

                    case "disconnected":
                        setWhatsappScreen(null);
                        setWhatsappQr(null);
                        setLoadingAccount(null);
                        break;

                    case "reconnecting":
                        setWhatsappQrLoading(true);
                        setWhatsappQr(null);
                        break;

                    case "pairing_code_pending":
                        setWhatsappPairingCode(null);
                        setWhatsappQr(null);
                        setWhatsappQrLoading(true);
                        break;

                    case "pairing_code":
                        setWhatsappPairingCode(msg.code);
                        setWhatsappQrLoading(false);
                        break;
                }
            } catch {
                // Ignore malformed messages
            }
        };

        ws.onerror = () => {
            console.error("[Backpack] WhatsApp WebSocket error");
            toast({
                title: "Connection Error",
                description: "Could not reach WhatsApp service. Try again.",
                variant: "destructive",
            });
            setWhatsappScreen(null);
            setWhatsappQrLoading(false);
            setLoadingAccount(null);
        };

        ws.onclose = () => {
            console.log("[Backpack] WhatsApp WebSocket closed");
            whatsappWsRef.current = null;
        };
    }, [effectiveUserId, toast]);

    const cancelWhatsApp = useCallback(() => {
        if (whatsappWsRef.current) {
            whatsappWsRef.current.close();
            whatsappWsRef.current = null;
        }
        setWhatsappScreen(null);
        setWhatsappQr(null);
        setWhatsappQrLoading(false);
        setWhatsappPairingCode(null);
        setWhatsappPhoneInput("");
        setLoadingAccount(null);
    }, []);

    const disconnectAccount = useCallback(async (provider: ProviderDisplay) => {
        setLoadingAccount(provider.slug);

        try {
            const res = await fetch(`${API_BASE}/api/backpack/disconnect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userAddress: effectiveUserId,
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

    useEffect(() => {
        return () => {
            cleanupAsyncWork();
        };
    }, [cleanupAsyncWork]);

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
            <Fragment key={provider.slug}>
                <div
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
                                } else if (isChannel && provider.slug === "whatsapp") {
                                    connectWhatsApp();
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
                            ) : isChannel && provider.slug === "whatsapp" ? (
                                <>
                                    <QrCode className="w-3 h-3 mr-1" />
                                    Scan QR
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

                {/* WhatsApp QR Code inline display */}
                {/* Removed inline QR display */}
            </Fragment>
        );
    };

    return (
        <Dialog open={handleOpen} onOpenChange={handleDialogOpenChange}>
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

                {/* ========== WhatsApp Dedicated Connection Screen ========== */}
                {whatsappScreen ? (
                    <div className="flex-1 flex flex-col gap-4 py-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="self-start gap-1.5 text-zinc-400 hover:text-zinc-200 -ml-2"
                            onClick={cancelWhatsApp}
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back
                        </Button>

                        <div className="flex items-center gap-3 mb-2">
                            <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center"
                                style={{ backgroundColor: "#25D36615" }}
                            >
                                <img
                                    src="https://logos.composio.dev/api/whatsapp"
                                    alt="WhatsApp"
                                    className="w-7 h-7 object-contain"
                                />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-zinc-100">Connect WhatsApp</h3>
                                <p className="text-xs text-zinc-400">
                                    {isMobile
                                        ? "Link your WhatsApp account"
                                        : "Scan with your phone to link"}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col items-center gap-4 py-2">
                            {isMobile ? (
                                /* ===== Mobile: Phone pairing code ===== */
                                whatsappPairingCode ? (
                                    <div className="flex flex-col items-center gap-4 py-4">
                                        <div className="text-sm text-zinc-300 text-center">
                                            Enter this code in WhatsApp to link:
                                        </div>
                                        <div className="font-mono text-3xl font-bold tracking-[0.3em] text-green-400 bg-zinc-900 px-6 py-4 rounded-xl border border-zinc-700">
                                            {whatsappPairingCode}
                                        </div>
                                        <p className="text-xs text-zinc-500 text-center">
                                            WhatsApp → Linked Devices → Link a Device
                                        </p>
                                        <div className="flex items-center gap-2 text-xs text-zinc-600">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Waiting for pairing...
                                        </div>
                                    </div>
                                ) : whatsappQrLoading ? (
                                    <div className="flex flex-col items-center gap-3 py-8">
                                        <Loader2 className="w-10 h-10 animate-spin text-green-500" />
                                        <span className="text-sm text-zinc-400">Generating pairing code...</span>
                                    </div>
                                ) : (
                                    <form
                                        className="flex flex-col items-center gap-4 py-2 w-full max-w-xs"
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            const phone = whatsappPhoneInput.replace(/[^0-9]/g, "");
                                            if (phone.length < 10) return;
                                            if (whatsappWsRef.current?.readyState === WebSocket.OPEN) {
                                                whatsappWsRef.current.send(JSON.stringify({ type: "pair_phone", phone }));
                                            }
                                        }}
                                    >
                                        <p className="text-xs text-zinc-500 text-center leading-relaxed">
                                            Enter your full number with country code (no + or spaces).
                                            It's only used to generate a one-time linking code.
                                            Compose never stores or shares your data.
                                        </p>
                                        <input
                                            type="tel"
                                            placeholder="e.g. 14155551234"
                                            value={whatsappPhoneInput}
                                            onChange={(e) => setWhatsappPhoneInput(e.target.value)}
                                            className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-center font-mono text-lg placeholder:text-zinc-600 focus:outline-none focus:border-green-500 transition-colors"
                                            autoFocus
                                        />
                                        <Button
                                            type="submit"
                                            disabled={whatsappPhoneInput.replace(/[^0-9]/g, "").length < 10}
                                            className="w-full bg-green-600 hover:bg-green-700 text-white"
                                        >
                                            Get Linking Code
                                        </Button>
                                    </form>
                                )
                            ) : (
                                /* ===== Desktop: QR code scanning ===== */
                                <>
                                    {whatsappQrLoading ? (
                                        <div className="flex flex-col items-center gap-3 py-8">
                                            <Loader2 className="w-10 h-10 animate-spin text-green-500" />
                                            <span className="text-sm text-zinc-400">Generating QR code...</span>
                                        </div>
                                    ) : whatsappQr ? (
                                        <>
                                            <div className="p-4 rounded-xl bg-white">
                                                <img
                                                    src={whatsappQr.startsWith("data:") ? whatsappQr : `data:image/png;base64,${whatsappQr}`}
                                                    alt="Scan with WhatsApp"
                                                    className="w-52 h-52 object-contain"
                                                />
                                            </div>
                                            <div className="flex flex-col items-center gap-1.5">
                                                <div className="flex items-center gap-2 text-sm text-zinc-300">
                                                    <Smartphone className="w-4 h-4 text-green-400" />
                                                    Scan with WhatsApp
                                                </div>
                                                <p className="text-xs text-zinc-500 text-center">
                                                    Open WhatsApp → Settings → Linked Devices → Link a Device
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-zinc-600 mt-2">
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                Waiting for scan...
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-zinc-400 py-4">
                                            QR code not available. Please try again.
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ) : (
                    <>

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
                    </>)}
            </DialogContent>
        </Dialog>
    );
}

export default BackpackDialog;
