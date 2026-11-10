import { createElement, isValidElement, useEffect, useRef, type ComponentType, type ReactNode } from "react";
import ArrowDownUp from "lucide-react/icons/arrow-down-up";
import ChevronDown from "lucide-react/icons/chevron-down";
import Check from "lucide-react/icons/check";
import Search from "lucide-react/icons/search";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string }> | ReactNode;

export interface Option<T extends string = string> {
  value: T;
  label: string;
  icon?: Icon;
  disabled?: boolean;
  count?: string | number;
  dot?: boolean;
}

function IconNode({ icon, className }: { icon?: Icon; className: string }) {
  if (!icon) return null;
  if (isValidElement(icon)) {
    return <span className={className}>{icon}</span>;
  }
  if (typeof icon === "string" || typeof icon === "number") {
    return <span className={className}>{icon}</span>;
  }
  if (typeof icon === "function" || typeof icon === "object") {
    const Component = icon;
    return createElement(Component as ComponentType<{ className?: string }>, { className });
  }
  return null;
}

export function Switcher<T extends string>({
  value,
  options,
  label,
  onChange,
  className,
}: {
  value: T;
  options: Option<T>[];
  label: string;
  onChange: (value: T) => void;
  className?: string;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={cn("cm-control-switcher", className)}>
      <Tabs value={value} onValueChange={onChange as (v: string) => void}>
        <TabsList className="cm-shell-tab-strip cm-control-switcher__tabs">
          {options.map((option) => (
            <TabsTrigger
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="cm-shell-tab min-w-0"
            >
              <IconNode icon={option.icon} className="cm-control-switcher__icon" />
              <span className="truncate">{option.label}</span>
              {option.count !== undefined && option.count !== null && (
                <span className="cm-control-switcher__badge ml-1.5 px-1.5 py-0.5 text-xs font-bold bg-primary/10 rounded font-mono text-muted-foreground">
                  {option.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {current ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="cm-shell-tab cm-control-switcher__trigger"
              aria-label={`${label}: ${current.label}`}
            >
              <IconNode icon={current.icon} className="cm-control-switcher__icon" />
              <span className="cm-control-switcher__label flex items-center">
                {current.label}
                {current.count !== undefined && current.count !== null && (
                  <span className="cm-control-switcher__badge ml-1.5 px-1.5 py-0.5 text-xs font-bold bg-primary/10 rounded font-mono text-muted-foreground">
                    {current.count}
                  </span>
                )}
              </span>
              <ChevronDown className="cm-control-switcher__chevron" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} className="cm-control-menu">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <DropdownMenuItem
                  key={option.value}
                  disabled={option.disabled}
                  data-active={active ? "true" : undefined}
                  className="cm-control-menu__item"
                  onSelect={() => onChange(option.value)}
                >
                  <IconNode icon={option.icon} className="cm-control-menu__icon" />
                  <span className="cm-control-menu__label flex items-center">
                    {option.label}
                    {option.count !== undefined && option.count !== null && (
                      <span className="cm-control-switcher__badge ml-1.5 px-1.5 py-0.5 text-xs font-bold bg-primary/10 rounded font-mono text-muted-foreground">
                        {option.count}
                      </span>
                    )}
                  </span>
                  {active ? <Check className="cm-control-menu__check" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function Ordering<T extends string>({
  value,
  options,
  label = "Ordering",
  disabled,
  onChange,
  className,
}: {
  value: T;
  options: Option<T>[];
  label?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
  className?: string;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("cm-control-icon-button", className)}
          aria-label={current ? `${label}: ${current.label}` : label}
          disabled={disabled}
          title={current ? `${label}: ${current.label}` : label}
        >
          <ArrowDownUp className="cm-control-icon-button__icon" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="cm-control-menu">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <DropdownMenuItem
              key={option.value}
              disabled={option.disabled}
              data-active={active ? "true" : undefined}
              className="cm-control-menu__item"
              onSelect={() => onChange(option.value)}
            >
              <IconNode icon={option.icon} className="cm-control-menu__icon" />
              <span className="cm-control-menu__label">{option.label}</span>
              {active ? <Check className="cm-control-menu__check" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SearchFold({
  open,
  value,
  label,
  placeholder,
  onOpenChange,
  onChange,
  className,
}: {
  open: boolean;
  value: string;
  label: string;
  placeholder: string;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const visible = open || value.trim().length > 0;

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <div className={cn("cm-control-search-fold", className)} data-open={visible}>
      <label className="cm-search cm-search--fold" aria-label={label} aria-hidden={!visible}>
        <Search className="cm-hud-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="cm-search__input"
          type="search"
          placeholder={placeholder}
          value={value}
          disabled={!visible}
          tabIndex={visible ? 0 : -1}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            if (value) {
              onChange("");
              return;
            }
            onOpenChange(false);
          }}
        />
      </label>
      <button
        type="button"
        className="cm-hud-button cm-hud-button--icon cm-control-search-fold__toggle"
        aria-label={label}
        aria-expanded={visible}
        onClick={() => onOpenChange(!visible)}
      >
        <Search className="cm-hud-icon" />
      </button>
    </div>
  );
}
