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
    RadioTower,
    Gamepad2,
    Hash,
    KeyRound,
} from "lucide-react";
import { sdk } from "@/lib/sdk";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type {
    ChannelLinkResponse,
    ChannelName,
    ChannelRoute,
    ChannelStatusResponse,
} from "@compose-market/sdk";

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
    connectedAccountId?: string;
}

interface ToolkitResult {
    slug: string;
    name: string;
    logo: string;
    description: string;
    categories: string[];
    authSchemes: string[];
}

const CONNECTORS_URL = (import.meta.env.VITE_CONNECTORS_URL || "https://connectors.compose.market").replace(/\/+$/, "");

interface ConnectorVarSpec {
    varName: string;
    description?: string;
    obtainUrl?: string;
}

interface ConnectorRow {
    slug: string;
    name: string;
    connected: boolean;
    allowed: boolean;
    status: string;
    missingVars: ConnectorVarSpec[];
    actions?: string[];
}

interface ConnectorCatalogEntry {
    slug: string;
    name: string;
    description?: string;
}

type StatusMap = Partial<Record<ChannelName, ChannelStatusResponse>>;

type WhatsAppState = {
    socket: string;
    qr?: string;
    pairing?: string;
    loading: boolean;
    phone: string;
};

const CHANNELS_LIST = ["telegram", "whatsapp", "slack", "discord"] as const satisfies readonly ChannelName[];

const CHANNEL_META: Record<ChannelName, {
    label: string;
    description: string;
    logo: string;
    color: string;
}> = {
    telegram: {
        label: "Telegram",
        description: "Personal bot chat",
        logo: "https://logos.composio.dev/api/telegram",
        color: "#24A1DE",
    },
    whatsapp: {
        label: "WhatsApp",
        description: "Linked device route",
        logo: "https://logos.composio.dev/api/whatsapp",
        color: "#25D366",
    },
    slack: {
        label: "Slack",
        description: "DMs and workspace threads",
        logo: "https://logos.composio.dev/api/slack",
        color: "#4A154B",
    },
    discord: {
        label: "Discord",
        description: "DMs and server threads",
        logo: "https://logos.composio.dev/api/discord",
        color: "#5865F2",
    },
};

function routeLabel(route: ChannelRoute): string {
    const meta = route.metadata || {};
    const label = [
        route.label,
        typeof meta.label === "string" ? meta.label : undefined,
        typeof meta.threadName === "string" ? meta.threadName : undefined,
        typeof meta.discordChannelId === "string" ? `Discord ${meta.discordChannelId}` : undefined,
        route.threadId,
        route.accountId,
    ].find((value) => typeof value === "string" && value.trim().length > 0);
    return label || route.id;
}

