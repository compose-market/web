import { useMemo, useState } from "react";
import { ExternalLink, Zap } from "lucide-react";
import { formatMs, formatTokens } from "@/lib/analytics";
import type { FeedItem, RequestRow } from "@/lib/analytics";
import { formatUsd, formatWeiUsd, timeAgo, shortTx, settlementTone } from "@/lib/receipts";
import { formatModelTypeLabel } from "@/lib/models";
import { getExplorerTxUrl } from "@/lib/chains";
import { BlockDropdown } from "./dropdown";

export type ActivityTab = "requests" | "settlements";
type RequestFilter = "all" | "succeeded" | "failed" | "streamed";
type SettlementFilter = "all" | "settled" | "submitted" | "queued" | "failed";

const VIEW_OPTIONS: Array<{ value: ActivityTab; label: string }> = [
  { value: "requests", label: "Requests" },
  { value: "settlements", label: "Settlements" },
];

function requestTone(status: RequestRow["status"]): "emerald" | "danger" | "amber" {
  if (status === "succeeded") return "emerald";
  if (status === "failed") return "danger";
  return "amber";
}

function RequestsList({ requests, filter, focused }: {
  requests: RequestRow[];
  filter: RequestFilter;
  focused: boolean;
}) {
  const visible = useMemo(() => {
    const filtered = requests.filter((row) => {
      if (filter === "all") return true;
      if (filter === "streamed") return row.streamed;
      if (filter === "failed") return row.status === "failed" || row.status === "aborted";
      return row.status === "succeeded";
    });
    return focused ? filtered : filtered.slice(0, 5);
  }, [requests, filter, focused]);

  if (visible.length === 0) {
    return <div className="cm-block__empty">No requests match this filter</div>;
  }

  return (
    <div className="cm-feed-list">
      {visible.map((row) => (
        <div key={row.id} className="cm-receipt-item" data-status={row.status}>
          <div className="cm-receipt-item__top">
            <span className="cm-receipt-item__model">
              <span className="cm-feed-summary__dot" data-tone={requestTone(row.status)} />
              {row.model}
            </span>
            <span className="cm-receipt-item__meta">
              {(row.latencyMs > 0 || row.ttftMs === null) && (
                <span className="cm-settlement-badge" data-tone="violet">{formatMs(row.latencyMs)}</span>
              )}
              {row.ttftMs !== null && (
                <span className="cm-settlement-badge" data-tone="emerald">TTFT {formatMs(row.ttftMs)}</span>
              )}
              {row.streamed && (
                <span className="cm-receipt-item__streamed" title="Streamed"><Zap className="w-2.5 h-2.5" /></span>
              )}
            </span>
          </div>
          <div className="cm-receipt-item__bottom">
            <span className="cm-receipt-item__meta">
              <span>{timeAgo(row.startedAt)}</span>
              {row.type && <span className="cm-usage-modality" data-tone={row.type}>{formatModelTypeLabel(row.type)}</span>}
              <span>{row.family}</span>
            </span>
            <span className="cm-settlement-badge" data-tone={requestTone(row.status)}>{row.status}</span>
          </div>
          {row.error && (
            <div className="cm-receipt-item__error" title={row.error}>{row.error}</div>
          )}
          {focused && (
            <div className="cm-receipt-detail">
              <div className="cm-receipt-detail__row">
                <span>Tokens in → out</span>
                <strong>{formatTokens(row.tokensIn)} → {formatTokens(row.tokensOut)}</strong>
              </div>
              <div className="cm-receipt-detail__row">
                <span>Operation</span>
                <strong>{row.operation}</strong>
              </div>
              <div className="cm-receipt-detail__row">
                <span>Settled cost</span>
                <strong>{formatUsd(row.costUsd)}</strong>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SettlementsList({ receipts, filter, focused }: {
  receipts: FeedItem[];
  filter: SettlementFilter;
  focused: boolean;
}) {
  const visible = useMemo(() => {
    const filtered = receipts.filter((receipt) => {
      if (filter === "all") return true;
      const status = receipt.settlementStatus as string;
      if (filter === "settled") return status === "settled" || status === "claimed";
      return status === filter;
    });
    return focused ? filtered : filtered.slice(0, 5);
  }, [receipts, filter, focused]);

  if (visible.length === 0) {
    return <div className="cm-block__empty">No settlements match this filter</div>;
  }

  return (
    <div className="cm-feed-list">
      {visible.map((receipt) => {
        const rawExplorerUrl = receipt.transactionHash
          ? getExplorerTxUrl(receipt.network, receipt.transactionHash)
          : "#";
        const explorerUrl = rawExplorerUrl !== "#" && receipt.network.startsWith("solana:")
          ? `${rawExplorerUrl}${rawExplorerUrl.includes("?") ? "&" : "?"}view=receipt`
          : rawExplorerUrl;
        return (
          <div key={receipt.id} className="cm-receipt-item">
            <div className="cm-receipt-item__top">
              <span className="cm-receipt-item__model">{receipt.model}</span>
              <span className="cm-receipt-item__amount">{formatWeiUsd(receipt.finalAmountAtomic)}</span>
            </div>
            <div className="cm-receipt-item__bottom">
              <span className="cm-receipt-item__meta">
                <span>{timeAgo(receipt.settledAt)}</span>
                <span className="cm-usage-modality" data-tone={receipt.type}>{formatModelTypeLabel(receipt.type)}</span>
                {receipt.transactionHash && explorerUrl !== "#" && (
                  <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="cm-receipt-tx" onClick={(event) => event.stopPropagation()}>
                    {shortTx(receipt.transactionHash)}<ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </span>
              <span className="cm-settlement-badge" data-tone={settlementTone(receipt.settlementStatus)}>{receipt.settlementStatus}</span>
            </div>
            {focused && (
              <div className="cm-receipt-detail">
                <div className="cm-receipt-detail__row"><span>Inference</span><strong>{formatWeiUsd(receipt.inferenceAmountAtomic)}</strong></div>
                <div className="cm-receipt-detail__row"><span>Platform Fee</span><strong>{formatWeiUsd(receipt.platformFeeAtomic)}</strong></div>
                {receipt.pricedUnits.length > 0 && (
                  <div className="cm-receipt-detail__lineitems">
                    {receipt.pricedUnits.map((item) => (
                      <div key={`${item.key}:${item.unit}`} className="cm-receipt-detail__lineitem">
                        <span className="cm-receipt-detail__lineitem-key">
                          {item.key} · {item.quantity} {item.unit}
                          {item.unitPriceUsd > 0 ? ` @ ${formatUsd(item.unitPriceUsd)}` : ""}
                        </span>
                        <span className="cm-receipt-detail__lineitem-amount">{formatWeiUsd(item.amountAtomic)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ReceiptFeed({
  receipts,
  requests,
  hasMoreSettlements = false,
  hasMoreRequests = false,
  isLoadingMore = false,
  onLoadMore,
  focused = false,
  dataBlock,
  onClick,
}: {
  receipts: FeedItem[];
  requests: RequestRow[];
  hasMoreSettlements?: boolean;
  hasMoreRequests?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: (kind: ActivityTab) => void;
  focused?: boolean;
  dataBlock?: string;
  onClick?: () => void;
}) {
  const [tab, setTab] = useState<ActivityTab>("requests");
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("all");
  const [settlementFilter, setSettlementFilter] = useState<SettlementFilter>("all");

  const requestCounts = useMemo(() => {
    const tally = { all: requests.length, succeeded: 0, failed: 0, streamed: 0 };
    for (const row of requests) {
      if (row.status === "succeeded") tally.succeeded += 1;
      if (row.status === "failed" || row.status === "aborted") tally.failed += 1;
      if (row.streamed) tally.streamed += 1;
    }
    return tally;
  }, [requests]);

  const settlementCounts = useMemo(() => {
    const tally = { all: receipts.length, settled: 0, submitted: 0, queued: 0, failed: 0 };
    for (const receipt of receipts) {
      if (receipt.settlementStatus === "settled" || (receipt.settlementStatus as string) === "claimed") tally.settled += 1;
      else if (receipt.settlementStatus === "submitted") tally.submitted += 1;
      else if (receipt.settlementStatus === "queued") tally.queued += 1;
      else if (receipt.settlementStatus === "failed") tally.failed += 1;
    }
    return tally;
  }, [receipts]);

  const hasMore = tab === "requests" ? hasMoreRequests : hasMoreSettlements;
  const isEmpty = tab === "requests" ? requests.length === 0 : receipts.length === 0;

  return (
    <div className="cm-block" data-block={dataBlock} data-focused={focused} onClick={onClick}>
      <div className="cm-block__header">
        <div className="cm-block__header-side" onClick={(event) => event.stopPropagation()}>
          <BlockDropdown value={tab} options={VIEW_OPTIONS} label="View" onChange={setTab} align="start" />
        </div>
        <div className="cm-block__header-side" onClick={(event) => event.stopPropagation()}>
          {tab === "requests" ? (
            <BlockDropdown
              value={requestFilter}
              options={[
                { value: "all", label: "All", count: requestCounts.all },
                { value: "succeeded", label: "Succeeded", count: requestCounts.succeeded },
                { value: "failed", label: "Failed", count: requestCounts.failed },
                { value: "streamed", label: "Streamed", count: requestCounts.streamed },
              ]}
              label="Filter"
              onChange={setRequestFilter}
            />
          ) : (
            <BlockDropdown
              value={settlementFilter}
              options={[
                { value: "all", label: "All", count: settlementCounts.all },
                { value: "settled", label: "Settled", count: settlementCounts.settled },
                { value: "submitted", label: "Submitted", count: settlementCounts.submitted },
                { value: "queued", label: "Queued", count: settlementCounts.queued },
                { value: "failed", label: "Failed", count: settlementCounts.failed },
              ]}
              label="Filter"
              onChange={setSettlementFilter}
            />
          )}
        </div>
      </div>
      {isEmpty ? (
        <div className="cm-block__empty">{tab === "requests" ? "No requests in this range" : "No settlements yet"}</div>
      ) : tab === "requests" ? (
        <RequestsList requests={requests} filter={requestFilter} focused={focused} />
      ) : (
        <SettlementsList receipts={receipts} filter={settlementFilter} focused={focused} />
      )}
      {hasMore && onLoadMore ? (
        <button
          type="button"
          className="cm-feed-more"
          disabled={isLoadingMore}
          onClick={(event) => {
            event.stopPropagation();
            onLoadMore(tab);
          }}
        >
          {isLoadingMore ? "Loading…" : `Load more ${tab}`}
        </button>
      ) : null}
    </div>
  );
}
