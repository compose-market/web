/**
 * CapabilityChips — compact type/provider dropdowns
 *
 * Keeps the current chip/badge treatment, but moves long option sets into
 * dropdown windows so the toolbar never becomes a horizontal scroll rail.
 */
import { useState } from "react";
import {
  ChevronDown,
  Cpu,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { type ModelCategory, getFamilyLogoUrl, getModelTypeClass, getModelTypeVisualId } from "@/lib/models";
import { typeIcon, typeLabel } from "@/lib/modalities";

interface CapabilityChipsProps {
  selectedType: string;
  onTypeChange: (type: string) => void;
  typeCategories: ModelCategory[];
  selectedFamily: string;
  onFamilyChange: (family: string) => void;
  familyCategories: ModelCategory[];
}

function compactFamilyLabel(label: string): string {
  if (label === "All Families") return "All";
  // Capitalize first letter
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function familyIcon(familyId: string) {
  const logoUrl = getFamilyLogoUrl(familyId);
  if (logoUrl) {
    return <img src={logoUrl} alt={familyId} className="cm-family-icon" />;
  }
  return <Cpu className="cm-type-icon" />;
}

function categoryClass(cat: ModelCategory, variant: "type" | "family", selected: boolean): string {
  return [
    "cm-playground__chip-option",
    variant === "family" ? "cm-playground__chip-option--family" : "",
    selected ? "cm-playground__chip-option--active" : "",
  ].filter(Boolean).join(" ");
}

function triggerClass(variant: "type" | "family"): string {
  return [
    "cm-playground__chip-trigger",
    `cm-playground__chip-trigger--${variant}`,
  ].join(" ");
}

function chipLabel(cat: ModelCategory, variant: "type" | "family"): string {
  return variant === "type" ? typeLabel(cat.label) : compactFamilyLabel(cat.label);
}

function ChipContent({
  cat,
  variant,
  label,
  isTrigger = false,
}: {
  cat: ModelCategory;
  variant: "type" | "family";
  label?: string;
  isTrigger?: boolean;
}) {
  const textClass = isTrigger ? "cm-playground__chip-label" : "cm-chip__text";
  const countClass = isTrigger ? "cm-playground__chip-count" : "cm-chip__count";
  return (
    <>
      {variant === "type" ? (
        <span className={`cm-type-label ${getModelTypeClass(cat.id)}`}>
          {typeIcon(getModelTypeVisualId(cat.id))}
          <span className={textClass}>{label ?? chipLabel(cat, variant)}</span>
        </span>
      ) : (
        <>
          {familyIcon(cat.id)}
          <span className={textClass}>{label ?? chipLabel(cat, variant)}</span>
        </>
      )}
      <span className={countClass}>{cat.count}</span>
    </>
  );
}

function FilterDropdown({
  label,
  selected,
  categories,
  variant,
  onChange,
}: {
  label: "Type" | "Family";
  selected: string;
  categories: ModelCategory[];
  variant: "type" | "family";
  onChange: (value: string) => void;
}) {
  const fallback: ModelCategory = {
    id: "all",
    label: variant === "type" ? "All Models" : "All Families",
    count: 0,
  };
  const selectedCat = categories.find((cat) => cat.id === selected) ?? categories[0] ?? fallback;
  const triggerLabel = selected === "all" ? label : chipLabel(selectedCat, variant);
  const [showOthers, setShowOthers] = useState(false);
  const otherFamilies = variant === "family"
    ? categories.filter((cat) => cat.id !== "all" && cat.count <= 2)
    : [];
  const visibleCategories = variant === "family"
    ? categories.filter((cat) => cat.id === "all" || cat.count > 2)
    : categories;
  const othersExpanded = showOthers || otherFamilies.some((cat) => cat.id === selected);

  const categoryItem = (cat: ModelCategory) => {
    const isActive = selected === cat.id;
    return (
      <DropdownMenuItem
        key={`${variant}-${cat.id}`}
        aria-selected={isActive}
        className={categoryClass(cat, variant, isActive)}
        data-active={isActive ? "true" : undefined}
        onSelect={() => onChange(cat.id)}
      >
        <ChipContent cat={cat} variant={variant} />
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu>
      <div className="cm-playground__chip-dropdown">
        <DropdownMenuTrigger asChild>
          <button
            className={triggerClass(variant)}
            type="button"
            aria-label={`${label}: ${triggerLabel}`}
          >
            <ChipContent cat={selectedCat} variant={variant} label={triggerLabel} isTrigger />
            <ChevronDown className="cm-playground__chip-chevron hidden sm:inline" />
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align="start"
        className="cm-playground__chip-menu"
        sideOffset={8}
      >
        <div className={`cm-playground__chip-menu-grid cm-playground__chip-menu-grid--${variant}`}>
          {visibleCategories.map(categoryItem)}
          {variant === "family" && otherFamilies.length > 0 && (
            <div className="cm-playground__family-others">
              <DropdownMenuItem
                className="cm-playground__family-others-toggle"
                aria-expanded={othersExpanded}
                onSelect={(event) => {
                  event.preventDefault();
                  setShowOthers((open) => !open);
                }}
              >
                <span>Others…</span>
                <span className="cm-playground__family-others-count">{otherFamilies.length} families</span>
                <ChevronDown className="cm-playground__family-others-chevron" data-open={othersExpanded ? "true" : undefined} />
              </DropdownMenuItem>
              {othersExpanded && (
                <div className="cm-playground__family-others-grid">
                  {otherFamilies.map(categoryItem)}
                </div>
              )}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CapabilityChips({
  selectedType,
  onTypeChange,
  typeCategories,
  selectedFamily,
  onFamilyChange,
  familyCategories,
}: CapabilityChipsProps) {
  return (
    <div className="cm-playground__chips">
      <FilterDropdown
        label="Type"
        selected={selectedType}
        categories={typeCategories}
        variant="type"
        onChange={onTypeChange}
      />
      <div className="cm-playground__divider" />
      <FilterDropdown
        label="Family"
        selected={selectedFamily}
        categories={familyCategories}
        variant="family"
        onChange={onFamilyChange}
      />
    </div>
  );
}
