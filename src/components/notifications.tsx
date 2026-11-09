/**
 * Notifications Dialog — ChainGPT services on the user's channels.
 *
 * Hydrates synchronously from owner-scoped localStorage snapshot + TanStack Query
 * cache so reopen and Cmd+Shift+R reloads paint in 0 ms, while revalidating
 * silently in the background.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { Switcher, type Option } from "@/components/control";
import { PoweredByChainGpt } from "@/components/chaingpt";
import { sdk } from "@/lib/sdk";
import {
    BACKPACK_GC_TIME,
    BACKPACK_STALE_TIME,
    fetchNotifications,
    notificationsQueryKey,
    readNotificationsCache,
    writeNotificationsCache,
    type NotificationsPayload,
} from "@/lib/backpack";
import type {
    ChannelName,
    ChannelRoute,
    NotifyFilters,
    NotifyFrequency,
    NotifySubscription,
} from "@compose-market/sdk";
import {
    Bell,
    Check,
    Loader2,
    Newspaper,
    QrCode,
    RefreshCw,
    Scale,
    Send,
    TrendingUp,
    Zap,
} from "lucide-react";

const SERVICE_META: Record<string, { icon: React.ReactNode; tone: string }> = {
    alerts: { icon: <Zap className="w-4 h-4 text-amber-400" />, tone: "amber" },
    news: { icon: <Newspaper className="w-4 h-4 text-cyan-400" />, tone: "cyan" },
    assistant: { icon: <TrendingUp className="w-4 h-4 text-fuchsia-400" />, tone: "fuchsia" },
    compliance: { icon: <Scale className="w-4 h-4 text-emerald-400" />, tone: "emerald" },
};

const FREQUENCY_OPTIONS: Option<"6" | "12" | "24">[] = [
    { value: "6", label: "6h" },
    { value: "12", label: "12h" },
    { value: "24", label: "24h" },
];

const SENTIMENTS: Array<{ value: string; label: string }> = [
    { value: "bullish", label: "Bullish" },
    { value: "bearish", label: "Bearish" },
    { value: "neutral", label: "Neutral" },
];

const ALERT_CHAINS: string[] = [
    "Bitcoin",
    "Ethereum",
    "Solana",
    "BNB Chain",
    "Base",
    "Polygon",
    "Avalanche",
    "Arbitrum",
];

const NEWS_CATEGORIES: Array<{ value: number; label: string }> = [
    { value: 5, label: "DeFi" },
    { value: 8, label: "NFT" },
    { value: 3, label: "DAO" },
    { value: 9, label: "Stablecoins" },
    { value: 78, label: "Exchange" },
    { value: 4, label: "DApps" },
];

const NEWS_TOKENS: Array<{ value: number; label: string }> = [
    { value: 79, label: "BTC" },
    { value: 80, label: "ETH" },
    { value: 85, label: "SOL" },
    { value: 82, label: "BNB" },
    { value: 83, label: "XRP" },
    { value: 87, label: "DOGE" },
];

const CHANNEL_META: Record<ChannelName, { label: string; logo: string; color: string }> = {
    telegram: {
        label: "Telegram",
        logo: "https://logos.composio.dev/api/telegram",
        color: "#24A1DE",
    },
    whatsapp: {
        label: "WhatsApp",
        logo: "https://logos.composio.dev/api/whatsapp",
        color: "#25D366",
    },
    slack: {
        label: "Slack",
        logo: "https://logos.composio.dev/api/slack",
        color: "#4A154B",
    },
    discord: {
        label: "Discord",
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
        route.threadId,
    ].find((value) => typeof value === "string" && value.trim().length > 0);
    return label || route.id;
}

interface NotificationsDialogProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    showTrigger?: boolean;
}

export function NotificationsDialog({
    open,
    onOpenChange,
}: NotificationsDialogProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { userAddress, isResolving } = useSelectedUserAddress();
    const [isOpen, setIsOpen] = useState(false);
    const handleOpen = open !== undefined ? open : isOpen;
    const handleOpenChange = onOpenChange || setIsOpen;

    const [saving, setSaving] = useState<string | null>(null);
    const [busyChannel, setBusyChannel] = useState<ChannelName | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollAbortRef = useRef<AbortController | null>(null);

    const cachedSnapshot = useMemo(
        () => readNotificationsCache(userAddress),
        [userAddress],
    );

    const notificationsQuery = useQuery<NotificationsPayload, Error>({
        queryKey: notificationsQueryKey(userAddress || ""),
        queryFn: ({ signal }) => fetchNotifications(userAddress!, { signal }),
        initialData: cachedSnapshot?.data,
        initialDataUpdatedAt: cachedSnapshot?.updatedAt,
        staleTime: BACKPACK_STALE_TIME,
        gcTime: BACKPACK_GC_TIME,
        enabled: handleOpen && Boolean(userAddress) && !isResolving,
        retry: 1,
    });

    const data = notificationsQuery.data;
    const services = data?.services ?? [];
    const channelStates = data?.channels ?? [];
    const subs = useMemo<Record<string, NotifySubscription>>(
        () => Object.fromEntries((data?.subscriptions || []).map((sub) => [sub.service, sub])),
        [data?.subscriptions],
    );

    const loading = notificationsQuery.isFetching;
    const failed = Boolean(notificationsQuery.error) && services.length === 0;

    const clearPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        if (pollAbortRef.current) {
            pollAbortRef.current.abort();
            pollAbortRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!handleOpen) {
            clearPolling();
            setBusyChannel(null);
        }
    }, [handleOpen, clearPolling]);

    useEffect(() => () => clearPolling(), [clearPolling]);

    const refresh = useCallback(async () => {
        if (!userAddress || isResolving) return;
        await notificationsQuery.refetch();
    }, [isResolving, notificationsQuery, userAddress]);

    /**
     * Persist a subscription change. Enabled subscriptions with no channels
     * yet stay local (pending) until a channel is picked or connected — the
     * backend rejects enabled-without-channels.
     */
    const persist = useCallback(async (
        service: string,
        next: { enabled?: boolean; channels?: ChannelName[]; frequencyHours?: NotifyFrequency; filters?: NotifyFilters },
    ) => {
        if (!userAddress) return;
        const current = subs[service];
        const enabled = next.enabled ?? current?.enabled ?? false;
        const channels = next.channels ?? current?.channels ?? [];
        const frequencyHours = next.frequencyHours ?? current?.frequencyHours;
        const filters = next.filters ?? current?.filters;
        const kind = current?.kind ?? services.find((item) => item.service === service)?.kind ?? "bridge";

        const updatedSub = {
            ...(current as NotifySubscription | undefined),
            service: service as NotifySubscription["service"],
            kind,
            enabled,
            channels,
            ...(kind === "poller" && frequencyHours ? { frequencyHours } : {}),
            ...(kind === "poller" && filters ? { filters } : {}),
        } as NotifySubscription;

        const key = notificationsQueryKey(userAddress);
        queryClient.setQueryData<NotificationsPayload>(key, (prev) => {
            if (!prev) return prev;
            const filtered = (prev.subscriptions || []).filter((item) => item.service !== service);
            const updated: NotificationsPayload = {
                ...prev,
                subscriptions: [...filtered, updatedSub],
            };
            writeNotificationsCache(userAddress, updated);
            return updated;
        });

        if (enabled && channels.length === 0) return;

        setSaving(service);
        try {
            await sdk.notifications.save({
                userAddress,
                service: service as NotifySubscription["service"],
                enabled,
                channels,
                ...(kind === "poller" && frequencyHours ? { frequencyHours } : {}),
                ...(kind === "poller" && filters ? { filters } : {}),
            });
        } catch (error) {
            toast({
                title: "Could not save notifications",
                description: error instanceof Error ? error.message : "Please try again.",
                variant: "destructive",
            });
            void queryClient.invalidateQueries({ queryKey: key });
        } finally {
            setSaving(null);
        }
    }, [queryClient, services, subs, toast, userAddress]);

    const pollConnect = useCallback((channel: ChannelName) => {
        if (!userAddress) return;
        clearPolling();
        const controller = new AbortController();
        pollAbortRef.current = controller;
        let attempts = 0;
        const key = notificationsQueryKey(userAddress);
        const tick = async () => {
            attempts += 1;
            try {
                const fresh = await fetchNotifications(userAddress, { signal: controller.signal });
                if (controller.signal.aborted) return;
                queryClient.setQueryData(key, fresh);
                const connected = (fresh.channels || []).some((state) => state.channel === channel && state.connected);
                if (connected || attempts >= 40) {
                    clearPolling();
                    setBusyChannel(null);
                    if (connected) {
                        void queryClient.invalidateQueries({ queryKey: ["backpack", "channels"] });
                    }
                }
            } catch {
                // Keep polling; refresh recovers the final state.
            }
        };
        void tick();
        pollRef.current = setInterval(() => void tick(), 3000);
    }, [clearPolling, queryClient, userAddress]);

    const connectChannel = useCallback(async (channel: ChannelName) => {
        if (!userAddress) {
            toast({ title: "Connect wallet", description: "Connect your wallet to link channels.", variant: "destructive" });
            return;
        }
        setBusyChannel(channel);
        try {
            const link = await sdk.notifications.link(channel, { userAddress });
            const url = link.action?.url || link.url;
            if (url) {
                window.open(url, "_blank", "noopener,noreferrer");
            }
            pollConnect(channel);
            toast({
                title: `${CHANNEL_META[channel].label} link opened`,
                description: "Complete the provider flow to connect this channel.",
            });
        } catch (error) {
            setBusyChannel(null);
            toast({
                title: "Channel link failed",
                description: error instanceof Error ? error.message : "Unable to create channel link.",
                variant: "destructive",
            });
        }
    }, [pollConnect, toast, userAddress]);

    const toggleChannelInSubscription = useCallback((service: string, channel: ChannelName) => {
        const current = subs[service];
        const selected = new Set(current?.channels || []);
        if (selected.has(channel)) {
            selected.delete(channel);
        } else {
            selected.add(channel);
        }
        void persist(service, { channels: [...selected] });
    }, [persist, subs]);

    const toggleFilter = useCallback((service: string, key: "sentiment" | "chains" | "tags" | "categories" | "tokens", value: string | number) => {
        const current = subs[service];
        const filters: NotifyFilters = { ...(current?.filters || {}) };
        const list = (filters[key] as Array<string | number> | undefined) || [];
        const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
        const updated: NotifyFilters = { ...filters };
        if (next.length > 0) {
            (updated as Record<string, Array<string | number>>)[key] = next;
        } else {
            delete (updated as Record<string, Array<string | number>>)[key];
        }
        void persist(service, { filters: updated });
    }, [persist, subs]);

    const setSearchFilter = useCallback((service: string, search: string) => {
        void persist(service, { filters: { ...(subs[service]?.filters || {}), search: search.trim() || undefined } });
    }, [persist, subs]);

    const enabledCount = Object.values(subs).filter((sub) => sub.enabled).length;

    const renderChannelsSelection = (service: string) => (
        <div className="space-y-2 pl-1">
            <div className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                Channels
            </div>
            {channelStates.map((state) => {
                const meta = CHANNEL_META[state.channel];
                const selected = subs[service]?.channels?.includes(state.channel) ?? false;
                const connecting = busyChannel === state.channel;
                return (
                    <div key={state.channel} className="cm-setting-row">
                        <div
                            className="cm-setting-row__icon overflow-hidden flex items-center justify-center"
                            style={{ backgroundColor: `${meta.color}15` }}
                        >
                            <img
                                src={meta.logo}
                                alt={meta.label}
                                loading="lazy"
                                decoding="async"
                                className="w-5 h-5 object-contain"
                                onError={(event) => {
                                    (event.target as HTMLImageElement).style.display = "none";
                                }}
                            />
                        </div>
                        <div className="cm-setting-row__copy">
                            <div className="cm-setting-row__label flex items-center gap-1.5">
                                {meta.label}
                                {state.connected && (
                                    <Badge variant="secondary" className="text-xs px-1.5 py-0 border-primary/20 text-green-400 font-normal">
                                        connected
                                    </Badge>
                                )}
                            </div>
                            <div className="cm-setting-row__description truncate hidden sm:block">
                                {state.connected
                                    ? <span className="flex items-center gap-1 text-green-400"><Check className="w-3 h-3" /> {routeLabel(state.routes[0])}{state.routes.length > 1 ? ` (+${state.routes.length - 1} more)` : ""}</span>
                                    : meta.label}
                            </div>
                        </div>
                        <div className="cm-setting-row__control">
                            {connecting ? (
                                <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                            ) : state.connected ? (
                                <Switch
                                    checked={selected}
                                    onCheckedChange={() => toggleChannelInSubscription(service, state.channel)}
                                    aria-label={`${meta.label} notifications`}
                                />
                            ) : state.channel === "whatsapp" ? (
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
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0 h-8 w-8 sm:w-auto p-0 sm:px-2.5 flex items-center justify-center"
                                    onClick={() => void connectChannel(state.channel)}
                                >
                                    <Send className="w-4 h-4" />
                                    <span className="hidden sm:inline ml-1 text-xs">Connect</span>
                                </Button>
                            )}
                        </div>
                    </div>
                );
            })}
            {subs[service]?.enabled && (subs[service]?.channels?.length ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground pt-1">
                    {services.find((item) => item.service === service)?.poller
                        ? "Pick at least one connected channel to activate notifications."
                        : "Pick at least one connected channel to enable the command."}
                </p>
            )}
        </div>
    );

    const renderChip = (active: boolean, label: string, onClick: () => void) => (
        <button
            type="button"
            data-active={active}
            onClick={onClick}
            className="cm-chip"
        >
            <span className="cm-chip__text">{label}</span>
        </button>
    );

    const renderFilters = (service: string) => {
        const filters = subs[service]?.filters || {};
        if (service === "alerts") {
            return (
                <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                        {SENTIMENTS.map((sentiment) => (
                            <div key={sentiment.value} className="contents">
                                {renderChip(
                                    (filters.sentiment || []).includes(sentiment.value),
                                    sentiment.label,
                                    () => toggleFilter(service, "sentiment", sentiment.value),
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {ALERT_CHAINS.map((chain) => (
                            <div key={chain} className="contents">
                                {renderChip(
                                    (filters.chains || []).includes(chain),
                                    chain,
                                    () => toggleFilter(service, "chains", chain),
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (service === "news") {
            return (
                <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                        {NEWS_CATEGORIES.map((category) => (
                            <div key={category.value} className="contents">
                                {renderChip(
                                    (filters.categories || []).includes(category.value),
                                    category.label,
                                    () => toggleFilter(service, "categories", category.value),
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {NEWS_TOKENS.map((token) => (
                            <div key={token.value} className="contents">
                                {renderChip(
                                    (filters.tokens || []).includes(token.value),
                                    token.label,
                                    () => toggleFilter(service, "tokens", token.value),
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <Dialog open={handleOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <Bell className="w-5 h-5 text-fuchsia-400" />
                        Notifications
                        {enabledCount > 0 && (
                            <Badge variant="secondary" className="ml-1 text-xs px-1.5">
                                {enabledCount}
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        ChainGPT alerts, news, and assistants delivered to your connected channels.
                    </DialogDescription>
                </DialogHeader>

                {!userAddress || isResolving ? (
                    <div className="flex-1 flex items-center justify-center py-8 text-sm text-muted-foreground">
                        Connect your wallet to manage notifications.
                    </div>
                ) : loading && services.length === 0 && !failed ? (
                    <div className="flex-1 flex items-center justify-center py-8 text-muted-foreground text-sm">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Loading notifications...
                    </div>
                ) : services.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
                        <p className="text-sm text-center">
                            Notifications unavailable — the channels service could not be reached.
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => void refresh()}
                            disabled={loading}
                        >
                            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                            Retry
                        </Button>
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                Services
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => void refresh()}
                                disabled={loading}
                            >
                                <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                        </div>

                        {services.map((info) => {
                            const meta = SERVICE_META[info.service] || SERVICE_META.alerts;
                            const sub = subs[info.service];
                            const enabled = sub?.enabled ?? false;
                            const isSaving = saving === info.service;
                            return (
                                <div key={info.service} className="space-y-2.5">
                                    <div className="cm-setting-row">
                                        <div className="cm-setting-row__icon">{meta.icon}</div>
                                        <div className="cm-setting-row__copy">
                                            <div className="cm-setting-row__label flex items-center gap-1.5">
                                                {info.label}
                                                {info.command && (
                                                    <Badge variant="outline" className="text-xs px-1 py-0 border-primary/20 text-muted-foreground font-mono font-normal">
                                                        {info.command}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="cm-setting-row__description hidden sm:block">
                                                {info.description}
                                            </div>
                                        </div>
                                        <div className="cm-setting-row__control">
                                            {isSaving ? (
                                                <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                                            ) : (
                                                <Switch
                                                    checked={enabled}
                                                    onCheckedChange={(checked) => void persist(info.service, {
                                                        enabled: checked,
                                                        ...(checked && info.poller && !sub?.frequencyHours
                                                            ? { frequencyHours: 6 }
                                                            : {}),
                                                        ...(checked && (sub?.channels?.length ?? 0) === 0
                                                            ? { channels: channelStates.filter((state) => state.connected).map((state) => state.channel) }
                                                            : {}),
                                                    })}
                                                    aria-label={info.label}
                                                />
                                            )}
                                        </div>
                                    </div>

                                    {enabled && (
                                        <div className="p-3 bg-muted/40 rounded-lg border border-primary/10 space-y-3">
                                            {info.poller && (
                                                <>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                            Frequency
                                                        </span>
                                                        <Switcher
                                                            value={String(sub?.frequencyHours ?? 6) as "6" | "12" | "24"}
                                                            options={FREQUENCY_OPTIONS}
                                                            label="Frequency"
                                                            onChange={(value) => void persist(info.service, {
                                                                frequencyHours: Number(value) as NotifyFrequency,
                                                            })}
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                                Filters
                                                            </span>
                                                            <Input
                                                                defaultValue={sub?.filters?.search || ""}
                                                                placeholder={info.service === "alerts" ? "Search signals..." : "Search news..."}
                                                                className="h-7 max-w-48 text-xs bg-background/70"
                                                                onBlur={(event) => setSearchFilter(info.service, event.target.value)}
                                                                onKeyDown={(event) => {
                                                                    if (event.key === "Enter") {
                                                                        setSearchFilter(info.service, (event.target as HTMLInputElement).value);
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                        {renderFilters(info.service)}
                                                    </div>
                                                </>
                                            )}
                                            {renderChannelsSelection(info.service)}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="flex-shrink-0 border-t border-border/40 pt-2.5 mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                        Commands and digests arrive through your connected channel routes.
                    </p>
                    <PoweredByChainGpt className="ml-auto" />
                </div>
            </DialogContent>
        </Dialog>
    );
}
