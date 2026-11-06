/**
 * Backpack Component
 *
 * User's personal permission, channel, account, and gated-connector manager.
 * All 4 tabs hydrate synchronously from owner-scoped snapshots + TanStack Query
 * and reuse the cached `useConnectorCatalogSnapshot` (0 ms open & reload paint).
 */

import { useState, useCallback, useEffect, useRef, useMemo, useDeferredValue, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useSession } from "@/hooks/use-session";
import { hasSessionAuth } from "@/lib/sdk";
import { safeHref } from "@/lib/performance/markdown";
import {
    BACKPACK_CLOUD_PERMISSION_TYPES,
    BACKPACK_GC_TIME,
    BACKPACK_STALE_TIME,
    backpackAccountsQueryKey,
    backpackChannelsQueryKey,
    backpackConnectorsQueryKey,
    backpackPermissionsQueryKey,
    fetchAllChannelStatuses,
    fetchBackpackAccountsMap,
    fetchBackpackConnectorRows,
    fetchPermissions as fetchCloudPermissions,
    getCachedPermissions,
    grantBackpackPermission,
    readBackpackAccountsCache,
    readBackpackChannelsCache,
    readBackpackConnectorsCache,
    revokeBackpackPermission as revokeBackpackCloudPermission,
    writeBackpackAccountsCache,
    writeBackpackChannelsCache,
    writeBackpackConnectorsCache,
    type BackpackChannelStatusMap,
    type BackpackCloudPermission,
    type BackpackConnectionInfo,
    type BackpackConnectorRow,
    type BackpackConnectorVarSpec,
} from "@/lib/backpack";
import { useConnectorCatalogSnapshot } from "@/hooks/use-registry";
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
    Send,
    QrCode,
    ArrowLeft,
    RadioTower,
    KeyRound,
} from "lucide-react";
import { sdk } from "@/lib/sdk";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { useAgentCatalog } from "@/hooks/use-agents";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type {
    ChannelLinkResponse,
    ChannelName,
    ChannelRoute,
    DirectoryAgent,
} from "@compose-market/sdk";

import {
    OPEN_BACKPACK_EVENT,
    type BackpackTab,
    type OpenBackpackDetail,
} from "@/components/layout/Layout";

export { OPEN_BACKPACK_EVENT, type BackpackTab, type OpenBackpackDetail };

export function openGlobalBackpack(detail: OpenBackpackDetail = {}): void {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent<OpenBackpackDetail>(OPEN_BACKPACK_EVENT, { detail }));
    }
}

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

interface ProviderDisplay {
    slug: string;
    name: string;
    logo: string;
    color: string;
    description: string;
    badge?: string;
}

interface ToolkitResult {
    slug: string;
    name: string;
    logo?: string;
    description?: string;
    categories?: string[];
    authMode?: "oauth" | "api_key" | "no_auth";
    noAuth?: boolean;
    toolsCount?: number;
}

interface ConnectorCatalogEntry {
    slug: string;
    name: string;
    description?: string;
}

type WhatsAppState = {
    socket: string;
    qr?: string;
    pairing?: string;
    loading: boolean;
    phone: string;
};

const CHANNELS_LIST = ["telegram", "whatsapp", "slack", "discord"] as const satisfies readonly ChannelName[];
const INITIAL_CATALOG_WINDOW = 60;
const CATALOG_WINDOW_STEP = 60;

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

const FEATURED_SLUGS = new Set(FEATURED_PROVIDERS.map((p) => p.slug));

// =============================================================================
// Component
// =============================================================================

interface BackpackDialogProps {
    userAddress?: string;
    agentWallet?: string;
    initialTab?: BackpackTab;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    showTrigger?: boolean;
    agentName?: string;
}

