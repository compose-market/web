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