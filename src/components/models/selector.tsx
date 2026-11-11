import { useState, useMemo } from "react";
import { ModelBadge } from "@/components/models/badge";
import { CommandBar } from "@/components/models/commands";
import { useModels } from "@/hooks/use-model";

interface ModelSelectorProps {
    value: string;
    onChange: (modelId: string) => void;
    placeholder?: string;
    disabled?: boolean;
    showTypeFilter?: boolean;
    showRefresh?: boolean;
    className?: string;
    type?: string;
    family?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function ModelSelector({
    value,
    onChange,
    disabled = false,
    type,
    family,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
}: ModelSelectorProps) {
    const [localOpen, setLocalOpen] = useState(false);
    const open = controlledOpen !== undefined ? controlledOpen : localOpen;
    const setOpen = controlledOnOpenChange !== undefined ? controlledOnOpenChange : setLocalOpen;

    const { models } = useModels({});

    const selectedModel = useMemo(
        () => models.find((m) => m.modelId === value) || null,
        [models, value]
    );

    return (
        <>
            <ModelBadge
                model={selectedModel}
                onClick={() => {
                    if (!disabled) setOpen(true);
                }}
            />
            <CommandBar
                open={open}
                onOpenChange={setOpen}
                value={value}
                onSelect={onChange}
                type={type}
                family={family}
            />
        </>
    );
}
