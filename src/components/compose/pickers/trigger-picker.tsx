/**
 * Trigger Picker Component
 * 
 * Smart NL-first input for creating workflow triggers.
 * Uses LLM to parse natural language to cron expressions.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, Loader2 } from "lucide-react";
import {
    type TriggerDefinition,
    parseNLToCron,
    TRIGGER_TEMPLATES,
    getUserTimezone,
} from "@/lib/triggers";

interface TriggerPickerProps {
    onAdd: (trigger: Partial<TriggerDefinition>) => void;
}

export function TriggerPicker({ onAdd }: TriggerPickerProps) {
    const [nlInput, setNlInput] = useState("");
    const [isParsing, setIsParsing] = useState(false);
    const [parseResult, setParseResult] = useState<{
        success: boolean;
        cronExpression?: string;
        cronReadable?: string;
        error?: string;
    } | null>(null);

    // Parse the NL input when user stops typing
    const handleParse = async () => {
        if (!nlInput.trim()) return;

        setIsParsing(true);
        setParseResult(null);

        try {
            const result = await parseNLToCron(nlInput.trim(), getUserTimezone());
            setParseResult(result);
        } catch (error) {
            setParseResult({ success: false, error: String(error) });
        } finally {
            setIsParsing(false);
        }
    };

    const handleAdd = () => {
        if (parseResult?.success && parseResult.cronExpression) {
            onAdd({
                name: nlInput.substring(0, 50),
                type: "cron",
                nlDescription: nlInput,
                cronExpression: parseResult.cronExpression,
                cronReadable: parseResult.cronReadable,
                timezone: getUserTimezone(),
                enabled: true,
            });
            setNlInput("");
            setParseResult(null);
        }
    };

    const handleQuickAdd = (templateKey: string) => {
        const template = TRIGGER_TEMPLATES[templateKey];
        if (template) {
            onAdd({
                name: template.cronReadable,
                type: "cron",
                nlDescription: template.nlDescription,
                cronExpression: template.cronExpression,
                cronReadable: template.cronReadable,
                timezone: getUserTimezone(),
                enabled: true,
            });
        }
    };

    return (
        <div className="space-y-3">
            {/* NL Input - Primary Interface */}
            <div>
                <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
                    DESCRIBE YOUR SCHEDULE
                </Label>
                <div className="flex gap-2">
                    <Input
                        placeholder="e.g. every day at 9am, every Monday..."
                        value={nlInput}
                        onChange={(e) => {
                            setNlInput(e.target.value);
                            setParseResult(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && handleParse()}
                        className="h-8 text-xs bg-background/50 border-sidebar-border flex-1"
                    />
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleParse}
                        disabled={!nlInput.trim() || isParsing}
                        className="h-8 px-3 text-xs"
                    >
                        {isParsing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Parse"}
                    </Button>
                </div>
            </div>

            {/* Parse Result */}
            {parseResult && (
                <div className={`p-2 rounded-sm border text-xs ${parseResult.success
                    ? "bg-green-500/10 border-green-500/30"
                    : "bg-red-500/10 border-red-500/30"
                    }`}>
                    {parseResult.success ? (
                        <div className="space-y-1">
                            <div className="text-green-400 font-mono">{parseResult.cronReadable}</div>
                            <code className="text-[10px] text-muted-foreground">{parseResult.cronExpression}</code>
                            <Button
                                size="sm"
                                onClick={handleAdd}
                                className="w-full mt-2 bg-amber-500 hover:bg-amber-600 text-black h-7 text-xs font-bold"
                            >
                                <Clock className="w-3 h-3 mr-1" />
                                Add Trigger
                            </Button>
                        </div>
                    ) : (
                        <div className="text-red-400">{parseResult.error}</div>
                    )}
                </div>
            )}

            {/* Quick Templates */}
            <div>
                <Label className="text-[10px] font-mono text-muted-foreground mb-1.5 block">
                    QUICK ADD
                </Label>
                <div className="grid grid-cols-2 gap-1">
                    {["every-hour", "daily-9am", "weekdays-9am", "weekly-monday-9am"].map((key) => {
                        const template = TRIGGER_TEMPLATES[key];
                        return (
                            <button
                                key={key}
                                onClick={() => handleQuickAdd(key)}
                                className="p-1.5 text-[10px] font-mono text-left rounded-sm border border-sidebar-border hover:border-amber-500/50 hover:bg-amber-500/5 transition-all"
                            >
                                {template.cronReadable}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
