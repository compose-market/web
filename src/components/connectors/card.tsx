/**
 * Connector Card Component
 *
 * Persistent right-rail inspector for the Playground Connectors tab,
 * mirroring ModelCard (pinned header + Overview | Params | Schema tabs).
 */
import * as React from "react";
import { useEffect, useState, useMemo } from "react";
import { Hint, ShellNotice } from "@compose-market/theme/shell";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { JsonParamTextarea, Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { HighlightedCode } from "@/lib/performance/markdown";
import { openGlobalBackpack } from "@/components/backpack";
import {
  Backpack,
  Code2,
  LayoutGrid,
  Link2,
  Play,
  Plug,
  SlidersHorizontal,
} from "lucide-react";

export type ConnectorCardSource = "mcp" | "account" | "onchain";
export type ConnectorCardTab = "overview" | "params" | "schema";

export interface ConnectorToolSummary {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ConnectorCredentialSpec {
  varName: string;
  description?: string | null;
  obtainUrl?: string | null;
}

export interface ConnectorCardProps {
  source: ConnectorCardSource;
  connectorId: string;
  connectorName: string;
  connectorDescription?: string;
  connectorLogo?: string;
  tools: ConnectorToolSummary[];
  selectedTool: string;
  onSelectTool: (toolName: string) => void;
  toolSchema: Record<string, unknown> | null;
  argsJson: string;
  onArgsJsonChange: (nextJson: string) => void;
  credentials?: ConnectorCredentialSpec[];
  credentialsRequired?: boolean;
  accountAuthRequired?: boolean;
  statusLabel?: string;
  statusTone?: "ready" | "warn" | "neutral";
  tab?: ConnectorCardTab;
  onTabChange?: (tab: ConnectorCardTab) => void;
}

interface SchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
}

interface ParsedSchema {
  properties: Record<string, SchemaProperty>;
  required: Set<string>;
}

function parseJsonSchema(schema: Record<string, unknown> | null): ParsedSchema {
  if (!schema || typeof schema !== "object") {
    return { properties: {}, required: new Set() };
  }
  const rawProps = (schema as { properties?: Record<string, SchemaProperty> }).properties;
  const rawRequired = (schema as { required?: unknown }).required;
  const required = new Set<string>(
    Array.isArray(rawRequired)
      ? rawRequired.filter((item): item is string => typeof item === "string")
      : [],
  );
  return {
    properties: rawProps && typeof rawProps === "object" ? rawProps : {},
    required,
  };
}

function primaryPropertyType(prop: SchemaProperty): string {
  if (Array.isArray(prop.type)) {
    return prop.type.find((t) => t !== "null") ?? prop.type[0] ?? "string";
  }
  return prop.type || "string";
}

function safeParseObject(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function SourceEmblem({ source, logo, name }: { source: ConnectorCardSource; logo?: string; name: string }) {
  if (logo) {
    return <img src={logo} alt={name} loading="lazy" decoding="async" className="cm-connector-card__logo" />;
  }
  if (source === "account") return <Link2 className="cm-connector-card__emblem-svg" />;
  if (source === "onchain") return <Play className="cm-connector-card__emblem-svg" />;
  return <Plug className="cm-connector-card__emblem-svg" />;
}

function originLabel(source: ConnectorCardSource): string {
  if (source === "account") return "Account";
  if (source === "onchain") return "Onchain";
  return "MCP";
}