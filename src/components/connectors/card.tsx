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

export function ConnectorCard({
  source,
  connectorId,
  connectorName,
  connectorDescription,
  connectorLogo,
  tools,
  selectedTool,
  onSelectTool,
  toolSchema,
  argsJson,
  onArgsJsonChange,
  credentials = [],
  credentialsRequired = false,
  accountAuthRequired = false,
  statusLabel,
  statusTone = "neutral",
  tab,
  onTabChange,
}: ConnectorCardProps) {
  const [internalTab, setInternalTab] = useState<ConnectorCardTab>("overview");
  const activeTab = tab ?? internalTab;
  const setActiveTab = (next: ConnectorCardTab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };

  const parsedSchema = useMemo(() => parseJsonSchema(toolSchema), [toolSchema]);
  const propEntries = useMemo(() => Object.entries(parsedSchema.properties), [parsedSchema.properties]);
  const parsedArgs = useMemo(() => safeParseObject(argsJson), [argsJson]);
  const activeTool = useMemo(() => tools.find((t) => t.name === selectedTool) ?? null, [selectedTool, tools]);
  const formattedSchemaJson = useMemo(
    () => (toolSchema ? JSON.stringify(toolSchema, null, 2) : "{}"),
    [toolSchema],
  );

  const updateParamValue = (key: string, nextValue: unknown) => {
    const base = parsedArgs ? { ...parsedArgs } : {};
    if (nextValue === undefined) {
      delete base[key];
    } else {
      base[key] = nextValue;
    }
    onArgsJsonChange(JSON.stringify(base, null, 2));
  };

  const tabs: Array<{ id: ConnectorCardTab; label: string; icon: React.ReactNode; tone: "cyan" | "fuchsia" }> = [
    { id: "overview", label: "Overview", icon: <LayoutGrid className="cm-model-card__tab-icon" />, tone: "cyan" },
    { id: "params", label: "Params", icon: <SlidersHorizontal className="cm-model-card__tab-icon" />, tone: "fuchsia" },
    { id: "schema", label: "Schema", icon: <Code2 className="cm-model-card__tab-icon" />, tone: "cyan" },
  ];

  if (!connectorId) {
    return (
      <aside className="cm-connector-card cm-connector-card--empty">
        <Plug className="cm-connector-card__empty-icon" />
        <p className="cm-connector-card__empty-text">
          Select a connector to inspect its tools, parameters, and JSON schema
        </p>
      </aside>
    );
  }

  return (
    <aside className="cm-connector-card" data-tab={activeTab}>
      <header className="cm-connector-card__header">
        <div className="cm-connector-card__identity">
          <span className="cm-connector-card__emblem" data-origin={source} aria-hidden="true">
            <SourceEmblem source={source} logo={connectorLogo} name={connectorName} />
          </span>
          <div className="cm-connector-card__titles">
            <Hint label={connectorName || connectorId}>
              <h2 className="cm-connector-card__title-text">{connectorName || connectorId}</h2>
            </Hint>
            <div className="cm-connector-card__meta-row">
              <span className="cm-connector-card__origin-badge" data-origin={source}>
                {originLabel(source)}
              </span>
              <span className="cm-connector-card__count">
                {tools.length} {source === "account" ? (tools.length === 1 ? "action" : "actions") : (tools.length === 1 ? "tool" : "tools")}
              </span>
              {statusLabel ? (
                <span className="inline-flex items-center gap-1.5 cm-connector-card__count">
                  <span className="cm-connector-card__status-dot" data-state={statusTone} />
                  {statusLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="cm-model-card__tabs" role="tablist" aria-label="Connector inspector">
          {tabs.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className="cm-model-card__tab"
                data-active={active ? "true" : "false"}
                data-tone={item.tone}
                onClick={() => setActiveTab(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="cm-connector-card__body">
        {activeTab === "overview" && (
          <>
            {connectorDescription ? (
              <section className="cm-model-card__section">
                <div className="cm-model-card__section-label">Connector</div>
                <div className="cm-model-card__section-body">
                  <p className="cm-connector-card__desc">{connectorDescription}</p>
                </div>
              </section>
            ) : null}

            {activeTool ? (
              <section className="cm-model-card__section">
                <div className="cm-model-card__section-label">
                  Active {source === "account" ? "Action" : "Tool"}
                </div>
                <div className="cm-model-card__section-body">
                  <div className="cm-connector-card__tool-name">{activeTool.name}</div>
                  <p className="cm-connector-card__desc">
                    {activeTool.description || "No description provided."}
                  </p>
                </div>
              </section>
            ) : null}

            {credentialsRequired && (
              <ShellNotice tone="warning">
                <div className="space-y-2">
                  <div className="font-mono text-xs font-semibold">Credentials required</div>
                  {credentials.length > 0 ? (
                    <div className="cm-connector-card__credentials">
                      {credentials.map((cred) => (
                        <span key={cred.varName} className="cm-connector-card__cred-chip">
                          {cred.varName}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm gap-1.5"
                    onClick={() => openGlobalBackpack({ tab: "connectors" })}
                  >
                    <Backpack className="w-3.5 h-3.5" />
                    Configure in Backpack
                  </Button>
                </div>
              </ShellNotice>
            )}

            {accountAuthRequired && (
              <ShellNotice tone="info">
                <div className="space-y-2">
                  <div className="font-mono text-xs font-semibold">Account connection required</div>
                  <p className="text-xs opacity-80 m-0">
                    Connect {connectorName || connectorId} in Backpack before running actions.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cm-shell-button cm-shell-button--ghost cm-shell-button--sm gap-1.5"
                    onClick={() => openGlobalBackpack({ tab: "accounts" })}
                  >
                    <Backpack className="w-3.5 h-3.5" />
                    Connect in Backpack
                  </Button>
                </div>
              </ShellNotice>
            )}

            {tools.length > 0 && (
              <section className="cm-model-card__section">
                <div className="cm-model-card__section-label">
                  Available {source === "account" ? "Actions" : "Tools"} ({tools.length})
                </div>
                <div className="cm-connector-card__tool-list">
                  {tools.map((tool) => (
                    <button
                      key={tool.name}
                      type="button"
                      className="cm-connector-card__tool-item"
                      data-active={tool.name === selectedTool ? "true" : "false"}
                      onClick={() => onSelectTool(tool.name)}
                    >
                      <span className="cm-connector-card__tool-name">{tool.name}</span>
                      {tool.description ? (
                        <span className="cm-connector-card__tool-desc">{tool.description}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === "params" && (
          <>
            {!activeTool ? (
              <p className="cm-connector-card__desc">Select a tool to edit its parameters.</p>
            ) : propEntries.length === 0 ? (
              <p className="cm-connector-card__desc">
                This {source === "account" ? "action" : "tool"} requires no parameters.
              </p>
            ) : (
              <>
                {parsedArgs === null ? (
                  <ShellNotice tone="warning">
                    JSON payload in the runner contains a syntax error. Fix it or edit any field below to reset.
                  </ShellNotice>
                ) : null}
                <div className="cm-connector-card__param-list">
                  {propEntries.map(([key, prop]) => {
                    const isRequired = parsedSchema.required.has(key);
                    const type = primaryPropertyType(prop);
                    const value = parsedArgs ? parsedArgs[key] : undefined;

                    return (
                      <div key={key} className="cm-connector-card__param-field">
                        <div className="cm-connector-card__param-head">
                          <span className="cm-connector-card__param-name" data-required={isRequired ? "true" : "false"}>
                            {key}{isRequired ? " *" : ""}
                          </span>
                          <span className="cm-connector-card__param-type">{type}</span>
                        </div>
                        {prop.description ? (
                          <p className="cm-connector-card__param-desc">{prop.description}</p>
                        ) : null}

                        {prop.enum && prop.enum.length > 0 ? (
                          <select
                            className="cm-model-card__option-select"
                            value={value === undefined ? "" : String(value)}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                updateParamValue(key, undefined);
                              } else if (type === "integer") {
                                updateParamValue(key, Number.parseInt(raw, 10));
                              } else if (type === "number") {
                                updateParamValue(key, Number.parseFloat(raw));
                              } else {
                                updateParamValue(key, raw);
                              }
                            }}
                          >
                            {!isRequired && <option value="">Default</option>}
                            {prop.enum.map((opt) => (
                              <option key={`${key}-${opt}`} value={String(opt)}>
                                {String(opt)}
                              </option>
                            ))}
                          </select>
                        ) : type === "boolean" ? (
                          <div className="cm-model-card__tool-toggle">
                            <span className="cm-model-card__field-value">
                              <span className="cm-model-card__field-main">
                                {Boolean(value ?? prop.default) ? "Enabled" : "Disabled"}
                              </span>
                            </span>
                            <Switch
                              checked={Boolean(value ?? prop.default)}
                              onCheckedChange={(checked) => updateParamValue(key, checked)}
                            />
                          </div>
                        ) : type === "object" || type === "array" ? (
                          <JsonParamTextarea
                            value={value}
                            placeholder={type === "array" ? "[]" : "{}"}
                            onValidChange={(parsed) => updateParamValue(key, parsed)}
                          />
                        ) : (
                          <Input
                            type={type === "number" || type === "integer" ? "number" : "text"}
                            min={prop.minimum}
                            max={prop.maximum}
                            className="cm-model-card__field"
                            value={value === undefined ? "" : String(value)}
                            placeholder={prop.default !== undefined ? String(prop.default) : ""}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (type === "integer") {
                                const parsed = Number.parseInt(raw, 10);
                                updateParamValue(key, raw === "" ? undefined : (Number.isFinite(parsed) ? parsed : undefined));
                              } else if (type === "number") {
                                const parsed = Number.parseFloat(raw);
                                updateParamValue(key, raw === "" ? undefined : (Number.isFinite(parsed) ? parsed : undefined));
                              } else {
                                updateParamValue(key, raw);
                              }
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {activeTab === "schema" && (
          <>
            {propEntries.length > 0 ? (
              <section className="cm-model-card__section">
                <div className="cm-model-card__section-label">Parameters ({propEntries.length})</div>
                <div className="cm-connector-card__schema-table">
                  {propEntries.map(([key, prop]) => {
                    const isRequired = parsedSchema.required.has(key);
                    return (
                      <div key={key} className="cm-connector-card__schema-row">
                        <div className="cm-connector-card__param-head">
                          <span className="cm-connector-card__param-name" data-required={isRequired ? "true" : "false"}>
                            {key}{isRequired ? " *" : ""}
                          </span>
                          <span className="cm-connector-card__param-type">{primaryPropertyType(prop)}</span>
                        </div>
                        {prop.default !== undefined ? (
                          <span className="cm-connector-card__count">default: {String(prop.default)}</span>
                        ) : null}
                        <p className="cm-connector-card__param-desc">
                          {prop.description || "No description provided."}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <p className="cm-connector-card__desc">No parameter schema defined for this tool.</p>
            )}

            <section className="cm-model-card__section">
              <div className="cm-model-card__section-label">Raw JSON Schema</div>
              <HighlightedCode code={formattedSchemaJson} language="json" compact />
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
