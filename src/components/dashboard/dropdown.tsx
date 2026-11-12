import { ArrowUpDown, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";

export interface BlockDropdownOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * BlockDropdown — the single compact selector used inside dashboard blocks.
 * Radix-powered (portaled, collision-aware) so the menu is never clipped by
 * the block's overflow — same idiom as Switcher/Ordering in control.tsx.
 */
export function BlockDropdown<T extends string>({
  value,
  options,
  label,
  onChange,
  chevron = true,
  align = "end",
}: {
  value: T;
  options: Array<BlockDropdownOption<T>>;
  label: string;
  onChange: (value: T) => void;
  /** chevron style for view selectors; arrows for sort selectors. */
  chevron?: boolean;
  align?: "start" | "center" | "end";
}) {
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="cm-sort-dropdown__trigger"
          aria-label={`${label}: ${current?.label ?? ""}`}
        >
          <span>{current?.label}</span>
          {current?.count !== undefined && (
            <span className="cm-sort-dropdown__count">{current.count}</span>
          )}
          {chevron
            ? <ChevronDown className="cm-sort-dropdown__icon" />
            : <ArrowUpDown className="cm-sort-dropdown__icon" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} sideOffset={6} className="cm-control-menu">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <DropdownMenuItem
              key={option.value}
              data-active={active ? "true" : undefined}
              className="cm-control-menu__item"
              onSelect={() => onChange(option.value)}
            >
              <span className="cm-control-menu__label">
                {option.label}
                {option.count !== undefined && (
                  <span className="cm-sort-dropdown__count">{option.count}</span>
                )}
              </span>
              {active ? <Check className="cm-control-menu__check" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
