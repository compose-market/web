/**
 * Shared network (chain) logo assets.
 *
 * Single source of truth for chain logos under `public/networks/` —
 * used by agent cards, the dashboard network filter, and anywhere a
 * chain needs a visual identity.
 */
export const NETWORK_LOGOS: Record<string, string> = {
  "eip155:43113": "/networks/avalancheFuji.jpeg",
  "eip155:43114": "/networks/avalanche.jpeg",
  "eip155:421614": "/networks/arbitrumSepolia.png",
  "eip155:42161": "/networks/arbitrum.png",
  "eip155:5042002": "/networks/arcTestnet.jpeg",
  "eip155:5042": "/networks/arc.jpeg",
  "eip155:677": "/networks/botchain.jpg",
  "eip155:1328": "/networks/seiTestnet.jpeg",
  "eip155:1329": "/networks/sei.jpeg",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "/networks/solanaDevnet.jpeg",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "/networks/solana.jpeg",
};

import React from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/** Logo URL for a CAIP-2 network id, if we have an asset for it. */
export function networkLogo(network: string | undefined | null): string | undefined {
  if (!network) return undefined;
  return NETWORK_LOGOS[network];
}

/** Standardized network visual identity glyph (logo with Globe fallback). */
export function NetworkGlyph({
  network,
  name,
  className,
}: {
  network: string | null | undefined;
  name?: string;
  className?: string;
}): React.ReactElement {
  const logo = network ? networkLogo(network) : undefined;
  if (logo) {
    return React.createElement("img", {
      src: logo,
      alt: "",
      className: cn("cm-network-filter__logo", className),
      loading: "lazy",
      decoding: "async",
    });
  }
  return React.createElement(Globe, {
    className: cn("cm-control-switcher__icon", className),
    "aria-label": name,
  });
}

export { NetworkGlyph as NetworkLogo };

