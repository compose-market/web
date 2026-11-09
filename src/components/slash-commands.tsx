import { useMemo } from "react";
import { Terminal, Target, Users, Shield, FileText, Folder, Receipt, Layers, X } from "lucide-react";

export interface SlashCommand {
    name: string;
    description: string;
    args?: string;
    icon: React.ComponentType<{ className?: string }>;
}

export const SLASH_COMMANDS: SlashCommand[] = [
    {
        name: "plan",
        description: "Create a multi-step plan with tasks",
        args: "<prompt>",
        icon: Layers,
    },
    {
        name: "goal",
        description: "Pin a durable goal the agent works toward",
        args: "<objective>",
        icon: Target,
    },
    {
        name: "mode",
        description: "Switch execution mode",
        args: "solo | swarm",
        icon: Users,
    },
    {
        name: "sandbox",
        description: "Force sandboxed/isolation execution",
        args: "on | off",
        icon: Shield,
    },
    {
        name: "proof",
        description: "Force proof-of-execution mode",
        args: "on | off",
        icon: Shield,
    },
    {
        name: "thread",
        description: "List past conversation threads",
        icon: FileText,
    },
    {
        name: "artifacts",
        description: "List past generated media",
        icon: Folder,
    },
    {
        name: "receipt",
        description: "List x402 payment receipts",
        icon: Receipt,
    },
];

export const selectableSlashCommandNames = ["plan", "goal", "sandbox", "proof"] as const;

const selectableSlashCommandNameSet = new Set<string>(selectableSlashCommandNames);

export function isSelectableSlashCommandName(name: string): boolean {
    return selectableSlashCommandNameSet.has(name.trim().replace(/^\/+/u, "").toLowerCase());
}

export function nextSelectedSlashCommands(selected: string[], name: string): string[] {
    const normalized = name.trim().replace(/^\/+/u, "").toLowerCase();
    if (!isSelectableSlashCommandName(normalized) || selected.includes(normalized)) return selected;
    return [...selected, normalized];
}

export function withoutSelectedSlashCommand(selected: string[], name: string): string[] {
    const normalized = name.trim().replace(/^\/+/u, "").toLowerCase();
    return selected.filter((command) => command !== normalized);
}

export function clearSlashCommandToken(input: string): string {
    if (!input.startsWith("/")) return input;
    return input.replace(/^\/[a-z0-9_-]*\s*/iu, "");
}

function slashCommandQuery(input: string): string | null {
    if (!input.startsWith("/")) return null;
    // Only open slash autocomplete while the user is still editing the command token
    // (before any whitespace/arguments), so Enter submits manual `/cmd arg...` cleanly.
    if (/\s/.test(input)) return null;
    return input.slice(1).toLowerCase();
}

export function slashCommandMatches(input: string): SlashCommand[] {
    const query = slashCommandQuery(input);
    if (query === null) return [];
    if (query === "") return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(query));
}

interface SlashCommandPopoverProps {
    input: string;
    selectedIndex: number;
    onSelect: (command: SlashCommand) => void;
    onHighlight: (index: number) => void;
}

export function SlashCommandPopover({ input, selectedIndex, onSelect, onHighlight }: SlashCommandPopoverProps) {
    const matches = useMemo(() => slashCommandMatches(input), [input]);

    if (matches.length === 0) return null;

    return (
        <div className="cm-slash-popover" role="listbox" aria-label="Slash commands">
            <div className="cm-slash-popover__head">
                <Terminal className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                <span>Commands</span>
                <span className="cm-slash-popover__hint">Enter or Tab</span>
            </div>
            <div className="cm-slash-popover__list">
                {matches.map((cmd, index) => {
                    const Icon = cmd.icon;
                    const active = index === selectedIndex;
                    return (
                        <button
                            key={cmd.name}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-active={active ? "true" : undefined}
                            className="cm-slash-item"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onSelect(cmd);
                            }}
                            onMouseEnter={() => onHighlight(index)}
                        >
                            <span className="cm-slash-item__icon" aria-hidden="true">
                                <Icon className="h-4 w-4" />
                            </span>
                            <span className="cm-slash-item__copy">
                                <span className="cm-slash-item__line">
                                    <span className="cm-slash-item__name">/{cmd.name}</span>
                                    {cmd.args ? <span className="cm-slash-item__args">{cmd.args}</span> : null}
                                </span>
                                <span className="cm-slash-item__desc">{cmd.description}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function SelectedSlashCommandBadges({
    selected,
    onRemove,
}: {
    selected: string[];
    onRemove: (name: string) => void;
}) {
    if (selected.length === 0) return null;
    return (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {selected.map((name) => (
                <span
                    key={name}
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 text-xs font-mono text-primary"
                >
                    /{name}
                    <button
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-primary/80 hover:bg-primary/15 hover:text-primary"
                        aria-label={`Remove /${name}`}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemove(name);
                        }}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </span>
            ))}
        </div>
    );
}

export function isSlashCommand(input: string): boolean {
    return input.startsWith("/") && input.length > 0;
}

export function parseSlashCommand(input: string): { command: string; args: string } | null {
    const match = input.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
    if (!match) return null;
    return { command: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}
