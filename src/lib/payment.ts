export const SESSION_BUDGET_EVENT = "compose:session-budget";
export const SESSION_INVALID_EVENT = "compose:session-invalid";

export interface PaymentFetchParams {
  chainId: number;
  sessionToken: string;
  sessionUserAddress?: string;
  sessionBudgetRemaining?: number;
}

function syncBudgetState(response: Response): void {
  if (typeof window === "undefined") {
    return;
  }

  const budgetRemainingHeader = response.headers.get("x-session-budget-remaining");
  const budgetUsedHeader = response.headers.get("x-session-budget-used");
  const budgetLimitHeader = response.headers.get("x-session-budget-limit");
  const budgetLockedHeader = response.headers.get("x-session-budget-locked");
  const budgetRemaining = budgetRemainingHeader ? Number.parseInt(budgetRemainingHeader, 10) : NaN;
  const budgetUsed = budgetUsedHeader ? Number.parseInt(budgetUsedHeader, 10) : NaN;
  const budgetLimit = budgetLimitHeader ? Number.parseInt(budgetLimitHeader, 10) : NaN;
  const budgetLocked = budgetLockedHeader ? Number.parseInt(budgetLockedHeader, 10) : NaN;

  if (Number.isFinite(budgetRemaining) && budgetRemaining >= 0) {
    window.dispatchEvent(
      new CustomEvent(SESSION_BUDGET_EVENT, {
        detail: {
          budgetRemaining,
          budgetUsed: Number.isFinite(budgetUsed) && budgetUsed >= 0 ? budgetUsed : undefined,
          budgetLimit: Number.isFinite(budgetLimit) && budgetLimit >= 0 ? budgetLimit : undefined,
          budgetLocked: Number.isFinite(budgetLocked) && budgetLocked >= 0 ? budgetLocked : undefined,
        },
      }),
    );
  }

  const reason = response.headers.get("x-compose-session-invalid");
  if (reason) {
    window.dispatchEvent(
      new CustomEvent(SESSION_INVALID_EVENT, {
        detail: {
          status: response.status,
          reason,
        },
      }),
    );
  }
}

export function createPaymentFetch(params: PaymentFetchParams): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const chainId = params.chainId;
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("chainId is required");
  }

  const sessionToken = params.sessionToken;
  const hasSessionContext = typeof params.sessionUserAddress === "string"
    && params.sessionUserAddress.length > 0
    && Number.isFinite(params.sessionBudgetRemaining)
    && (params.sessionBudgetRemaining as number) >= 0;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${sessionToken}`);
    headers.set("X-Chain-ID", String(chainId));
    if (hasSessionContext) {
      headers.set("X-Session-Active", "true");
      headers.set("X-Session-User-Address", params.sessionUserAddress!);
      headers.set("X-Session-Budget-Remaining", String(params.sessionBudgetRemaining!));
    }

    const response = await fetch(input, {
      ...init,
      headers,
    });

    syncBudgetState(response);
    return response;
  };
}
