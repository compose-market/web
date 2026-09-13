/**
 * Dashboard network filtering — selection helper + rail selector.
 *
 * `toggleNetworkSelection` is the pure multi-select reducer (unit-tested).
 * `NetworkFilter` reuses the platform's standard selector chrome — the exact
 * same `cm-shell-tab` + `cm-control-switcher__*` parts as the time-range
 * Switcher next to it: the selected network's logo (or a globe for "All")
 * always centered, label + chevron, and the shared `cm-control-menu`
 * surface. Multi-select is preserved.
 */
import { ChevronDown, Globe } from "lucide-react";
import type { FacilitatorChain, NetworkId } from "@compose-market/sdk/chains";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { networkLogo, NetworkGlyph } from "@/lib/networks";

export function toggleNetworkSelection(
  selected: readonly string[],
  network: string,
  checked: boolean,
): string[] {
  const next = new Set(selected);
  if (checked) next.add(network);
  else next.delete(network);
  return [...next].sort();
}

type SupportedChain = FacilitatorChain & { network: NetworkId };

export function NetworkFilter({
  chains,
  selected,
  onChange,
}: {
  chains: SupportedChain[];
  selected: NetworkId[];
  onChange: (next: NetworkId[]) => void;
}) {
  const all = selected.length === 0;
  const single = selected.length === 1
    ? chains.find((chain) => chain.network === selected[0]) ?? null
    : null;

  const label = all
    ? "All"
    : single
      ? (single.shortName ?? single.name)
      : `${selected.length} networks`;
  const fullLabel = all
    ? "All networks"
    : single
      ? single.name
      : selected
        .map((network) => chains.find((chain) => chain.network === network)?.name ?? network)
        .join(", ");
  const tooltip = `Networks: ${fullLabel}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="cm-shell-tab cm-network-filter"
          aria-label={tooltip}
          title={tooltip}
        >
          {all ? (
            <Globe className="cm-control-switcher__icon" />
          ) : single ? (
            <NetworkGlyph network={single.network} name={single.name} />
          ) : (
            <span className="cm-network-filter__stack" aria-hidden="true">
              {selected.slice(0, 3).map((network) => (
                <NetworkGlyph key={network} network={network} name={network} />
              ))}
            </span>
          )}
          <span className="cm-control-switcher__label">{label}</span>
          <ChevronDown className="cm-control-switcher__chevron" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="cm-control-menu">
        <DropdownMenuCheckboxItem
          checked={all}
          onCheckedChange={(checked) => {
            if (checked) onChange([]);
          }}
          onSelect={(event) => event.preventDefault()}
          className="cm-control-menu__item"
        >
          <Globe className="cm-control-menu__icon" />
          <span className="cm-control-menu__label">All networks</span>
        </DropdownMenuCheckboxItem>
        {chains.map((chain) => (
          <DropdownMenuCheckboxItem
            key={chain.network}
            checked={selected.includes(chain.network)}
            onCheckedChange={(checked) => {
              onChange(toggleNetworkSelection(selected, chain.network, checked === true) as NetworkId[]);
            }}
            onSelect={(event) => event.preventDefault()}
            className="cm-control-menu__item"
          >
            <NetworkGlyph network={chain.network} name={chain.name} />
            <span className="cm-control-menu__label">{chain.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