export function BackpackDialog({
    userAddress,
    agentWallet,
    initialTab,
    open,
    onOpenChange,
    showTrigger = true,
    agentName,
}: BackpackDialogProps) {
    const { toast } = useToast();
    const { keyToken, sessionActive } = useSession();
    const queryClient = useQueryClient();
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<string>(() => initialTab ?? (agentWallet ? "permissions" : "accounts"));
    const [selectedAgentWallet, setSelectedAgentWallet] = useState<string>(agentWallet || "");
    const [loadingPermission, setLoadingPermission] = useState<string | null>(null);
    const [loadingAccount, setLoadingAccount] = useState<string | null>(null);
    const [manualRefreshingAccounts, setManualRefreshingAccounts] = useState(false);
    const [manualRefreshingConnectors, setManualRefreshingConnectors] = useState(false);

    // Search & progressive windowing
    const [searchQuery, setSearchQuery] = useState("");
    const deferredAccountSearch = useDeferredValue(searchQuery);
    const [accountsWindow, setAccountsWindow] = useState(INITIAL_CATALOG_WINDOW);

    const [connectorSearchQuery, setConnectorSearchQuery] = useState("");
    const deferredConnectorSearch = useDeferredValue(connectorSearchQuery);
    const [connectorsWindow, setConnectorsWindow] = useState(INITIAL_CATALOG_WINDOW);

    const [busyChannel, setBusyChannel] = useState<ChannelName | null>(null);
    const [whatsappChannelState, setWhatsappChannelState] = useState<WhatsAppState | null>(null);
    const [connectorBusy, setConnectorBusy] = useState<string | null>(null);
    const [connectPanel, setConnectPanel] = useState<null | { slug: string; name: string; credentials: BackpackConnectorVarSpec[] }>(null);
    const [connectVars, setConnectVars] = useState<Record<string, string>>({});
    const [connectSubmitting, setConnectSubmitting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);

    const statusPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const statusPollAbortRef = useRef<AbortController | null>(null);
    const statusPollBusyRef = useRef(false);
    const channelsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const channelsAbortRef = useRef<AbortController | null>(null);
    const channelsWsRef = useRef<WebSocket | null>(null);

    const handleOpen = open !== undefined ? open : isOpen;
    const handleOpenChange = onOpenChange || setIsOpen;

    useEffect(() => {
        if (agentWallet) setSelectedAgentWallet(agentWallet);
    }, [agentWallet]);

    useEffect(() => {
        if (handleOpen && initialTab) setActiveTab(initialTab);
    }, [handleOpen, initialTab]);

    const { userAddress: selectedWalletAddress } = useSelectedUserAddress();
    const effectiveUserId = (userAddress || selectedWalletAddress || "").trim();

    // Agent list for per-agent tabs (already backed by synchronous agent snapshot)
    const { agents: catalogAgents } = useAgentCatalog({
        enabled: handleOpen && !agentWallet && (activeTab === "permissions" || activeTab === "channels"),
    });
    const manowarAgents = useMemo(
        () => catalogAgents.filter((card): card is DirectoryAgent & { walletAddress: string } =>
            typeof card.walletAddress === "string" && card.walletAddress.length > 0),
        [catalogAgents],
    );
    const effectiveAgentWallet = agentWallet || selectedAgentWallet || manowarAgents[0]?.walletAddress || undefined;
    const selectedCatalogAgent = useMemo(
        () => manowarAgents.find((card) => card.walletAddress === effectiveAgentWallet),
        [effectiveAgentWallet, manowarAgents],
    );
    const agentLabel = agentName
        || selectedCatalogAgent?.name
        || (effectiveAgentWallet ? `${effectiveAgentWallet.slice(0, 6)}...${effectiveAgentWallet.slice(-4)}` : "Agent");

    // Shared Connectors catalog snapshot (0 ms cached, eliminates /accounts?limit=200 and /mcps?limit=100)
    const catalogSnap = useConnectorCatalogSnapshot(
        handleOpen && (activeTab === "accounts" || activeTab === "connectors"),
    );

    const allConnectableToolkits = useMemo<ToolkitResult[]>(() => {
        if (!catalogSnap.hasData) return [];
        return catalogSnap.accountServers
            .filter((s) => !s.noAuth && s.authMode !== "no_auth")
            .map((s) => ({
                slug: s.slug,
                name: s.name,
                logo: s.logo,
                description: s.description,
                categories: s.tags,
                authMode: s.authMode,
                noAuth: s.noAuth,
                toolsCount: s.toolCount,
            }));
    }, [catalogSnap.accountServers, catalogSnap.hasData]);

    const accountsTotal = allConnectableToolkits.length || (catalogSnap.meta?.accountsServers ?? 0);

    const browseableCatalogToolkits = useMemo(
        () => allConnectableToolkits.filter((tk) => !FEATURED_SLUGS.has(tk.slug)),
        [allConnectableToolkits],
    );

    const gatedCatalog = useMemo<ConnectorCatalogEntry[]>(() => {
        if (!catalogSnap.hasData) return [];
        return catalogSnap.mcpServers
            .filter((s) => s.status === "credential_gated")
            .map((s) => ({
                slug: s.slug,
                name: s.name || s.slug,
                ...(s.description ? { description: s.description } : {}),
            }));
    }, [catalogSnap.hasData, catalogSnap.mcpServers]);

    // ==========================================================================
    // Cached Tab Queries (Owner Snapshots + TanStack Query)
    // ==========================================================================

    const accountsSnapshot = useMemo(() => readBackpackAccountsCache(effectiveUserId), [effectiveUserId]);
    const accountsQuery = useQuery<Record<string, BackpackConnectionInfo>, Error>({
        queryKey: backpackAccountsQueryKey(effectiveUserId),
        queryFn: ({ signal }) => fetchBackpackAccountsMap(effectiveUserId, { signal }),
        initialData: accountsSnapshot?.data,
        initialDataUpdatedAt: accountsSnapshot?.updatedAt,
        staleTime: BACKPACK_STALE_TIME,
        gcTime: BACKPACK_GC_TIME,
        enabled: handleOpen && Boolean(effectiveUserId) && activeTab === "accounts",
        retry: 1,
    });
    const connections = accountsQuery.data ?? accountsSnapshot?.data ?? {};

    const connectorsSnapshot = useMemo(() => readBackpackConnectorsCache(effectiveUserId), [effectiveUserId]);
    const connectorsQuery = useQuery<BackpackConnectorRow[], Error>({
        queryKey: backpackConnectorsQueryKey(effectiveUserId),
        queryFn: ({ signal }) => fetchBackpackConnectorRows(effectiveUserId, { signal }),
        initialData: connectorsSnapshot?.data,
        initialDataUpdatedAt: connectorsSnapshot?.updatedAt,
        staleTime: BACKPACK_STALE_TIME,
        gcTime: BACKPACK_GC_TIME,
        enabled: handleOpen && Boolean(effectiveUserId) && activeTab === "connectors",
        retry: 1,
    });
    const connectorRows = connectorsQuery.data ?? connectorsSnapshot?.data ?? [];

    const channelsSnapshot = useMemo(
        () => readBackpackChannelsCache(effectiveUserId, effectiveAgentWallet),
        [effectiveAgentWallet, effectiveUserId],
    );
    const channelsQuery = useQuery<BackpackChannelStatusMap, Error>({
        queryKey: backpackChannelsQueryKey(effectiveUserId, effectiveAgentWallet || ""),
        queryFn: ({ signal }) => fetchAllChannelStatuses(effectiveUserId, effectiveAgentWallet!, { signal }),
        initialData: channelsSnapshot?.data,
        initialDataUpdatedAt: channelsSnapshot?.updatedAt,
        staleTime: BACKPACK_STALE_TIME,
        gcTime: BACKPACK_GC_TIME,
        enabled: handleOpen && Boolean(effectiveUserId) && Boolean(effectiveAgentWallet) && activeTab === "channels",
        retry: 1,
    });
    const channelStatuses = channelsQuery.data ?? channelsSnapshot?.data ?? {};

    const cachedPermissionsList = useMemo(
        () => getCachedPermissions(effectiveAgentWallet, effectiveUserId),
        [effectiveAgentWallet, effectiveUserId],
    );
    const hasPermissionsAuth = Boolean(keyToken || sessionActive || hasSessionAuth(effectiveUserId));
    const permissionsQuery = useQuery<BackpackCloudPermission[], Error>({
        queryKey: backpackPermissionsQueryKey(effectiveUserId, effectiveAgentWallet || ""),
        queryFn: () => fetchCloudPermissions(effectiveUserId, effectiveAgentWallet!),
        initialData: cachedPermissionsList.length > 0 ? cachedPermissionsList : undefined,
        initialDataUpdatedAt: cachedPermissionsList.length > 0 ? Date.now() - BACKPACK_STALE_TIME : 0,
        staleTime: BACKPACK_STALE_TIME,
        gcTime: BACKPACK_GC_TIME,
        enabled: handleOpen && Boolean(effectiveUserId) && Boolean(effectiveAgentWallet) && activeTab === "permissions" && hasPermissionsAuth,
        retry: 1,
    });
    const permissions = useMemo<Record<string, boolean>>(() => {
        const granted = new Set(permissionsQuery.data ?? cachedPermissionsList);
        return Object.fromEntries(
            PERMISSION_TYPES.map((perm) => [perm.type, granted.has(perm.type as BackpackCloudPermission)]),
        );
    }, [cachedPermissionsList, permissionsQuery.data]);

    // ==========================================================================
    // Local 0 ms Search Filtering over Snapshot
    // ==========================================================================

    const trimmedAccountSearch = deferredAccountSearch.trim().toLowerCase();
    const filteredAccountMatches = useMemo(() => {
        if (!trimmedAccountSearch) return [];
        return allConnectableToolkits.filter((tk) => (
            tk.name.toLowerCase().includes(trimmedAccountSearch)
            || tk.slug.toLowerCase().includes(trimmedAccountSearch)
            || (tk.description || "").toLowerCase().includes(trimmedAccountSearch)
            || (tk.categories || []).some((cat) => cat.toLowerCase().includes(trimmedAccountSearch))
        )).slice(0, 60);
    }, [allConnectableToolkits, trimmedAccountSearch]);

    const filteredSearchResults = useMemo(
        () => filteredAccountMatches.filter((tk) => !FEATURED_SLUGS.has(tk.slug)),
        [filteredAccountMatches],
    );

    const trimmedConnectorSearch = deferredConnectorSearch.trim().toLowerCase();
    const filteredGatedCatalog = useMemo(() => {
        const rowSlugs = new Set(connectorRows.map((row) => row.slug));
        const base = gatedCatalog.filter((entry) => !rowSlugs.has(entry.slug));
        if (!trimmedConnectorSearch) return base;
        return base.filter((entry) => (
            entry.name.toLowerCase().includes(trimmedConnectorSearch)
            || entry.slug.toLowerCase().includes(trimmedConnectorSearch)
            || (entry.description || "").toLowerCase().includes(trimmedConnectorSearch)
        ));
    }, [connectorRows, gatedCatalog, trimmedConnectorSearch]);

    useEffect(() => {
        setAccountsWindow(INITIAL_CATALOG_WINDOW);
    }, [trimmedAccountSearch]);

    useEffect(() => {
        setConnectorsWindow(INITIAL_CATALOG_WINDOW);
    }, [trimmedConnectorSearch]);

    // ==========================================================================
    // Cleanup Helpers
    // ==========================================================================

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
        clearStatusPolling();
        cleanupChannels();
    }, [clearStatusPolling, cleanupChannels]);

    const resetTransientState = useCallback(() => {
        setLoadingAccount(null);
        setWhatsappChannelState(null);
        setBusyChannel(null);
        setConnectPanel(null);
        setConnectVars({});
        setConnectSubmitting(false);
        setConnectError(null);
        setConnectorSearchQuery("");
        setSearchQuery("");
    }, []);

    const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen) {
            cleanupAsyncWork();
            resetTransientState();
        }
        handleOpenChange(nextOpen);
    }, [cleanupAsyncWork, handleOpenChange, resetTransientState]);

    useEffect(() => {
        if (!handleOpen || activeTab !== "channels") {
            cleanupChannels();
        }
    }, [activeTab, cleanupChannels, handleOpen]);

    useEffect(() => () => cleanupAsyncWork(), [cleanupAsyncWork]);

    // ==========================================================================
    // Refresh & Mutation Handlers (Write-Through Cache)
    // ==========================================================================

    const refreshAccounts = useCallback(async () => {
        if (!effectiveUserId) return;
        setManualRefreshingAccounts(true);
        try {
            const fresh = await fetchBackpackAccountsMap(effectiveUserId, { refresh: true });
            queryClient.setQueryData(backpackAccountsQueryKey(effectiveUserId), fresh);
        } catch (err) {
            console.warn("[Backpack] Could not refresh connections:", err);
        } finally {
            setManualRefreshingAccounts(false);
        }
    }, [effectiveUserId, queryClient]);

    const refreshConnectors = useCallback(async () => {
        if (!effectiveUserId) return;
        setManualRefreshingConnectors(true);
        try {
            const fresh = await fetchBackpackConnectorRows(effectiveUserId, { refresh: true });
            queryClient.setQueryData(backpackConnectorsQueryKey(effectiveUserId), fresh);
        } catch (err) {
            console.warn("[Backpack] Could not refresh connectors:", err);
        } finally {
            setManualRefreshingConnectors(false);
        }
    }, [effectiveUserId, queryClient]);

    const refreshChannels = useCallback(async () => {
        if (!effectiveAgentWallet || !effectiveUserId) return;
        await channelsQuery.refetch();
    }, [channelsQuery, effectiveAgentWallet, effectiveUserId]);

    const openConnectPanel = useCallback(async (slug: string, name?: string) => {
        setConnectorBusy(slug);
        setConnectError(null);
        try {
            const card = await sdk.connectors.mcps.get(slug, { timeoutMs: 8000 });
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
        if (!connectPanel) return;
        setConnectSubmitting(true);
        setConnectError(null);
        try {
            if (!effectiveUserId) {
                throw new Error("Connect your wallet first to store connector credentials.");
            }
            const vars: Record<string, string> = {};
            for (const credential of connectPanel.credentials) {
                const value = (connectVars[credential.varName] || "").trim();
                if (!value) throw new Error(`${credential.varName} is required.`);
                vars[credential.varName] = value;
            }
            await sdk.connectors.gated.connect({
                userAddress: effectiveUserId,
                slug: connectPanel.slug,
                vars,
            });
            await sdk.connectors.gated.grant({
                userAddress: effectiveUserId,
                slug: connectPanel.slug,
            }).catch(() => undefined);
            toast({
                title: "Connector connected",
                description: `${connectPanel.name} credentials stored and granted for your agents.`,
            });
            setConnectPanel(null);
            setConnectVars({});
            await refreshConnectors();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Could not connect connector.";
            setConnectError(message);
            toast({ title: "Connector connect failed", description: message, variant: "destructive" });
        } finally {
            setConnectSubmitting(false);
        }
    }, [connectPanel, connectVars, effectiveUserId, refreshConnectors, toast]);

    const toggleConnectorGrant = useCallback(async (row: BackpackConnectorRow, nextAllowed: boolean) => {
        setConnectorBusy(row.slug);
        try {
            if (nextAllowed) {
                await sdk.connectors.gated.grant({ userAddress: effectiveUserId, slug: row.slug });
            } else {
                await sdk.connectors.gated.revoke({ userAddress: effectiveUserId, slug: row.slug });
            }
            const key = backpackConnectorsQueryKey(effectiveUserId);
            queryClient.setQueryData<BackpackConnectorRow[]>(key, (prev) => {
                const updated = (prev ?? connectorRows).map((item) => (
                    item.slug === row.slug ? { ...item, allowed: nextAllowed } : item
                ));
                writeBackpackConnectorsCache(effectiveUserId, updated);
                return updated;
            });
            toast({
                title: nextAllowed ? "Connector granted" : "Connector revoked",
                description: nextAllowed
                    ? `${row.name} is now enabled for your agents.`
                    : `${row.name} access paused for your agents.`,
            });
        } catch (err) {
            toast({
                title: "Update failed",
                description: err instanceof Error ? err.message : "Could not update connector allowance.",
                variant: "destructive",
            });
        } finally {
            setConnectorBusy(null);
        }
    }, [connectorRows, effectiveUserId, queryClient, toast]);

    const disconnectConnector = useCallback(async (row: BackpackConnectorRow) => {
        setConnectorBusy(row.slug);
        try {
            await sdk.connectors.gated.disconnect({ userAddress: effectiveUserId, slug: row.slug });
            const key = backpackConnectorsQueryKey(effectiveUserId);
            queryClient.setQueryData<BackpackConnectorRow[]>(key, (prev) => {
                const updated = (prev ?? connectorRows).filter((item) => item.slug !== row.slug);
                writeBackpackConnectorsCache(effectiveUserId, updated);
                return updated;
            });
            toast({ title: "Connector disconnected", description: `${row.name} credentials removed.` });
            await refreshConnectors();
        } catch (err) {
            toast({
                title: "Disconnect failed",
                description: err instanceof Error ? err.message : "Could not disconnect connector.",
                variant: "destructive",
            });
        } finally {
            setConnectorBusy(null);
        }
    }, [effectiveUserId, refreshConnectors, toast]);

    const pollChannel = useCallback((channel: ChannelName) => {
        if (!effectiveAgentWallet || !effectiveUserId) return;
        const wallet = effectiveAgentWallet;
        if (channelsPollRef.current) clearInterval(channelsPollRef.current);
        if (channelsAbortRef.current) channelsAbortRef.current.abort();

        const controller = new AbortController();
        channelsAbortRef.current = controller;
        let attempts = 0;
        const key = backpackChannelsQueryKey(effectiveUserId, wallet);
        const tick = async () => {
            attempts += 1;
            try {
                const status = await sdk.channels.status(
                    channel,
                    { userAddress: effectiveUserId, agentWallet: wallet },
                    { signal: controller.signal },
                );
                if (controller.signal.aborted) return;
                queryClient.setQueryData<BackpackChannelStatusMap>(key, (prev) => {
                    const next = { ...(prev ?? {}), [channel]: status };
                    writeBackpackChannelsCache(effectiveUserId, wallet, next);
                    return next;
                });
                if (status.connected || attempts >= 40) {
                    if (channelsPollRef.current) clearInterval(channelsPollRef.current);
                    channelsPollRef.current = null;
                    setBusyChannel(null);
                    if (status.connected) {
                        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
                    }
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    console.warn("[Backpack] status poll failed", error);
                }
            }
        };
        void tick();
        channelsPollRef.current = setInterval(() => void tick(), 3000);
    }, [effectiveAgentWallet, effectiveUserId, queryClient]);

    const openAction = useCallback((link: ChannelLinkResponse) => {
        const url = safeHref(actionUrl(link));
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
        if (channelsWsRef.current) channelsWsRef.current.close();
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
                    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
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
    }, [openAction, pollChannel, queryClient, refreshChannels, toast]);

    const connectChannel = useCallback(async (
        channel: ChannelName,
        mode?: "user" | "guild",
        privacy?: "public" | "private",
    ) => {
        if (!effectiveAgentWallet) return;
        setBusyChannel(channel);
        try {
            const link = await sdk.channels.link(channel, {
                userAddress: effectiveUserId,
                agentWallet: effectiveAgentWallet,
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
    }, [agentLabel, effectiveAgentWallet, effectiveUserId, openAction, pollChannel, startWhatsAppChannel, toast]);

    const disconnectAllRoutes = useCallback(async (channel: ChannelName, routes: ChannelRoute[]) => {
        if (!effectiveAgentWallet) return;
        setBusyChannel(channel);
        try {
            await Promise.all(routes.map((route) =>
                sdk.channels.disconnect(channel, {
                    userAddress: effectiveUserId,
                    agentWallet: effectiveAgentWallet,
                    accountId: route.accountId,
                    threadId: route.threadId,
                }),
            ));
            await refreshChannels();
            void queryClient.invalidateQueries({ queryKey: ["notifications"] });
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
    }, [effectiveAgentWallet, effectiveUserId, queryClient, refreshChannels, toast]);

    const pairWhatsAppChannel = useCallback(() => {
        const phone = whatsappChannelState?.phone.replace(/[^0-9]/gu, "") || "";
        if (phone.length < 10 || channelsWsRef.current?.readyState !== WebSocket.OPEN) return;
        channelsWsRef.current.send(JSON.stringify({ type: "pair_phone", phone }));
        setWhatsappChannelState((current) => current ? { ...current, loading: true, pairing: undefined } : current);
    }, [whatsappChannelState]);

    const startStatusPolling = useCallback((poll: (signal: AbortSignal) => Promise<boolean>) => {
        clearStatusPolling();
        const controller = new AbortController();
        statusPollAbortRef.current = controller;

        let attempts = 0;
        const runPoll = async () => {
            if (controller.signal.aborted || statusPollBusyRef.current) return;
            statusPollBusyRef.current = true;
            attempts += 1;
            try {
                const isComplete = await poll(controller.signal);
                if (isComplete || attempts >= 40) {
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

    const toolkitToProvider = useCallback((tk: ToolkitResult): ProviderDisplay => ({
        slug: tk.slug,
        name: tk.name,
        logo: tk.logo || `https://logos.composio.dev/api/${tk.slug}`,
        color: "#6366f1",
        description: tk.description?.substring(0, 60) || tk.categories?.join(", ") || "Connect account",
        badge: tk.authMode === "oauth" ? "OAuth" : tk.authMode === "api_key" ? "API Key" : undefined,
    }), []);

    // ==========================================================================
    // Permission Handlers
    // ==========================================================================

    const requestPermission = useCallback(async (type: string) => {
        setLoadingPermission(type);
        try {
            if (!effectiveAgentWallet) {
                throw new Error("Select an agent first to manage per-agent browser permissions.");
            }
            let granted = false;
            switch (type) {
                case "filesystem":
                    if ("showDirectoryPicker" in window) {
                        await (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker();
                        granted = true;
                    } else {
                        throw new Error("File System Access API not supported");
                    }
                    break;
                case "camera": {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    for (const track of stream.getTracks()) track.stop();
                    granted = true;
                    break;
                }
                case "microphone": {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    for (const track of stream.getTracks()) track.stop();
                    granted = true;
                    break;
                }
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
                case "notifications": {
                    const result = await Notification.requestPermission();
                    granted = result === "granted";
                    break;
                }
            }

            if (granted) {
                await grantBackpackPermission(effectiveUserId, effectiveAgentWallet, type as BackpackCloudPermission);
                const key = backpackPermissionsQueryKey(effectiveUserId, effectiveAgentWallet);
                queryClient.setQueryData<BackpackCloudPermission[]>(key, (prev) => {
                    const next = new Set(prev ?? cachedPermissionsList);
                    next.add(type as BackpackCloudPermission);
                    return [...next];
                });
                toast({ title: "Permission Granted", description: `${type} access enabled.` });
            }
        } catch (err) {
            toast({
                title: "Permission Denied",
                description: err instanceof Error ? err.message : `Could not get ${type} access.`,
                variant: "destructive",
            });
        } finally {
            setLoadingPermission(null);
        }
    }, [cachedPermissionsList, effectiveAgentWallet, effectiveUserId, queryClient, toast]);

    const revokePermission = useCallback(async (type: string) => {
        try {
            if (!effectiveAgentWallet) {
                throw new Error("Select an agent first to manage per-agent browser permissions.");
            }
            await revokeBackpackCloudPermission(effectiveUserId, effectiveAgentWallet, type as BackpackCloudPermission);
            const key = backpackPermissionsQueryKey(effectiveUserId, effectiveAgentWallet);
            queryClient.setQueryData<BackpackCloudPermission[]>(key, (prev) =>
                (prev ?? cachedPermissionsList).filter((item) => item !== type),
            );
            toast({ title: "Permission Revoked", description: `${type} access disabled.` });
        } catch (err) {
            toast({
                title: "Revoke Failed",
                description: err instanceof Error ? err.message : `Could not revoke ${type} access.`,
                variant: "destructive",
            });
        }
    }, [cachedPermissionsList, effectiveAgentWallet, effectiveUserId, queryClient, toast]);

    // ==========================================================================
    // OAuth Handlers — Composio Credential Broker
    // ==========================================================================

    const connectAccount = useCallback(async (provider: ProviderDisplay) => {
        setLoadingAccount(provider.slug);
        clearStatusPolling();

        try {
            if (!effectiveUserId) {
                throw new Error("Connect your wallet first to link accounts.");
            }
            const data = await sdk.connectors.accounts.connect({
                userAddress: effectiveUserId,
                toolkit: provider.slug,
            });
            const redirectUrl = safeHref(data.redirectUrl);
            if (!redirectUrl) throw new Error("No valid redirect URL returned from server");

            window.open(
                redirectUrl,
                `Connect ${provider.name}`,
                "noopener,noreferrer,width=600,height=700,scrollbars=yes",
            );

            toast({
                title: "Authentication Started",
                description: "Complete authentication in the popup, then click Refresh.",
            });

            startStatusPolling(async (signal) => {
                const statusData = await sdk.connectors.accounts.status({
                    userAddress: effectiveUserId,
                    toolkit: provider.slug,
                    connectedAccountId: data.connectedAccountId,
                }, { signal });
                if (!statusData.connected) return false;

                const key = backpackAccountsQueryKey(effectiveUserId);
                queryClient.setQueryData<Record<string, BackpackConnectionInfo>>(key, (prev) => {
                    const next: Record<string, BackpackConnectionInfo> = {
                        ...(prev ?? {}),
                        [provider.slug]: {
                            slug: provider.slug,
                            name: provider.name,
                            connected: true,
                            granted: true,
                            accountId: statusData.accountId,
                            connectedAccountId: statusData.connectedAccountId,
                        },
                    };
                    writeBackpackAccountsCache(effectiveUserId, next);
                    return next;
                });
                toast({
                    title: "Connected!",
                    description: `${provider.name} account connected and granted for your agents.`,
                });
                return true;
            });
        } catch (err) {
            console.error("[Backpack] Connection error:", err);
            toast({
                title: "Connection Failed",
                description: err instanceof Error ? err.message : "Could not connect account.",
                variant: "destructive",
            });
            setLoadingAccount(null);
        }
    }, [clearStatusPolling, effectiveUserId, queryClient, startStatusPolling, toast]);

    const toggleAccountGrant = useCallback(async (provider: ProviderDisplay, nextGranted: boolean) => {
        setLoadingAccount(provider.slug);
        try {
            if (nextGranted) {
                await sdk.connectors.accounts.grant({ userAddress: effectiveUserId, toolkit: provider.slug });
            } else {
                await sdk.connectors.accounts.revoke({ userAddress: effectiveUserId, toolkit: provider.slug });
            }
            const key = backpackAccountsQueryKey(effectiveUserId);
            queryClient.setQueryData<Record<string, BackpackConnectionInfo>>(key, (prev) => {
                const base = prev ?? connections;
                const next: Record<string, BackpackConnectionInfo> = {
                    ...base,
                    [provider.slug]: {
                        ...(base[provider.slug] || { slug: provider.slug, name: provider.name, connected: true }),
                        granted: nextGranted,
                    },
                };
                writeBackpackAccountsCache(effectiveUserId, next);
                return next;
            });
            toast({
                title: nextGranted ? "Account granted" : "Account paused",
                description: nextGranted
                    ? `${provider.name} is enabled for your agents.`
                    : `${provider.name} access paused for your agents.`,
            });
        } catch (err) {
            toast({
                title: "Update failed",
                description: err instanceof Error ? err.message : "Could not update account allowance.",
                variant: "destructive",
            });
        } finally {
            setLoadingAccount(null);
        }
    }, [connections, effectiveUserId, queryClient, toast]);

    const disconnectAccount = useCallback(async (provider: ProviderDisplay) => {
        setLoadingAccount(provider.slug);
        try {
            const connection = connections[provider.slug];
            const connectedAccountId = connection?.connectedAccountId || connection?.accountId;
            if (!connectedAccountId) throw new Error("Connected account id is missing.");

            await sdk.connectors.accounts.disconnect({
                userAddress: effectiveUserId,
                toolkit: provider.slug,
                connectedAccountId,
            });

            const key = backpackAccountsQueryKey(effectiveUserId);
            queryClient.setQueryData<Record<string, BackpackConnectionInfo>>(key, (prev) => {
                const base = prev ?? connections;
                const next: Record<string, BackpackConnectionInfo> = {
                    ...base,
                    [provider.slug]: {
                        ...base[provider.slug],
                        connected: false,
                        granted: false,
                        accountId: undefined,
                    },
                };
                writeBackpackAccountsCache(effectiveUserId, next);
                return next;
            });

            toast({
                title: "Disconnected",
                description: `${provider.name} account disconnected.`,
            });
        } catch (err) {
            console.error("[Backpack] Disconnect error:", err);
            toast({
                title: "Disconnect Failed",
                description: err instanceof Error ? err.message : "Could not disconnect account.",
                variant: "destructive",
            });
        } finally {
            setLoadingAccount(null);
        }
    }, [connections, effectiveUserId, queryClient, toast]);

    // ==========================================================================
    // Progressive Scroll Expanders
    // ==========================================================================

    const handleAccountsScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;
        if (accountsWindow >= browseableCatalogToolkits.length) return;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 420) {
            setAccountsWindow((prev) => Math.min(browseableCatalogToolkits.length, prev + CATALOG_WINDOW_STEP));
        }
    }, [accountsWindow, browseableCatalogToolkits.length]);

    const handleConnectorsScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;
        if (connectorsWindow >= filteredGatedCatalog.length) return;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 420) {
            setConnectorsWindow((prev) => Math.min(filteredGatedCatalog.length, prev + CATALOG_WINDOW_STEP));
        }
    }, [connectorsWindow, filteredGatedCatalog.length]);

    // ==========================================================================
    // Render
    // ==========================================================================

    const grantedPermissionsCount = Object.values(permissions).filter(Boolean).length;
    const connectedChannelsCount = Object.values(channelStatuses).filter((status) => (status?.routes || []).length > 0).length;
    const connectedAccountsCount = Object.values(connections).filter((c) => c.connected).length;
    const connectedConnectorsCount = connectorRows.filter((c) => c.connected).length;

    const refreshingAccounts = manualRefreshingAccounts || accountsQuery.isFetching;
    const loadingConnectors = manualRefreshingConnectors || connectorsQuery.isFetching;
    const loadingChannels = channelsQuery.isFetching;

    const renderAgentScopeBar = (scopeLabel: string) => {
        if (agentWallet) {
            return (
                <div className="flex items-center justify-between gap-2 rounded-md border border-primary/15 bg-background/50 px-3 py-2 mb-3 text-xs text-muted-foreground flex-shrink-0">
                    <span>{scopeLabel}</span>
                    <span className="font-mono text-foreground truncate max-w-56">{agentLabel}</span>
                </div>
            );
        }
        return (
            <div className="flex items-center justify-between gap-2 rounded-md border border-primary/15 bg-background/50 px-3 py-2 mb-3 flex-shrink-0">
                <span className="text-xs text-muted-foreground">{scopeLabel}</span>
                {manowarAgents.length > 0 ? (
                    <Select value={effectiveAgentWallet || ""} onValueChange={setSelectedAgentWallet}>
                        <SelectTrigger className="h-7 text-xs w-48 bg-background/70">
                            <SelectValue placeholder="Select agent" />
                        </SelectTrigger>
                        <SelectContent>
                            {manowarAgents.map((item) => (
                                <SelectItem key={item.walletAddress} value={item.walletAddress}>
                                    {item.name || short(item.walletAddress)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <span className="text-xs font-mono text-muted-foreground">No agents available</span>
                )}
            </div>
        );
    };

    const renderProviderCard = (provider: ProviderDisplay) => {
        const connection = connections[provider.slug];
        const isConnected = connection?.connected ?? false;
        const isGranted = connection?.granted ?? isConnected;
        const isLoading = loadingAccount === provider.slug;

        return (
            <Fragment key={provider.slug}>
                <div className="cm-setting-row snap-start">
                    <div
                        className="cm-setting-row__icon overflow-hidden"
                        style={{ backgroundColor: `${provider.color}15` }}
                    >
                        <img
                            src={provider.logo}
                            alt={provider.name}
                            loading="lazy"
                            decoding="async"
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                            }}
                        />
                    </div>
                    <div className="cm-setting-row__copy">
                        <div className="cm-setting-row__label truncate flex items-center gap-1.5">
                            {provider.name}
                            {provider.badge && (
                                <Badge variant="outline" className="text-xs px-1 py-0 border-primary/20 text-muted-foreground font-normal">
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
                                    <Check className="w-3 h-3" /> {isGranted ? "Connected · Granted to agents" : "Connected · Paused"}
                                </span>
                            ) : (
                                provider.description
                            )}
                        </div>
                    </div>

                    <div className="cm-setting-row__control flex items-center gap-2">
                        {isConnected && (
                            <Switch
                                checked={isGranted}
                                disabled={isLoading}
                                onCheckedChange={(checked) => void toggleAccountGrant(provider, checked)}
                                aria-label={`Allow agents to use ${provider.name}`}
                            />
                        )}
                        <Button
                            variant={isConnected ? "destructive" : "outline"}
                            size="sm"
                            disabled={isLoading}
                            aria-label={isConnected ? `Disconnect ${provider.name}` : `Connect ${provider.name}`}
                            className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                            onClick={() => {
                                if (isConnected) {
                                    void disconnectAccount(provider);
                                } else {
                                    void connectAccount(provider);
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
                            ) : (
                                <>
                                    <ExternalLink className="w-4 h-4" />
                                    <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                </>
                            )}
                        </Button>
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

            <DialogContent className="cm-dialog-panel sm:max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <Backpack className="w-5 h-5 text-fuchsia-400" />
                        Your Backpack
                    </DialogTitle>
                    <DialogDescription>
                        Manage permissions and connected accounts for AI agents.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
                        <TabsTrigger value="permissions" className="gap-1 px-1.5 text-xs min-w-0">
                            <Shield className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                            <span className="truncate">Access</span>
                            {grantedPermissionsCount > 0 && (
                                <Badge variant="secondary" className="text-[10px] leading-none px-1 py-0.5 shrink-0">
                                    {grantedPermissionsCount}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="channels" className="gap-1 px-1.5 text-xs min-w-0">
                            <RadioTower className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                            <span className="truncate">Channels</span>
                            {connectedChannelsCount > 0 && (
                                <Badge variant="secondary" className="text-[10px] leading-none px-1 py-0.5 shrink-0">
                                    {connectedChannelsCount}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="accounts" className="gap-1 px-1.5 text-xs min-w-0">
                            <Link2 className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                            <span className="truncate">Accounts</span>
                            {connectedAccountsCount > 0 && (
                                <Badge variant="secondary" className="text-[10px] leading-none px-1 py-0.5 shrink-0">
                                    {connectedAccountsCount}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="connectors" className="gap-1 px-1.5 text-xs min-w-0">
                            <KeyRound className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                            <span className="truncate">Connectors</span>
                            {connectedConnectorsCount > 0 && (
                                <Badge variant="secondary" className="text-[10px] leading-none px-1 py-0.5 shrink-0">
                                    {connectedConnectorsCount}
                                </Badge>
                            )}
                        </TabsTrigger>
                    </TabsList>

                    {/* Permissions Tab */}
                    <TabsContent value="permissions" className="mt-4 space-y-3 flex-1 overflow-y-auto overscroll-contain pr-1">
                        {renderAgentScopeBar("Per-agent browser permissions")}
                        {PERMISSION_TYPES.map((perm) => (
                            <div key={perm.type} className="cm-setting-row snap-start">
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
                                            disabled={!effectiveAgentWallet}
                                            onCheckedChange={(checked) => {
                                                if (checked) {
                                                    void requestPermission(perm.type);
                                                } else {
                                                    void revokePermission(perm.type);
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
                        {renderAgentScopeBar("Per-agent messaging channels")}
                        {loadingChannels && Object.keys(channelStatuses).length === 0 ? (
                            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm flex-1">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                Loading channels...
                            </div>
                        ) : (
                            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 space-y-3">
                                {CHANNELS_LIST.map((channel) => {
                                    const info = CHANNEL_META[channel];
                                    const linked = channelStatuses[channel]?.routes || [];
                                    const connecting = busyChannel === channel;
                                    const isConnected = linked.length > 0;

                                    return (
                                        <div key={channel} className="space-y-2.5 snap-start">
                                            <div className="cm-setting-row">
                                                <div
                                                    className="cm-setting-row__icon overflow-hidden flex items-center justify-center"
                                                    style={{ backgroundColor: `${info.color}15` }}
                                                >
                                                    <img
                                                        src={info.logo}
                                                        alt={info.label}
                                                        loading="lazy"
                                                        decoding="async"
                                                        className="w-6 h-6 object-contain"
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).style.display = "none";
                                                        }}
                                                    />
                                                </div>
                                                <div className="cm-setting-row__copy">
                                                    <div className="cm-setting-row__label flex items-center gap-1.5">
                                                        {info.label}
                                                        {isConnected && (
                                                            <Badge variant="secondary" className="text-xs px-1.5 py-0 border-primary/20 text-muted-foreground font-normal">
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
                                                            onClick={() => void disconnectAllRoutes(channel, linked)}
                                                        >
                                                            <Unplug className="w-4 h-4" />
                                                            <span className="hidden sm:inline ml-1 text-xs">Disconnect</span>
                                                        </Button>
                                                    ) : channel === "telegram" ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                            onClick={() => void connectChannel("telegram")}
                                                        >
                                                            <Send className="w-4 h-4" />
                                                            <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                                        </Button>
                                                    ) : channel === "whatsapp" ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                            onClick={() => void connectChannel("whatsapp")}
                                                        >
                                                            <QrCode className="w-4 h-4" />
                                                            <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                                        </Button>
                                                    ) : (
                                                        <Select value="" onValueChange={(val) => {
                                                            const [mode, privacy] = val.split(":");
                                                            void connectChannel(
                                                                channel,
                                                                mode as "user" | "guild" | undefined,
                                                                privacy as "public" | "private" | undefined,
                                                            );
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

                                {/* WhatsApp Pairing Screen */}
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
                                                    if (channelsWsRef.current) channelsWsRef.current.close();
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
                                            <div className="mx-auto w-full max-w-48 rounded-lg bg-white p-2.5 border border-primary/15">
                                                <img
                                                    alt="Scan with WhatsApp"
                                                    className="aspect-square w-full object-contain"
                                                    src={whatsappChannelState.qr.startsWith("data:") ? whatsappChannelState.qr : `data:image/png;base64,${whatsappChannelState.qr}`}
                                                />
                                                <p className="text-xs text-muted-foreground text-center mt-1">Scan with WhatsApp link device</p>
                                            </div>
                                        )}

                                        {whatsappChannelState.pairing && (
                                            <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-3 text-center">
                                                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Pairing Code</div>
                                                <div className="font-mono text-2xl font-bold tracking-[0.28em] text-green-400">
                                                    {whatsappChannelState.pairing}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-xs font-mono text-muted-foreground">Or Pair with Phone Number</span>
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
                        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                            <div className="relative flex-1">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder={`Search ${accountsTotal > 0 ? accountsTotal.toLocaleString() : "1,500+"} integrations...`}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full h-8 pl-8 pr-8 text-sm bg-background/70 border border-primary/20 rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/20 transition-colors"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
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
                                onClick={() => void refreshAccounts()}
                                disabled={refreshingAccounts}
                            >
                                <RefreshCw className={`w-3 h-3 mr-1 ${refreshingAccounts ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                        </div>

                        <div
                            onScroll={handleAccountsScroll}
                            className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 space-y-3"
                        >
                            {trimmedAccountSearch && (
                                <div className="space-y-2">
                                    {filteredSearchResults.length === 0 && filteredAccountMatches.length === 0 && !catalogSnap.isLoading && (
                                        <div className="text-center py-4 text-muted-foreground text-sm">
                                            No integrations found for "{searchQuery}"
                                        </div>
                                    )}
                                    {filteredSearchResults.map((tk) => renderProviderCard(toolkitToProvider(tk)))}
                                    {filteredSearchResults.length > 0 && (
                                        <div className="border-t border-primary/15 my-3" />
                                    )}
                                </div>
                            )}

                            {(!trimmedAccountSearch || filteredSearchResults.length > 0 || filteredAccountMatches.some((sr) => FEATURED_SLUGS.has(sr.slug))) && (
                                <>
                                    {trimmedAccountSearch && (
                                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                            Popular
                                        </div>
                                    )}
                                    {FEATURED_PROVIDERS.filter((provider) => (
                                        !trimmedAccountSearch
                                        || provider.name.toLowerCase().includes(trimmedAccountSearch)
                                        || provider.slug.toLowerCase().includes(trimmedAccountSearch)
                                        || provider.description.toLowerCase().includes(trimmedAccountSearch)
                                    )).map((provider) => renderProviderCard(provider))}
                                </>
                            )}

                            {!trimmedAccountSearch && browseableCatalogToolkits.length > 0 && (
                                <>
                                    <div className="border-t border-primary/15 pt-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        All Integrations ({accountsTotal > 0 ? accountsTotal.toLocaleString() : browseableCatalogToolkits.length})
                                    </div>
                                    {browseableCatalogToolkits.slice(0, accountsWindow).map((tk) =>
                                        renderProviderCard(toolkitToProvider(tk)),
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
                                                    {(() => {
                                                        const obtainHref = safeHref(credential.obtainUrl);
                                                        return obtainHref ? (
                                                            <a
                                                                href={obtainHref}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-xs text-fuchsia-400 hover:underline inline-flex items-center gap-1"
                                                            >
                                                                Get key <ExternalLink className="w-3 h-3" />
                                                            </a>
                                                        ) : null;
                                                    })()}
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
                                                type="button"
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
                                        onClick={() => void refreshConnectors()}
                                        disabled={loadingConnectors}
                                    >
                                        <RefreshCw className={`w-3 h-3 mr-1 ${loadingConnectors ? "animate-spin" : ""}`} />
                                        Refresh
                                    </Button>
                                </div>

                                <div
                                    onScroll={handleConnectorsScroll}
                                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 space-y-3"
                                >
                                    {loadingConnectors && connectorRows.length === 0 && gatedCatalog.length === 0 && !trimmedConnectorSearch ? (
                                        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                            Loading connectors...
                                        </div>
                                    ) : (
                                        <>
                                            {connectorRows
                                                .filter((row) => !trimmedConnectorSearch
                                                    || row.name.toLowerCase().includes(trimmedConnectorSearch)
                                                    || row.slug.toLowerCase().includes(trimmedConnectorSearch))
                                                .map((row) => (
                                                    <div key={row.slug} className="cm-setting-row snap-start">
                                                        <div className="cm-setting-row__icon">
                                                            <KeyRound className="w-4 h-4 text-fuchsia-400" />
                                                        </div>
                                                        <div className="cm-setting-row__copy min-w-0">
                                                            <div className="cm-setting-row__label flex items-center gap-1.5 min-w-0">
                                                                <span className="truncate">{row.name}</span>
                                                                {row.connected && (
                                                                    <Check className="w-3.5 h-3.5 text-green-400 sm:hidden shrink-0" />
                                                                )}
                                                            </div>
                                                            <div className="cm-setting-row__description truncate hidden sm:block">
                                                                {row.connected ? (
                                                                    <span className="inline-flex items-center gap-1 text-green-400">
                                                                        <Check className="w-3 h-3 shrink-0" />
                                                                        {row.allowed ? "Connected · Granted to agents" : "Connected · Paused"}
                                                                        {row.actions?.length ? ` · ${row.actions.length} actions` : ""}
                                                                    </span>
                                                                ) : row.missingVars.length > 0 ? (
                                                                    `Missing: ${row.missingVars.map((v) => v.varName).join(", ")}`
                                                                ) : (
                                                                    "Not connected"
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="cm-setting-row__control flex items-center gap-2 shrink-0">
                                                            {connectorBusy === row.slug ? (
                                                                <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                                                            ) : row.connected ? (
                                                                <>
                                                                    <Switch
                                                                        checked={row.allowed}
                                                                        disabled={connectorBusy === row.slug}
                                                                        onCheckedChange={(checked) => void toggleConnectorGrant(row, checked)}
                                                                        aria-label={`Allow agents to use ${row.name}`}
                                                                    />
                                                                    <Button
                                                                        variant="destructive"
                                                                        size="sm"
                                                                        aria-label={`Disconnect ${row.name}`}
                                                                        className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                                                        onClick={() => void disconnectConnector(row)}
                                                                    >
                                                                        <Unplug className="w-4 h-4" />
                                                                        <span className="hidden sm:inline ml-1 text-xs">Disconnect</span>
                                                                    </Button>
                                                                </>
                                                            ) : (
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    aria-label={`Connect ${row.name}`}
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

                                            {filteredGatedCatalog.slice(0, connectorsWindow).map((entry) => (
                                                <div key={entry.slug} className="cm-setting-row snap-start">
                                                    <div className="cm-setting-row__icon">
                                                        <KeyRound className="w-4 h-4 text-muted-foreground" />
                                                    </div>
                                                    <div className="cm-setting-row__copy min-w-0">
                                                        <div className="cm-setting-row__label truncate">{entry.name}</div>
                                                        <div className="cm-setting-row__description truncate hidden sm:block">
                                                            {entry.description || entry.slug}
                                                        </div>
                                                    </div>
                                                    <div className="cm-setting-row__control shrink-0">
                                                        {connectorBusy === entry.slug ? (
                                                            <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                                                        ) : (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                aria-label={`Connect ${entry.name}`}
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

                                            {trimmedConnectorSearch && filteredGatedCatalog.length === 0 && !connectorRows.some((row) => (
                                                row.name.toLowerCase().includes(trimmedConnectorSearch)
                                                || row.slug.toLowerCase().includes(trimmedConnectorSearch)
                                            )) && (
                                                <div className="text-center py-4 text-muted-foreground text-sm">
                                                    No API-key connectors found for "{connectorSearchQuery}"
                                                </div>
                                            )}

                                            {connectorRows.length === 0 && gatedCatalog.length === 0 && !loadingConnectors && !trimmedConnectorSearch && (
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
            </DialogContent>
        </Dialog>
    );
}

export default BackpackDialog;
