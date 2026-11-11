import { useMemo, useState } from "react";
import { ModelBadgeTrigger } from "@/components/models/badge";
import { ConnectorCommandBar, type ConnectorOriginFilter } from "@/components/connectors/commands";
import { useConnectorCatalogSnapshot, useRegistryServer, type RegistryServer } from "@/hooks/use-registry";
import { normalizeConnectorBinding, type CanonicalConnectorOrigin } from "@/lib/connectors";
import { Loader2 } from "lucide-react";

interface ConnectorSelectorProps {
  value: string;
  onChange: (server: RegistryServer) => void;
  placeholder?: string;
  disabled?: boolean;
  selectedIds?: Set<string>;
  origin?: ConnectorOriginFilter;
  shortcut?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConnectorSelector({
  value,
  onChange,
  placeholder = "Select connector...",
  disabled = false,
  selectedIds,
  origin,
  shortcut,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ConnectorSelectorProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : localOpen;
  const setOpen = controlledOnOpenChange !== undefined ? controlledOnOpenChange : setLocalOpen;

  const defaultOrigin: CanonicalConnectorOrigin =
    origin === "account" || origin === "onchain" || origin === "mcp"
      ? origin
      : "mcp";
  const snap = useConnectorCatalogSnapshot(Boolean(value));
  const snapshotMatch = useMemo(() => {
    if (!value || !snap.hasData) return null;
    const binding = normalizeConnectorBinding(value, { defaultOrigin });
    return snap.serverByBindingId.get(binding.registryId.toLowerCase())
      ?? snap.serverByBindingId.get(`${binding.origin}:${binding.slug.toLowerCase()}`)
      ?? null;
  }, [defaultOrigin, snap.hasData, snap.serverByBindingId, value]);

  const { data: fetchedServer, isLoading } = useRegistryServer(
    value && !snapshotMatch ? value : null,
    defaultOrigin,
  );
  const server = snapshotMatch ?? fetchedServer ?? null;
  const showLoading = Boolean(value) && !server && isLoading;

  const displayLabel = showLoading ? (
    <span className="inline-flex items-center gap-1.5">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      Loading...
    </span>
  ) : server ? (
    server.name
  ) : (
    placeholder
  );

  return (
    <>
      <ModelBadgeTrigger
        placeholder={!server}
        label={displayLabel}
        shortcut={shortcut}
        disabled={disabled || showLoading}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
      />
      <ConnectorCommandBar
        open={open}
        onOpenChange={setOpen}
        onSelect={onChange}
        selectedIds={selectedIds}
        origin={origin}
      />
    </>
  );
}
