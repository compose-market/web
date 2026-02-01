/**
 * useTabs - Persists tab state across navigation via sessionStorage
 * 
 * This hook provides tab state persistence that survives browser back/forward navigation.
 * URL params take precedence over sessionStorage for direct link support.
 * 
 * Usage:
 *   const [activeTab, setActiveTab] = useTabs("market", "manowars");
 */
import { useCallback, useEffect, useState } from "react";
import { useSearch } from "wouter";

const STORAGE_KEY_PREFIX = "tab-state-";

export function useTabs(pageKey: string, defaultTab: string) {
    const search = useSearch();

    // Priority: URL param > sessionStorage > default
    const getInitialTab = useCallback(() => {
        const params = new URLSearchParams(search);
        const urlTab = params.get("tab");
        if (urlTab) return urlTab;

        const stored = sessionStorage.getItem(STORAGE_KEY_PREFIX + pageKey);
        if (stored) return stored;

        return defaultTab;
    }, [search, pageKey, defaultTab]);

    const [activeTab, setActiveTabState] = useState(getInitialTab);

    // Sync state when URL changes (e.g., browser back/forward with tab param)
    useEffect(() => {
        const params = new URLSearchParams(search);
        const urlTab = params.get("tab");
        if (urlTab && urlTab !== activeTab) {
            setActiveTabState(urlTab);
            sessionStorage.setItem(STORAGE_KEY_PREFIX + pageKey, urlTab);
        }
    }, [search, pageKey, activeTab]);

    // Update tab state - just local state + sessionStorage, no URL change
    const setActiveTab = useCallback((value: string) => {
        setActiveTabState(value);
        sessionStorage.setItem(STORAGE_KEY_PREFIX + pageKey, value);
    }, [pageKey]);

    return [activeTab, setActiveTab] as const;
}
