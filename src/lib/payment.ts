export const SESSION_BUDGET_EVENT = "compose:session-budget";
export const SESSION_INVALID_EVENT = "compose:session-invalid";

export interface PaymentFetchParams {
  chainId: number;
  sessionToken?: string;
}

function requireSessionToken(sessionToken: string | undefined): string {
  if (!sessionToken) {
    throw new Error("Compose key sessionToken is required");
  }

  return sessionToken;
}

function syncBudgetState(response: Response): void {
  if (typeof window === "undefined") {
    return;
  }

  const budgetRemainingHeader = response.headers.get("x-compose-key-budget-remaining");
  const budgetUsedHeader = response.headers.get("x-compose-key-budget-used");
  const budgetLimitHeader = response.headers.get("x-compose-key-budget-limit");
  const budgetReservedHeader = response.headers.get("x-compose-key-budget-reserved");

  const budgetRemaining = budgetRemainingHeader ? Number.parseInt(budgetRemainingHeader, 10) : NaN;
  const budgetUsed = budgetUsedHeader ? Number.parseInt(budgetUsedHeader, 10) : NaN;
  const budgetLimit = budgetLimitHeader ? Number.parseInt(budgetLimitHeader, 10) : NaN;
  const budgetReserved = budgetReservedHeader ? Number.parseInt(budgetReservedHeader, 10) : NaN;

  if (Number.isFinite(budgetRemaining) && budgetRemaining >= 0) {
    window.dispatchEvent(
      new CustomEvent(SESSION_BUDGET_EVENT, {
        detail: {
          budgetRemaining,
          budgetUsed: Number.isFinite(budgetUsed) && budgetUsed >= 0 ? budgetUsed : undefined,
          budgetLimit: Number.isFinite(budgetLimit) && budgetLimit >= 0 ? budgetLimit : undefined,
          budgetReserved: Number.isFinite(budgetReserved) && budgetReserved >= 0 ? budgetReserved : undefined,
        },
      }),
    );
  }

  if (response.status === 401 || response.status === 402 || response.status === 403) {
    window.dispatchEvent(
      new CustomEvent(SESSION_INVALID_EVENT, {
        detail: { status: response.status },
      }),
    );
  }
}

export function createPaymentFetch(params: PaymentFetchParams): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const chainId = params.chainId;
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("chainId is required");
  }

  const sessionToken = requireSessionToken(params.sessionToken);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${sessionToken}`);
    headers.set("X-Chain-ID", String(chainId));

    const response = await fetch(input, {
      ...init,
      headers,
    });

    syncBudgetState(response);
    return response;
  };
}