function short(value: string): string {
    return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function actionUrl(link: ChannelLinkResponse): string | null {
    return link.action?.url || link.url || null;
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
];

// =============================================================================
// Component
// =============================================================================

interface BackpackDialogProps {
    userAddress?: string;
    agentWallet?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    showTrigger?: boolean;
    agentName?: string;
}

export function BackpackDialog({
    userAddress,
    agentWallet,
    open,
    onOpenChange,
    showTrigger = true,
    agentName
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

    // Channels states
    const [channelStatuses, setChannelStatuses] = useState<StatusMap>({});
    const [loadingChannels, setLoadingChannels] = useState(false);
    const [busyChannel, setBusyChannel] = useState<ChannelName | null>(null);
    const [disconnectingChannel, setDisconnectingChannel] = useState<string | null>(null);

    const [whatsappChannelState, setWhatsappChannelState] = useState<WhatsAppState | null>(null);
    const channelsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const channelsAbortRef = useRef<AbortController | null>(null);
    const channelsWsRef = useRef<WebSocket | null>(null);

    // Permission states (cached locally, sourced from Backpack)
    const [permissions, setPermissions] = useState<Record<string, boolean>>(() => {
        const cached = new Set(getCachedBackpackPermissions(agentWallet));
        return Object.fromEntries(
            PERMISSION_TYPES.map((permission) => [permission.type, cached.has(permission.type as BackpackCloudPermission)]),
        );
    });

    // Connection states fetched from Composio via backend
    const [connections, setConnections] = useState<Record<string, ConnectionStatus>>({});

    // Credential-gated connector states (user-scoped backpack)
    const [connectorRows, setConnectorRows] = useState<ConnectorRow[]>([]);
    const [loadingConnectors, setLoadingConnectors] = useState(false);
    const [connectorBusy, setConnectorBusy] = useState<string | null>(null);
    const [gatedCatalog, setGatedCatalog] = useState<ConnectorCatalogEntry[]>([]);
    const [connectPanel, setConnectPanel] = useState<null | { slug: string; name: string; credentials: ConnectorVarSpec[] }>(null);
    const [connectVars, setConnectVars] = useState<Record<string, string>>({});
    const [connectSubmitting, setConnectSubmitting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);

    // Connector catalog search (same pattern as the accounts toolkit search)
    const [connectorSearchQuery, setConnectorSearchQuery] = useState("");
    const [connectorSearchResults, setConnectorSearchResults] = useState<ConnectorCatalogEntry[]>([]);
    const [searchingConnectors, setSearchingConnectors] = useState(false);
    const connectorSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const connectorSearchAbortRef = useRef<AbortController | null>(null);

    const handleOpen = open !== undefined ? open : isOpen;
    const handleOpenChange = onOpenChange || setIsOpen;

    const agentLabel = agentName || (agentWallet ? `${agentWallet.slice(0, 6)}...${agentWallet.slice(-4)}` : "Agent");

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

    const cleanupChannels = useCallback(() => {
        if (channelsPollRef.current) {
            clearInterval(channelsPollRef.current);
            channelsPollRef.current = null;
        }
        if (channelsAbortRef.current) {
            channelsAbortRef.current.abort();
            channelsAbortRef.current = null;
        }
        if (channelsWsRef.current) {
            channelsWsRef.current.close();
            channelsWsRef.current = null;
        }
        setWhatsappChannelState(null);
        setBusyChannel(null);
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
        if (connectorSearchDebounceRef.current) {
            clearTimeout(connectorSearchDebounceRef.current);
            connectorSearchDebounceRef.current = null;
        }
        if (connectorSearchAbortRef.current) {
            connectorSearchAbortRef.current.abort();
            connectorSearchAbortRef.current = null;
        }
        clearStatusPolling();
        if (whatsappWsRef.current) {
            whatsappWsRef.current.close();
            whatsappWsRef.current = null;
        }
        cleanupChannels();
    }, [clearStatusPolling, cleanupChannels]);

    const resetTransientState = useCallback(() => {
        setLoadingAccount(null);
        setWhatsappScreen(null);
        setWhatsappQr(null);
        setWhatsappQrLoading(false);
        setWhatsappPairingCode(null);
        setWhatsappPhoneInput("");
        setSearching(false);
        setWhatsappChannelState(null);
        setBusyChannel(null);
        setConnectPanel(null);
        setConnectVars({});
        setConnectSubmitting(false);
        setConnectError(null);
        setConnectorSearchQuery("");
        setConnectorSearchResults([]);
        setSearchingConnectors(false);
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
            if (!agentWallet) {
                setConnections({});
                return;
            }
            setRefreshing(true);
            const data = await sdk.accounts.list({ userAddress: effectiveUserId, agentWallet }, { signal: controller.signal });
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
    }, [agentWallet, effectiveUserId]);

    // ==========================================================================
    // Credential-Gated Connectors (user-scoped backpack)
    // ==========================================================================

    const fetchConnectors = useCallback(async () => {
        if (!agentWallet) {
            setConnectorRows([]);
            return;
        }
        setLoadingConnectors(true);
        try {
            const status = await sdk.gated.status({ userAddress: effectiveUserId, agentWallet });
            setConnectorRows(status.connectors || []);
        } catch (err) {
            console.warn("[Backpack] Could not fetch connectors:", err);
        } finally {
            setLoadingConnectors(false);
        }
    }, [agentWallet, effectiveUserId]);

    const fetchGatedCatalog = useCallback(async () => {
        try {
            const response = await fetch(`${CONNECTORS_URL}/mcps?status=credential_gated&limit=100`, {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) return;
            const data = await response.json() as {
                servers?: Array<{ slug?: string; name?: string; description?: string }>;
            };
            setGatedCatalog((data.servers || [])
                .filter((server): server is { slug: string; name?: string; description?: string } => typeof server.slug === "string" && server.slug.length > 0)
                .map((server) => ({
                    slug: server.slug,
                    name: server.name || server.slug,
                    ...(server.description ? { description: server.description } : {}),
                })));
        } catch (err) {
            console.warn("[Backpack] Could not fetch gated catalog:", err);
        }
    }, []);

    const searchConnectors = useCallback(async (query: string) => {
        if (!query.trim()) {
            if (connectorSearchAbortRef.current) {
                connectorSearchAbortRef.current.abort();
                connectorSearchAbortRef.current = null;
            }
            setConnectorSearchResults([]);
            return;
        }

        if (connectorSearchAbortRef.current) {
            connectorSearchAbortRef.current.abort();
        }

        const controller = new AbortController();
        connectorSearchAbortRef.current = controller;

        setSearchingConnectors(true);
        try {
            const response = await fetch(
                `${CONNECTORS_URL}/mcps/search?q=${encodeURIComponent(query)}&limit=30`,
                { headers: { Accept: "application/json" }, signal: controller.signal },
            );
            if (!response.ok) {
                setConnectorSearchResults([]);
                return;
            }
            const data = await response.json() as {
                servers?: Array<{ slug?: string; name?: string; description?: string; status?: string }>;
            };
            setConnectorSearchResults((data.servers || [])
                .filter((server): server is { slug: string; name?: string; description?: string } =>
                    typeof server.slug === "string" && server.slug.length > 0 && server.status === "credential_gated")
                .map((server) => ({
                    slug: server.slug,
                    name: server.name || server.slug,
                    ...(server.description ? { description: server.description } : {}),
                })));
        } catch (err) {
            if (controller.signal.aborted) {
                return;
            }
            console.warn("[Backpack] Connector search error:", err);
        } finally {
            if (connectorSearchAbortRef.current === controller) {
                connectorSearchAbortRef.current = null;
                setSearchingConnectors(false);
            }
        }
    }, []);

    // Debounced connector search
    useEffect(() => {
        if (connectorSearchDebounceRef.current) {
            clearTimeout(connectorSearchDebounceRef.current);
        }
        if (!connectorSearchQuery.trim()) {
            if (connectorSearchAbortRef.current) {
                connectorSearchAbortRef.current.abort();
                connectorSearchAbortRef.current = null;
            }
            setConnectorSearchResults([]);
            setSearchingConnectors(false);
            return;
        }
        connectorSearchDebounceRef.current = setTimeout(() => {
            searchConnectors(connectorSearchQuery);
        }, 300);
        return () => {
            if (connectorSearchDebounceRef.current) clearTimeout(connectorSearchDebounceRef.current);
        };
    }, [connectorSearchQuery, searchConnectors]);

    const openConnectPanel = useCallback(async (slug: string, name?: string) => {
        setConnectorBusy(slug);
        setConnectError(null);
        try {
            const response = await fetch(`${CONNECTORS_URL}/mcps/${encodeURIComponent(slug)}`, {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) {
                throw new Error(`Connector catalog entry unavailable (${response.status}).`);
            }
            const card = await response.json() as {
                slug?: string;
                name?: string;
                credentials?: Array<{ varName?: string; description?: string; obtainUrl?: string }>;
            };
            const credentials = (card.credentials || [])
                .filter((entry): entry is { varName: string; description?: string; obtainUrl?: string } =>
                    typeof entry?.varName === "string" && entry.varName.trim().length > 0)
                .map((entry) => ({
                    varName: entry.varName.trim(),
                    ...(entry.description ? { description: entry.description } : {}),
                    ...(entry.obtainUrl ? { obtainUrl: entry.obtainUrl } : {}),
                }));
            setConnectPanel({ slug, name: card.name || name || slug, credentials });
            setConnectVars(Object.fromEntries(credentials.map((credential) => [credential.varName, ""])));
        } catch (err) {
            setConnectError(err instanceof Error ? err.message : "Could not load connector requirements.");
        } finally {
            setConnectorBusy(null);
        }
    }, []);

    const submitConnectorConnect = useCallback(async () => {
        if (!connectPanel || !agentWallet) return;
        setConnectSubmitting(true);
        setConnectError(null);
        try {
            const vars: Record<string, string> = {};
            for (const credential of connectPanel.credentials) {
                const value = (connectVars[credential.varName] || "").trim();
                if (!value) {
                    throw new Error(`${credential.varName} is required.`);
                }
                vars[credential.varName] = value;
            }
            await sdk.gated.connect({
                userAddress: effectiveUserId,
                slug: connectPanel.slug,
                vars,
                agentWallet,
            });
            toast({
                title: "Connector connected",
                description: `${connectPanel.name} credentials stored and ${agentLabel} granted.`,
            });
            setConnectPanel(null);
            setConnectVars({});
            void fetchConnectors();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Could not connect connector.";
            setConnectError(message);
            toast({ title: "Connector connect failed", description: message, variant: "destructive" });
        } finally {
            setConnectSubmitting(false);
        }
    }, [agentLabel, agentWallet, connectPanel, connectVars, effectiveUserId, fetchConnectors, toast]);

    const disconnectConnector = useCallback(async (row: ConnectorRow) => {
        setConnectorBusy(row.slug);
        try {
            await sdk.gated.disconnect({ userAddress: effectiveUserId, slug: row.slug });
            toast({ title: "Connector disconnected", description: `${row.name} credentials removed.` });
            void fetchConnectors();
        } catch (err) {
            toast({
                title: "Disconnect failed",
                description: err instanceof Error ? err.message : "Could not disconnect connector.",
                variant: "destructive",
            });
        } finally {
            setConnectorBusy(null);
        }
    }, [effectiveUserId, fetchConnectors, toast]);

    const refreshChannels = useCallback(async (signal?: AbortSignal) => {
        if (!agentWallet) return;
        setLoadingChannels(true);
        try {
            const entries = await Promise.all(CHANNELS_LIST.map(async (channel) => [
                channel,
                await sdk.channels.status(channel, { userAddress: effectiveUserId, agentWallet }, { signal }),
            ] as const));
            if (signal?.aborted) return;
            setChannelStatuses(Object.fromEntries(entries) as StatusMap);
        } catch (err) {
            if (signal?.aborted) return;
            console.warn("[Backpack] Could not refresh channels:", err);
        } finally {
            if (!signal?.aborted) setLoadingChannels(false);
        }
    }, [agentWallet, effectiveUserId]);

    const pollChannel = useCallback((channel: ChannelName) => {
        if (!agentWallet) return;
        const wallet = agentWallet;
        if (channelsPollRef.current) clearInterval(channelsPollRef.current);
        if (channelsAbortRef.current) channelsAbortRef.current.abort();

        const controller = new AbortController();
        channelsAbortRef.current = controller;
        let attempts = 0;
        const tick = async () => {
            attempts += 1;
            try {
                const status = await sdk.channels.status(channel, { userAddress: effectiveUserId, agentWallet: wallet }, { signal: controller.signal });
                if (controller.signal.aborted) return;
                setChannelStatuses((current) => ({ ...current, [channel]: status }));
                if (status.connected || attempts >= 40) {
                    if (channelsPollRef.current) clearInterval(channelsPollRef.current);
                    channelsPollRef.current = null;
                    setBusyChannel(null);
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    console.warn("[Backpack] status poll failed", error);
                }
            }
        };
        void tick();
        channelsPollRef.current = setInterval(() => void tick(), 3000);
    }, [agentWallet, effectiveUserId]);

    const openAction = useCallback((link: ChannelLinkResponse) => {
        const url = actionUrl(link);
        if (!url) return;
        window.open(url, "_blank", "noopener,noreferrer");
    }, []);

    const startWhatsAppChannel = useCallback((link: ChannelLinkResponse) => {
        const socket = link.action?.socket;
        if (!socket) {
            openAction(link);
            pollChannel("whatsapp");
            return;
        }
        if (channelsWsRef.current) {
            channelsWsRef.current.close();
        }
        setWhatsappChannelState({ socket, loading: true, phone: "" });
        const ws = new WebSocket(socket);
        channelsWsRef.current = ws;
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(String(event.data)) as Record<string, unknown>;
                if (message.type === "qr" && typeof message.qr === "string") {
                    setWhatsappChannelState((current) => current ? { ...current, qr: message.qr as string, loading: false } : current);
                }
                if (message.type === "pairing_code" && typeof message.code === "string") {
                    setWhatsappChannelState((current) => current ? { ...current, pairing: message.code as string, loading: false } : current);
                }
                if (message.type === "pairing_code_pending") {
                    setWhatsappChannelState((current) => current ? { ...current, qr: undefined, pairing: undefined, loading: true } : current);
                }
                if (message.type === "connected" || message.type === "already_connected") {
                    setWhatsappChannelState(null);
                    setBusyChannel(null);
                    void refreshChannels();
                    toast({ title: "WhatsApp connected", description: "Channel route is ready." });
                }
                if (message.type === "error") {
                    setWhatsappChannelState((current) => current ? { ...current, loading: false } : current);
                    toast({
                        title: "WhatsApp failed",
                        description: typeof message.message === "string" ? message.message : "Unable to link WhatsApp.",
                        variant: "destructive",
                    });
                }
            } catch {
                // Ignore malformed provider frames.
            }
        };
        ws.onerror = () => {
            setWhatsappChannelState((current) => current ? { ...current, loading: false } : current);
            toast({ title: "WhatsApp socket failed", description: "Unable to reach the channel service.", variant: "destructive" });
        };
        ws.onclose = () => {
            channelsWsRef.current = null;
        };
        pollChannel("whatsapp");
    }, [openAction, pollChannel, refreshChannels, toast]);

    const connectChannel = useCallback(async (
        channel: ChannelName,
        mode?: "user" | "guild",
        privacy?: "public" | "private"
    ) => {
        if (!agentWallet) return;
        setBusyChannel(channel);
        try {
            const link = await sdk.channels.link(channel, {
                userAddress: effectiveUserId,
                agentWallet,
                agentName: agentLabel,
                ...(mode ? { mode } : {}),
                ...(privacy ? { privacy } : {}),
            });
            if (channel === "whatsapp") {
                startWhatsAppChannel(link);
                return;
            }
            openAction(link);
            pollChannel(channel);
            toast({ title: `${CHANNEL_META[channel].label} link opened`, description: "Complete the provider flow to bind this agent." });
        } catch (error) {
            setBusyChannel(null);
            toast({
                title: "Channel link failed",
                description: error instanceof Error ? error.message : "Unable to create channel link.",
                variant: "destructive",
            });
        }
    }, [agentLabel, agentWallet, effectiveUserId, openAction, pollChannel, startWhatsAppChannel, toast]);

    const disconnectChannel = useCallback(async (route: ChannelRoute) => {
        if (!agentWallet) return;
        setDisconnectingChannel(route.id);
        try {
            await sdk.channels.disconnect(route.channel, {
                userAddress: effectiveUserId,
                agentWallet,
                accountId: route.accountId,
                threadId: route.threadId,
            });
            await refreshChannels();
            toast({ title: "Channel disconnected", description: `${CHANNEL_META[route.channel].label} route removed.` });
        } catch (error) {
            toast({
                title: "Disconnect failed",
                description: error instanceof Error ? error.message : "Unable to disconnect channel.",
                variant: "destructive",
            });
        } finally {
            setDisconnectingChannel(null);
        }
    }, [agentWallet, effectiveUserId, refreshChannels, toast]);

    const disconnectAllRoutes = useCallback(async (channel: ChannelName, routes: ChannelRoute[]) => {
        if (!agentWallet) return;
        setBusyChannel(channel);
        try {
            await Promise.all(routes.map(route =>
                sdk.channels.disconnect(channel, {
                    userAddress: effectiveUserId,
                    agentWallet,
                    accountId: route.accountId,
                    threadId: route.threadId,
                })
            ));
            await refreshChannels();
            toast({ title: `${CHANNEL_META[channel].label} disconnected`, description: "All routes removed." });
        } catch (error) {
            toast({
                title: "Disconnect failed",
                description: error instanceof Error ? error.message : "Unable to disconnect channel.",
                variant: "destructive",
            });
        } finally {
            setBusyChannel(null);
        }
    }, [agentWallet, effectiveUserId, refreshChannels, toast]);

    const pairWhatsAppChannel = useCallback(() => {
        const phone = whatsappChannelState?.phone.replace(/[^0-9]/gu, "") || "";
        if (phone.length < 10 || channelsWsRef.current?.readyState !== WebSocket.OPEN) return;
        channelsWsRef.current.send(JSON.stringify({ type: "pair_phone", phone }));
        setWhatsappChannelState((current) => current ? { ...current, loading: true, pairing: undefined } : current);
    }, [whatsappChannelState]);

    const fetchPermissions = useCallback(async () => {
        try {
            if (!agentWallet) return;
            const granted = await fetchBackpackPermissions(effectiveUserId, agentWallet);
            const grantedSet = new Set(granted);
            setPermissions(() => Object.fromEntries(
                PERMISSION_TYPES.map((permission) => [permission.type, grantedSet.has(permission.type as BackpackCloudPermission)]),
            ));
        } catch (err) {
            console.warn("[Backpack] Could not fetch permissions:", err);
        }
    }, [agentWallet, effectiveUserId]);

    useEffect(() => {
        if (handleOpen && activeTab === "permissions") {
            void fetchPermissions();
        }
    }, [activeTab, fetchPermissions, handleOpen]);

    // Fetch channel statuses when channels tab is opened
    useEffect(() => {
        if (handleOpen && activeTab === "channels") {
            void refreshChannels();
        } else {
            cleanupChannels();
        }
    }, [handleOpen, activeTab, refreshChannels, cleanupChannels]);

    // Fetch connections when the accounts tab is opened
    useEffect(() => {
        if (handleOpen && activeTab === "accounts") {
            fetchConnections();
        }
    }, [handleOpen, activeTab, fetchConnections]);

    // Fetch gated connectors when the connectors tab is opened
    useEffect(() => {
        if (handleOpen && activeTab === "connectors") {
            void fetchConnectors();
            void fetchGatedCatalog();
        }
    }, [handleOpen, activeTab, fetchConnectors, fetchGatedCatalog]);

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
            const data = await sdk.accounts.toolkits.list({ search: query, limit: 15 }, { signal: controller.signal });
            setSearchResults(data.toolkits || []);
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
            if (!agentWallet) {
                throw new Error("Open an agent page to manage per-agent browser permissions.");
            }
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
                await grantBackpackPermission(effectiveUserId, agentWallet, type as BackpackCloudPermission);
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
    }, [agentWallet, effectiveUserId, toast]);

    const revokePermission = useCallback(async (type: string) => {
        try {
            if (!agentWallet) {
                throw new Error("Open an agent page to manage per-agent browser permissions.");
            }
            await revokeBackpackCloudPermission(effectiveUserId, agentWallet, type as BackpackCloudPermission);
            setPermissions(prev => ({ ...prev, [type]: false }));
            toast({ title: "Permission Revoked", description: `${type} access disabled.` });
        } catch (err) {
            toast({
                title: "Revoke Failed",
                description: err instanceof Error ? err.message : `Could not revoke ${type} access.`,
                variant: "destructive",
            });
        }
    }, [agentWallet, effectiveUserId, toast]);

    // ==========================================================================
    // OAuth Handlers — Composio Credential Broker
    // ==========================================================================

    const connectAccount = useCallback(async (provider: ProviderDisplay) => {
        setLoadingAccount(provider.slug);
        clearStatusPolling();

        try {
            if (!agentWallet) {
                throw new Error("Open an agent page to connect accounts for that agent.");
            }
            const data = await sdk.accounts.connect({
                userAddress: effectiveUserId,
                agentWallet,
                toolkit: provider.slug,
            });
            const redirectUrl = data.redirectUrl;

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
                const statusData = await sdk.accounts.status({
                    userAddress: effectiveUserId,
                    agentWallet,
                    toolkit: provider.slug,
                    connectedAccountId: data.connectedAccountId,
                }, { signal });
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
                        connectedAccountId: statusData.connectedAccountId,
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
    }, [agentWallet, clearStatusPolling, effectiveUserId, startStatusPolling, toast]);

    // ==========================================================================
    // Channel-Based Connection (Telegram)
    // ==========================================================================

    const connectTelegram = useCallback(async () => {
        setLoadingAccount("telegram");
        clearStatusPolling();

        try {
            if (!agentWallet) {
                throw new Error("Open an agent page to bind Telegram for that agent.");
            }
            const link = await sdk.channels.link("telegram", { userAddress: effectiveUserId, agentWallet });
            const deepLinkUrl = link.action?.url || link.url;
            if (!deepLinkUrl) {
                throw new Error("No Telegram link returned from server.");
            }

            // Open Telegram deep link
            window.open(deepLinkUrl, "_blank");

            toast({
                title: "Open Telegram",
                description: 'Tap "Start" in Telegram to connect your account.',
            });

            startStatusPolling(async (signal) => {
                const statusData = await sdk.channels.status("telegram", { userAddress: effectiveUserId, agentWallet }, { signal });
                if (!statusData.connected) {
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
    }, [agentWallet, clearStatusPolling, effectiveUserId, startStatusPolling, toast]);

    // ==========================================================================
    // Channel-Based Connection (WhatsApp via Baileys WebSocket)
    // ==========================================================================

    const connectWhatsApp = useCallback(async () => {
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

        let wsUrl: string | undefined;
        try {
            if (!agentWallet) {
                throw new Error("Open an agent page to bind WhatsApp for that agent.");
            }
            const link = await sdk.channels.link("whatsapp", { userAddress: effectiveUserId, agentWallet });
            wsUrl = link.action?.socket;
            if (!wsUrl) {
                throw new Error("No WhatsApp pairing socket returned from server.");
            }
        } catch (error) {
            toast({
                title: "Connection Failed",
                description: error instanceof Error ? error.message : "Could not connect WhatsApp.",
                variant: "destructive",
            });
            setWhatsappScreen(null);
            setWhatsappQrLoading(false);
            setLoadingAccount(null);
            return;
        }
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
    }, [agentWallet, clearStatusPolling, effectiveUserId, toast]);

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
            if (!agentWallet) {
                throw new Error("Open an agent page to disconnect accounts for that agent.");
            }
            const connection = connections[provider.slug];
            const connectedAccountId = connection?.connectedAccountId || connection?.accountId;
            if (!connectedAccountId) {
                throw new Error("Connected account id is missing.");
            }
            await sdk.accounts.disconnect({
                userAddress: effectiveUserId,
                agentWallet,
                toolkit: provider.slug,
                connectedAccountId,
            });

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
    }, [agentWallet, connections, effectiveUserId, toast]);

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
    const connectedChannelsCount = Object.values(channelStatuses).filter(status => (status?.routes || []).length > 0).length;
    const connectedAccountsCount = Object.values(connections).filter(c => c.connected).length;
    const connectedConnectorsCount = connectorRows.filter(c => c.connected).length;

    // Provider card renderer — shared between featured and search results
    const renderProviderCard = (provider: ProviderDisplay) => {
        const connection = connections[provider.slug];
        const isConnected = connection?.connected ?? false;
        const isLoading = loadingAccount === provider.slug;
        const isDisabled = provider.connectionType === "disabled";
        const isChannel = provider.connectionType === "channel";

        return (
            <Fragment key={provider.slug}>
                <div className={`cm-setting-row ${isDisabled ? "opacity-60" : ""}`}>
                    <div
                        className="cm-setting-row__icon overflow-hidden"
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
                    <div className="cm-setting-row__copy">
                        <div className="cm-setting-row__label truncate flex items-center gap-1.5">
                            {provider.name}
                            {provider.badge && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 border-primary/20 text-muted-foreground font-normal">
                                    {provider.badge}
                                </Badge>
                            )}
                            {isConnected && (
                                <Check className="w-3.5 h-3.5 text-green-400 sm:hidden shrink-0" />
                            )}
                        </div>
                        <div className="cm-setting-row__description truncate hidden sm:block">
                            {isConnected ? (
                                <span className="flex items-center gap-1 text-green-400">
                                    <Check className="w-3 h-3" /> Connected
                                </span>
                            ) : (
                                provider.description
                            )}
                        </div>
                    </div>

                    <div className="cm-setting-row__control">
                        {isDisabled ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled
                                className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                            >
                                <MessageCircle className="w-4 h-4" />
                                <span className="hidden sm:inline ml-1 text-xs">Soon</span>
                            </Button>
                        ) : (
                            <Button
                                variant={isConnected ? "destructive" : "outline"}
                                size="sm"
                                disabled={isLoading}
                                className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
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
                                        <Unplug className="w-4 h-4" />
                                        <span className="hidden sm:inline ml-1 text-xs">Disconnect</span>
                                    </>
                                ) : isChannel && provider.slug === "whatsapp" ? (
                                    <>
                                        <QrCode className="w-4 h-4" />
                                        <span className="hidden sm:inline ml-1 text-xs">Scan QR</span>
                                    </>
                                ) : isChannel ? (
                                    <>
                                        <Send className="w-4 h-4" />
                                        <span className="hidden sm:inline ml-1 text-xs">Link Bot</span>
                                    </>
                                ) : (
                                    <>
                                        <ExternalLink className="w-4 h-4" />
                                        <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
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

            <DialogContent className="sm:max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
                <DialogHeader className="flex-shrink-0">
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
                    <div className="flex-1 flex flex-col gap-4 py-2 min-h-0 overflow-y-auto">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="self-start gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
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
                                <h3 className="text-base font-semibold text-foreground">Connect WhatsApp</h3>
                                <p className="text-xs text-muted-foreground">
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
                                        <div className="text-sm text-foreground text-center">
                                            Enter this code in WhatsApp to link:
                                        </div>
                                        <div className="font-mono text-3xl font-bold tracking-[0.3em] text-green-400 bg-background/80 px-6 py-4 rounded-xl border border-green-500/30">
                                            {whatsappPairingCode}
                                        </div>
                                        <p className="text-xs text-muted-foreground text-center">
                                            WhatsApp → Linked Devices → Link a Device
                                        </p>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Waiting for pairing...
                                        </div>
                                    </div>
                                ) : whatsappQrLoading ? (
                                    <div className="flex flex-col items-center gap-3 py-8">
                                        <Loader2 className="w-10 h-10 animate-spin text-green-500" />
                                        <span className="text-sm text-muted-foreground">Generating pairing code...</span>
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
                                        <p className="text-xs text-muted-foreground text-center leading-relaxed">
                                            Enter your full number with country code (no + or spaces).
                                            It's only used to generate a one-time linking code.
                                            Compose never stores or shares your data.
                                        </p>
                                        <input
                                            type="tel"
                                            placeholder="e.g. 14155551234"
                                            value={whatsappPhoneInput}
                                            onChange={(e) => setWhatsappPhoneInput(e.target.value)}
                                            className="w-full px-4 py-2.5 rounded-lg bg-background/70 border border-primary/20 text-foreground text-center font-mono text-lg placeholder:text-muted-foreground/60 focus:outline-none focus:border-green-500 transition-colors"
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
                                            <span className="text-sm text-muted-foreground">Generating QR code...</span>
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
                                                <div className="flex items-center gap-2 text-sm text-foreground">
                                                    <Smartphone className="w-4 h-4 text-green-400" />
                                                    Scan with WhatsApp
                                                </div>
                                                <p className="text-xs text-muted-foreground text-center">
                                                    Open WhatsApp → Settings → Linked Devices → Link a Device
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                Waiting for scan...
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-muted-foreground py-4">
                                            QR code not available. Please try again.
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ) : (
                    <>

                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                            <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
                                <TabsTrigger value="permissions" className="gap-2">
                                    <Shield className="w-4 h-4" />
                                    Permissions
                                    {grantedPermissionsCount > 0 && (
                                        <Badge variant="secondary" className="ml-1 text-xs px-1.5">
                                            {grantedPermissionsCount}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="channels" className="gap-2">
                                    <RadioTower className="w-4 h-4" />
                                    Channels
                                    {connectedChannelsCount > 0 && (
                                        <Badge variant="secondary" className="ml-1 text-xs px-1.5">
                                            {connectedChannelsCount}
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
                                <TabsTrigger value="connectors" className="gap-2">
                                    <KeyRound className="w-4 h-4" />
                                    Connectors
                                    {connectedConnectorsCount > 0 && (
                                        <Badge variant="secondary" className="ml-1 text-xs px-1.5">
                                            {connectedConnectorsCount}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                            </TabsList>

                            {/* Permissions Tab */}
                            <TabsContent value="permissions" className="mt-4 space-y-3 flex-1 overflow-y-auto pr-1">
                                {PERMISSION_TYPES.map(perm => (
                                    <div key={perm.type} className="cm-setting-row">
                                        <div className="cm-setting-row__icon">
                                            {perm.icon}
                                        </div>
                                        <div className="cm-setting-row__copy">
                                            <div className="cm-setting-row__label">{perm.label}</div>
                                            <div className="cm-setting-row__description hidden sm:block">{perm.description}</div>
                                        </div>

                                        <div className="cm-setting-row__control">
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
                                    </div>
                                ))}
                            </TabsContent>

                            {/* Channels Tab */}
                            <TabsContent value="channels" className="mt-4 flex flex-col flex-1 min-h-0 overflow-hidden">
                                {loadingChannels && Object.keys(channelStatuses).length === 0 ? (
                                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm flex-1">
                                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                        Loading channels...
                                    </div>
                                ) : (
                                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
                                        {CHANNELS_LIST.map((channel) => {
                                            const info = CHANNEL_META[channel];
                                            const linked = channelStatuses[channel]?.routes || [];
                                            const connecting = busyChannel === channel;
                                            const isConnected = linked.length > 0;

                                            return (
                                                <div key={channel} className="space-y-2.5">
                                                    <div className="cm-setting-row">
                                                        <div
                                                            className="cm-setting-row__icon overflow-hidden flex items-center justify-center"
                                                            style={{ backgroundColor: `${info.color}15` }}
                                                        >
                                                            <img
                                                                src={info.logo}
                                                                alt={info.label}
                                                                className="w-6 h-6 object-contain"
                                                                onError={(e) => {
                                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="cm-setting-row__copy">
                                                            <div className="cm-setting-row__label flex items-center gap-1.5">
                                                                {info.label}
                                                                {isConnected && (
                                                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 border-primary/20 text-muted-foreground font-normal">
                                                                        {linked.length} {linked.length === 1 ? "route" : "routes"}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <div className="cm-setting-row__description hidden sm:block">
                                                                {isConnected ? (
                                                                    <span className="flex items-center gap-1 text-green-400">
                                                                        <Check className="w-3 h-3" /> {routeLabel(linked[0])} {linked.length > 1 ? `(+${linked.length - 1} more)` : ""}
                                                                    </span>
                                                                ) : (
                                                                    info.description
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="cm-setting-row__control">
                                                            {connecting ? (
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    disabled
                                                                    className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                                >
                                                                    <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                                                                </Button>
                                                            ) : isConnected ? (
                                                                <Button
                                                                    variant="destructive"
                                                                    size="sm"
                                                                    className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                                    onClick={() => disconnectAllRoutes(channel, linked)}
                                                                >
                                                                    <Unplug className="w-4 h-4" />
                                                                    <span className="hidden sm:inline ml-1 text-xs">Disconnect</span>
                                                                </Button>
                                                            ) : channel === "telegram" ? (
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                                    onClick={() => connectChannel("telegram")}
                                                                >
                                                                    <Send className="w-4 h-4" />
                                                                    <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                                                </Button>
                                                            ) : channel === "whatsapp" ? (
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                                    onClick={() => connectChannel("whatsapp")}
                                                                >
                                                                    <QrCode className="w-4 h-4" />
                                                                    <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                                                </Button>
                                                            ) : (
                                                                <Select value="" onValueChange={(val) => {
                                                                    const [mode, privacy] = val.split(":");
                                                                    void connectChannel(channel, mode as any, privacy as any);
                                                                }}>
                                                                    <SelectTrigger className="h-8 text-xs shrink-0 w-8 sm:w-24 p-0 sm:px-2.5">
                                                                        <SelectValue placeholder="Connect" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="user">DM</SelectItem>
                                                                        <SelectItem value="guild:public">Public {channel === "discord" ? "Server" : "Workspace"}</SelectItem>
                                                                        <SelectItem value="guild:private">Private {channel === "discord" ? "Server" : "Workspace"}</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {/* WhatsApp Pairing Screen inline/nested at the bottom if active */}
                                        {whatsappChannelState && (
                                            <div className="p-3 bg-muted/40 rounded-lg border border-primary/10 space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
                                                        <QrCode className="w-4 h-4 text-green-400" />
                                                        WhatsApp Pairing
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            if (channelsWsRef.current) {
                                                                channelsWsRef.current.close();
                                                            }
                                                            setWhatsappChannelState(null);
                                                        }}
                                                        className="h-6 w-6 p-0 hover:bg-muted"
                                                    >
                                                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                                                    </Button>
                                                </div>

                                                {whatsappChannelState.loading && (
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 justify-center">
                                                        <Loader2 className="w-4 h-4 animate-spin text-green-400" />
                                                        Waiting for WhatsApp...
                                                    </div>
                                                )}

                                                {whatsappChannelState.qr && (
                                                    <div className="mx-auto w-full max-w-[200px] rounded-lg bg-white p-2.5 border border-primary/15">
                                                        <img
                                                            alt="Scan with WhatsApp"
                                                            className="aspect-square w-full object-contain"
                                                            src={whatsappChannelState.qr.startsWith("data:") ? whatsappChannelState.qr : `data:image/png;base64,${whatsappChannelState.qr}`}
                                                        />
                                                        <p className="text-[10px] text-muted-foreground text-center mt-1">Scan with WhatsApp link device</p>
                                                    </div>
                                                )}

                                                {whatsappChannelState.pairing && (
                                                    <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-3 text-center">
                                                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Pairing Code</div>
                                                        <div className="font-mono text-2xl font-bold tracking-[0.28em] text-green-400">
                                                            {whatsappChannelState.pairing}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="flex flex-col gap-1.5">
                                                    <span className="text-[10px] font-mono text-muted-foreground">Or Pair with Phone Number</span>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            type="tel"
                                                            value={whatsappChannelState.phone}
                                                            placeholder="14155551234"
                                                            onChange={(e) => setWhatsappChannelState((current) => current ? { ...current, phone: e.target.value } : current)}
                                                            className="h-8 text-xs bg-background/50"
                                                        />
                                                        <Button
                                                            size="sm"
                                                            onClick={pairWhatsAppChannel}
                                                            disabled={whatsappChannelState.phone.replace(/[^0-9]/gu, "").length < 10}
                                                            className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                                                        >
                                                            Pair
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </TabsContent>

                            {/* Connected Accounts Tab */}
                            <TabsContent value="accounts" className="mt-4 flex flex-col flex-1 min-h-0 overflow-hidden">
                                {/* Search + Refresh row */}
                                <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                        <input
                                            type="text"
                                            placeholder="Search 870+ integrations..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full h-8 pl-8 pr-8 text-sm bg-background/70 border border-primary/20 rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/20 transition-colors"
                                        />
                                        {searchQuery && (
                                            <button
                                                onClick={() => setSearchQuery("")}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                                        onClick={fetchConnections}
                                        disabled={refreshing}
                                    >
                                        <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                                        Refresh
                                    </Button>
                                </div>

                                {/* Scrollable search and popular integrations area */}
                                <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
                                    {/* Search results */}
                                    {searchQuery.trim() && (
                                        <div className="space-y-2">
                                            {searching && (
                                                <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                                    Searching...
                                                </div>
                                            )}
                                            {!searching && filteredSearchResults.length === 0 && searchResults.length === 0 && (
                                                <div className="text-center py-4 text-muted-foreground text-sm">
                                                    No integrations found for "{searchQuery}"
                                                </div>
                                            )}
                                            {filteredSearchResults.map(tk =>
                                                renderProviderCard(toolkitToProvider(tk))
                                            )}
                                            {filteredSearchResults.length > 0 && (
                                                <div className="border-t border-primary/15 my-3" />
                                            )}
                                        </div>
                                    )}

                                    {/* Featured Providers */}
                                    {(!searchQuery.trim() || filteredSearchResults.length > 0 || searchResults.some(sr => featuredSlugs.has(sr.slug))) && (
                                        <>
                                            {searchQuery.trim() && (
                                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                                    Popular
                                                </div>
                                            )}
                                            {FEATURED_PROVIDERS.map(provider =>
                                                renderProviderCard(provider)
                                            )}
                                        </>
                                    )}
                                </div>

                                <p className="text-xs text-muted-foreground text-center pt-4 flex-shrink-0">
                                    Compose Market never sees or stores your tokens.
                                </p>
                            </TabsContent>

                            {/* Credential-Gated Connectors Tab */}
                            <TabsContent value="connectors" className="mt-4 flex flex-col flex-1 min-h-0 overflow-hidden">
                                {connectPanel ? (
                                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="self-start gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
                                            onClick={() => {
                                                setConnectPanel(null);
                                                setConnectVars({});
                                                setConnectError(null);
                                            }}
                                        >
                                            <ArrowLeft className="w-4 h-4" />
                                            Back
                                        </Button>

                                        <div className="flex items-center gap-3">
                                            <div className="cm-setting-row__icon">
                                                <KeyRound className="w-5 h-5 text-fuchsia-400" />
                                            </div>
                                            <div>
                                                <h3 className="text-base font-semibold text-foreground">Connect {connectPanel.name}</h3>
                                                <p className="text-xs text-muted-foreground">
                                                    Credentials are encrypted at rest and only ever injected into the connector at execution time.
                                                </p>
                                            </div>
                                        </div>

                                        {connectPanel.credentials.length === 0 ? (
                                            <p className="text-sm text-muted-foreground py-4">
                                                This connector declares no credential variables.
                                            </p>
                                        ) : (
                                            <div className="space-y-3">
                                                {connectPanel.credentials.map((credential) => (
                                                    <div key={credential.varName} className="space-y-1">
                                                        <div className="flex items-center justify-between">
                                                            <label className="text-xs font-mono text-foreground">{credential.varName}</label>
                                                            {credential.obtainUrl && (
                                                                <a
                                                                    href={credential.obtainUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-xs text-fuchsia-400 hover:underline inline-flex items-center gap-1"
                                                                >
                                                                    Get key <ExternalLink className="w-3 h-3" />
                                                                </a>
                                                            )}
                                                        </div>
                                                        {credential.description && (
                                                            <p className="text-xs text-muted-foreground">{credential.description}</p>
                                                        )}
                                                        <Input
                                                            type="password"
                                                            autoComplete="off"
                                                            value={connectVars[credential.varName] || ""}
                                                            onChange={(e) => setConnectVars((current) => ({ ...current, [credential.varName]: e.target.value }))}
                                                            placeholder={credential.varName}
                                                            className="h-9 text-sm bg-background/70 font-mono"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {connectError && (
                                            <p className="text-xs text-destructive">{connectError}</p>
                                        )}

                                        <Button
                                            onClick={() => void submitConnectorConnect()}
                                            disabled={connectSubmitting || connectPanel.credentials.some((credential) => !(connectVars[credential.varName] || "").trim())}
                                            className="w-full"
                                        >
                                            {connectSubmitting ? (
                                                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                                            ) : (
                                                <KeyRound className="w-4 h-4 mr-1.5" />
                                            )}
                                            Connect
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        {/* Search + Refresh row */}
                                        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                                            <div className="relative flex-1">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                                <input
                                                    type="text"
                                                    placeholder="Search API-key connectors..."
                                                    value={connectorSearchQuery}
                                                    onChange={(e) => setConnectorSearchQuery(e.target.value)}
                                                    className="w-full h-8 pl-8 pr-8 text-sm bg-background/70 border border-primary/20 rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/20 transition-colors"
                                                />
                                                {connectorSearchQuery && (
                                                    <button
                                                        onClick={() => setConnectorSearchQuery("")}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                                                onClick={() => void fetchConnectors()}
                                                disabled={loadingConnectors}
                                            >
                                                <RefreshCw className={`w-3 h-3 mr-1 ${loadingConnectors ? "animate-spin" : ""}`} />
                                                Refresh
                                            </Button>
                                        </div>

                                        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
                                            {connectorSearchQuery.trim() && (
                                                <div className="space-y-2">
                                                    {searchingConnectors && (
                                                        <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                                                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                                            Searching...
                                                        </div>
                                                    )}
                                                    {!searchingConnectors && connectorSearchResults.length === 0 && !connectorRows.some((row) =>
                                                        row.name.toLowerCase().includes(connectorSearchQuery.trim().toLowerCase())
                                                        || row.slug.toLowerCase().includes(connectorSearchQuery.trim().toLowerCase())) && (
                                                        <div className="text-center py-4 text-muted-foreground text-sm">
                                                            No API-key connectors found for "{connectorSearchQuery}"
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {loadingConnectors && connectorRows.length === 0 && !connectorSearchQuery.trim() ? (
                                                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                                                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                                    Loading connectors...
                                                </div>
                                            ) : (
                                                <>
                                                    {connectorRows
                                                        .filter((row) => !connectorSearchQuery.trim()
                                                            || row.name.toLowerCase().includes(connectorSearchQuery.trim().toLowerCase())
                                                            || row.slug.toLowerCase().includes(connectorSearchQuery.trim().toLowerCase()))
                                                        .map((row) => (
                                                        <div key={row.slug} className="cm-setting-row">
                                                            <div className="cm-setting-row__icon">
                                                                <KeyRound className="w-4 h-4 text-fuchsia-400" />
                                                            </div>
                                                            <div className="cm-setting-row__copy">
                                                                <div className="cm-setting-row__label flex items-center gap-1.5">
                                                                    {row.name}
                                                                    {row.connected && (
                                                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 border-primary/20 text-green-400 font-normal">
                                                                            connected
                                                                        </Badge>
                                                                    )}
                                                                    {row.allowed && (
                                                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 border-primary/20 text-muted-foreground font-normal">
                                                                            granted
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="cm-setting-row__description truncate hidden sm:block">
                                                                    {row.connected
                                                                        ? `${row.actions?.length ? `${row.actions.length} actions` : "ready"}`
                                                                        : row.missingVars.length > 0
                                                                            ? `Missing: ${row.missingVars.map((v) => v.varName).join(", ")}`
                                                                            : "Not connected"}
                                                                </div>
                                                            </div>

                                                            <div className="cm-setting-row__control">
                                                                {connectorBusy === row.slug ? (
                                                                    <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                                                                ) : row.connected ? (
                                                                    <Button
                                                                        variant="destructive"
                                                                        size="sm"
                                                                        className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                                        onClick={() => void disconnectConnector(row)}
                                                                    >
                                                                        <Unplug className="w-4 h-4" />
                                                                        <span className="hidden sm:inline ml-1 text-xs">Disconnect</span>
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                                        onClick={() => void openConnectPanel(row.slug, row.name)}
                                                                    >
                                                                        <KeyRound className="w-4 h-4" />
                                                                        <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}

                                                    {(connectorSearchQuery.trim() ? connectorSearchResults : gatedCatalog)
                                                        .filter((entry) => !connectorRows.some((row) => row.slug === entry.slug))
                                                        .map((entry) => (
                                                            <div key={entry.slug} className="cm-setting-row">
                                                                <div className="cm-setting-row__icon">
                                                                    <KeyRound className="w-4 h-4 text-muted-foreground" />
                                                                </div>
                                                                <div className="cm-setting-row__copy">
                                                                    <div className="cm-setting-row__label">{entry.name}</div>
                                                                    <div className="cm-setting-row__description truncate hidden sm:block">
                                                                        {entry.description || entry.slug}
                                                                    </div>
                                                                </div>
                                                                <div className="cm-setting-row__control">
                                                                    {connectorBusy === entry.slug ? (
                                                                        <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                                                                    ) : (
                                                                        <Button
                                                                            variant="outline"
                                                                            size="sm"
                                                                            className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                                            onClick={() => void openConnectPanel(entry.slug, entry.name)}
                                                                        >
                                                                            <KeyRound className="w-4 h-4" />
                                                                            <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}

                                                    {connectorRows.length === 0 && gatedCatalog.length === 0 && !loadingConnectors && !connectorSearchQuery.trim() && (
                                                        <div className="text-center py-8 text-muted-foreground text-sm">
                                                            No credential-gated connectors available.
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>

                                        {connectError && (
                                            <p className="text-xs text-destructive pt-2 flex-shrink-0">{connectError}</p>
                                        )}

                                        <p className="text-xs text-muted-foreground text-center pt-4 flex-shrink-0">
                                            Keys are encrypted and injected blind at execution time — never shown again.
                                        </p>
                                    </>
                                )}
                            </TabsContent>
                        </Tabs>
                    </>)}
            </DialogContent>
        </Dialog>
    );
}

export default BackpackDialog;
