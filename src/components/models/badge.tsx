/**
 * ModelBadge — Product-specific trigger badge for model / connector selectors.
 */
import * as React from "react";
import { getDefaultModelPricingSections } from "@/lib/models";
import type { CatalogModel } from "@/lib/models";
import { cn } from "@/lib/utils";

export interface ModelBadgeTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: React.ReactNode;
  price?: React.ReactNode;
  shortcut?: React.ReactNode;
  placeholder?: boolean;
  active?: boolean;
}

export const ModelBadgeTrigger = React.forwardRef<HTMLButtonElement, ModelBadgeTriggerProps>(
  function ModelBadgeTrigger(
    { className, label, price, shortcut, placeholder = false, active = false, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        data-active={active}
        data-placeholder={placeholder}
        className={cn("cm-model-badge", className)}
        {...props}
      >
        {!placeholder ? <span className="cm-model-badge__dot" /> : null}
        <span className="cm-model-badge__name">{label}</span>
        {price ? <span className="cm-model-badge__price">{price}</span> : null}
        {shortcut ? <span className="cm-model-badge__shortcut">{shortcut}</span> : null}
      </button>
    );
  },
);

export const ShellModelBadge = ModelBadgeTrigger;

interface ModelBadgeProps {
  model: CatalogModel | null;
  onClick: () => void;
}

function formatBadgePrice(model: CatalogModel): string {
  const sections = getDefaultModelPricingSections(model);
  if (sections.length === 0) return "—";
  for (const section of sections) {
    for (const entry of section.entries) {
      const label = entry.label.toLowerCase();
      if (
        label.includes("input")
        || label.includes("prompt")
        || label.includes("cost")
        || label.includes("generation")
        || label.includes("megapixel")
        || label.includes("second")
      ) {
        const val = parseFloat(entry.value);
        if (val === 0) return "FREE";
        if (Number.isFinite(val)) {
          if (val < 0.001) return `$${val.toFixed(5)}`;
          if (val < 1) return `$${val.toFixed(3)}`;
          return `$${val.toFixed(2)}`;
        }
      }
    }
  }
  return "—";
}

export function ModelBadge({ model, onClick }: ModelBadgeProps) {
  if (!model) {
    return (
      <ModelBadgeTrigger
        label="Model"
        shortcut="⌘K"
        placeholder
        onClick={onClick}
      />
    );
  }

  const price = formatBadgePrice(model);

  return (
    <ModelBadgeTrigger
      label={model.name || model.modelId}
      price={price}
      shortcut="⌘K"
      onClick={onClick}
      title={`${model.modelId} · ${model.family || model.provider}`}
    />
  );
}
