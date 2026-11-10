import { memo, useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import { ShellCommandItem, ShellCommandOverlay, ShellCommandPanel } from "@compose-market/theme/shell";
import { useRegistryServers, useRegistrySearch, type RegistryServer, type ServerOrigin } from "@/hooks/use-registry";
import { Badge } from "@/components/ui/badge";
import { Check, Coins, Link2, Loader2, Play, Server } from "lucide-react";

export type ConnectorOriginFilter =
  | "onchain"
  | "mcp"
  | "account"
  | "onchain,mcp"
  | "mcp,account,onchain";

interface ConnectorCommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (server: RegistryServer) => void;
  selectedIds?: Set<string>;
  origin?: ConnectorOriginFilter;
}

const INITIAL_RENDER_LIMIT = 100;
const RENDER_STEP = 100;
const EMPTY_SELECTED_IDS = new Set<string>();

function getOriginStyles(origin: ServerOrigin): { bg: string; text: string; label: string } {
  switch (origin) {
    case "onchain":
      return { bg: "hsl(142 70% 45% / 0.15)", text: "hsl(142 70% 55%)", label: "Onchain" };
    case "account":
      return { bg: "hsl(280 80% 58% / 0.15)", text: "hsl(280 85% 72%)", label: "Accounts" };
    case "mcp":
      return { bg: "hsl(190 80% 48% / 0.15)", text: "hsl(190 80% 60%)", label: "MCPs" };
    default:
      return { bg: "hsl(215 15% 30% / 0.15)", text: "hsl(215 15% 60%)", label: String(origin) };
  }
}

function OriginGlyph({ origin, color }: { origin: ServerOrigin; color: string }) {
  if (origin === "account") return <Link2 className="w-3.5 h-3.5" style={{ color }} />;
  if (origin === "onchain") return <Coins className="w-3.5 h-3.5" style={{ color }} />;
  return <Server className="w-3.5 h-3.5" style={{ color }} />;
}

interface ConnectorCommandRowProps {
  connector: RegistryServer;
  idx: number;
  isSelected: boolean;
  isAdded: boolean;
  styles: { bg: string; text: string; label: string };
  onChoose: (connector: RegistryServer) => void;
}

const ConnectorCommandRow = memo(function ConnectorCommandRow({
  connector,
  idx,
  isSelected,
  isAdded,
  styles,
  onChoose,
}: ConnectorCommandRowProps) {
  return (
    <ShellCommandItem
      data-cmd-item
      data-cmd-index={idx}
      selected={isSelected}
      current={isAdded}
      onClick={() => {
        if (!isAdded) onChoose(connector);
      }}
      style={{ opacity: isAdded ? 0.6 : 1 }}
    >
      <div className="flex flex-col min-w-0 flex-1 py-0.5">
        <span className="cm-command-item__name font-mono text-xs truncate">
          {connector.name || connector.slug}
        </span>
        <span className="text-xs text-muted-foreground truncate max-w-[28rem] mt-0.5">
          {connector.description || "No description available"}
        </span>
      </div>
      <span
        className="cm-connector-command-glyph shrink-0 items-center gap-1 select-none"
        title={styles.label}
        aria-hidden="true"
      >
        <OriginGlyph origin={connector.origin} color={styles.text} />
        {isAdded ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : null}
      </span>
      <div className="cm-command-item__meta cm-connector-command-meta shrink-0">
        {connector.origin === "account" && connector.authMode && (
          <Badge
            variant="outline"
            className="text-xs border-purple-500/30 text-purple-300 px-1 py-0"
          >
            {connector.noAuth || connector.authMode === "no_auth"
              ? "Public"
              : connector.authMode === "oauth"
                ? "OAuth"
                : "API Key"}
          </Badge>
        )}
        {connector.origin === "onchain" && (
          <Badge
            variant="outline"
            className="text-xs border-cyan-500/30 text-cyan-400 px-1 py-0"
          >
            <Play className="w-2 h-2 mr-0.5" /> Testable
          </Badge>
        )}
        <span
          className="cm-command-item__provider uppercase"
          style={{ background: styles.bg, color: styles.text }}
        >
          {styles.label}
        </span>
        {isAdded && (
          <span className="text-green-400 flex items-center text-xs font-mono shrink-0 ml-1">
            <Check className="w-3.5 h-3.5 mr-0.5" /> Added
          </span>
        )}
      </div>
    </ShellCommandItem>
  );
});

export function ConnectorCommandBar({
  open,
  onOpenChange,
  onSelect,
  selectedIds = EMPTY_SELECTED_IDS,
  origin = "mcp,account,onchain",
}: ConnectorCommandBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const deferredQuery = useDeferredValue(searchQuery);

  const { data: defaultData, isLoading: isLoadingDefault } = useRegistryServers({
    origin,
    enabled: open,
  });

  const connectorSearchReady = deferredQuery.trim().length >= 2;
  const { data: searchData, isLoading: isSearching } = useRegistrySearch(deferredQuery, 50, {
    origin,
    enabled: open && connectorSearchReady,
  });

  const availableConnectors = useMemo(() => {
    return connectorSearchReady ? searchData?.servers ?? [] : defaultData?.servers ?? [];
  }, [defaultData, connectorSearchReady, searchData]);

  const isLoading = connectorSearchReady ? isSearching && availableConnectors.length === 0 : isLoadingDefault;

  // Group by origin
  const grouped = useMemo(() => {
    const groups = new Map<ServerOrigin, RegistryServer[]>();
    for (const p of availableConnectors) {
      const g = groups.get(p.origin) || [];
      g.push(p);
      groups.set(p.origin, g);
    }
    return Array.from(groups.entries());
  }, [availableConnectors]);

  // Flat list + O(1) index map for keyboard navigation
  const flatList = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);
  const flatIndexById = useMemo(
    () => new Map(flatList.map((item, index) => [item.registryId, index])),
    [flatList],
  );

  // Reset selection & progressive window on filter change
  useEffect(() => {
    setSelectedIndex(0);
    setRenderLimit(INITIAL_RENDER_LIMIT);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [searchQuery]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSelectedIndex(0);
      setRenderLimit(INITIAL_RENDER_LIMIT);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Expand progressive window if keyboard navigation moves near the edge
  useEffect(() => {
    if (selectedIndex >= renderLimit - 10 && renderLimit < flatList.length) {
      setRenderLimit((prev) => Math.min(flatList.length, Math.max(prev + RENDER_STEP, selectedIndex + RENDER_STEP)));
    }
  }, [flatList.length, renderLimit, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.querySelector(`[data-cmd-index="${selectedIndex}"]`) as HTMLElement | null;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, renderLimit]);

  const handleChoose = useCallback(
    (connector: RegistryServer) => {
      onSelect(connector);
      onOpenChange(false);
    },
    [onOpenChange, onSelect],
  );

  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || renderLimit >= flatList.length) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 480) {
      setRenderLimit((prev) => Math.min(flatList.length, prev + RENDER_STEP));
    }
  }, [flatList.length, renderLimit]);

  const visibleGrouped = useMemo(() => {
    if (connectorSearchReady || renderLimit >= flatList.length) return grouped;
    const out: Array<[ServerOrigin, RegistryServer[]]> = [];
    let remaining = renderLimit;
    for (const [groupOrigin, originConnectors] of grouped) {
      if (remaining <= 0) break;
      if (originConnectors.length <= remaining) {
        out.push([groupOrigin, originConnectors]);
        remaining -= originConnectors.length;
      } else {
        out.push([groupOrigin, originConnectors.slice(0, remaining)]);
        remaining = 0;
      }
    }
    return out;
  }, [connectorSearchReady, flatList.length, grouped, renderLimit]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, Math.max(0, flatList.length - 1)));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter": {
          e.preventDefault();
          const target = flatList[selectedIndex];
          if (target && !selectedIds.has(target.registryId)) {
            handleChoose(target);
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          onOpenChange(false);
          break;
      }
    },
    [flatList, selectedIndex, handleChoose, onOpenChange, selectedIds]
  );

  if (!open) return null;

  return createPortal(
    <ShellCommandOverlay open={open} onClose={() => onOpenChange(false)}>
      <ShellCommandPanel onKeyDown={handleKeyDown}>
        <div className="cm-command-header">
          <input
            ref={inputRef}
            className="cm-command-input"
            placeholder="Search connectors by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="cm-command-list" ref={listRef} onScroll={handleListScroll}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          ) : flatList.length === 0 ? (
            <div className="cm-command-empty">No connectors match "{searchQuery}"</div>
          ) : (
            visibleGrouped.map(([groupOrigin, originConnectors]) => {
              const styles = getOriginStyles(groupOrigin);
              const fullCount = grouped.find(([key]) => key === groupOrigin)?.[1].length ?? originConnectors.length;
              return (
                <div key={groupOrigin}>
                  <div className="cm-command-group" style={{ color: styles.text }}>
                    {styles.label} Connectors ({fullCount})
                  </div>
                  {originConnectors.map((connector) => {
                    const idx = flatIndexById.get(connector.registryId) ?? -1;
                    return (
                      <ConnectorCommandRow
                        key={connector.registryId}
                        connector={connector}
                        idx={idx}
                        isSelected={idx === selectedIndex}
                        isAdded={selectedIds.has(connector.registryId)}
                        styles={styles}
                        onChoose={handleChoose}
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="cm-command-footer">
          <span>
            {flatList.length} connectors available
          </span>
          <div className="cm-command-footer__hints">
            <span className="cm-command-hint">
              <kbd>↑↓</kbd> navigate
            </span>
            <span className="cm-command-hint">
              <kbd>↵</kbd> select
            </span>
            <span className="cm-command-hint">
              <kbd>esc</kbd> close
            </span>
          </div>
        </div>
      </ShellCommandPanel>
    </ShellCommandOverlay>,
    document.body
  );
}
