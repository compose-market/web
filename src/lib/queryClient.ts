import { QueryClient, QueryFunction } from "@tanstack/react-query";
import {
  persistQueryClientSave,
  type PersistedClient,
  type Persister,
} from "@tanstack/react-query-persist-client";
import { apiFetch } from "@/lib/api";

export const DURABLE_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
export const durableQueryMeta = { persist: true } as const;

export function shouldPersistQuery(query: {
  meta?: Record<string, unknown>;
  state: { status: string };
}): boolean {
  return query.meta?.persist === true && query.state.status === "success";
}

const DATABASE_NAME = "query-cache";
const STORE_NAME = "query-cache";
const CLIENT_KEY = "durable-client";

function openCacheDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the durable query cache"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

export const indexedDbQueryPersister: Persister = {
  async persistClient(client: PersistedClient): Promise<void> {
    const database = await openCacheDatabase();
    if (!database) return;
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(client, CLIENT_KEY);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  },
  async restoreClient(): Promise<PersistedClient | undefined> {
    const database = await openCacheDatabase();
    if (!database) return undefined;
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const client = await requestResult(transaction.objectStore(STORE_NAME).get(CLIENT_KEY));
      await transactionDone(transaction);
      return client as PersistedClient | undefined;
    } finally {
      database.close();
    }
  },
  async removeClient(): Promise<void> {
    const database = await openCacheDatabase();
    if (!database) return;
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(CLIENT_KEY);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  },
};

const dehydrateOptions = {
  shouldDehydrateQuery: shouldPersistQuery,
  shouldDehydrateMutation: () => false,
};

export const queryPersistenceOptions = {
  persister: indexedDbQueryPersister,
  maxAge: DURABLE_CACHE_MAX_AGE,
  dehydrateOptions,
};

export async function persistDurableQueries(client: QueryClient): Promise<void> {
  await persistQueryClientSave({
    queryClient: client,
    persister: indexedDbQueryPersister,
    dehydrateOptions,
  });
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await apiFetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      const res = await apiFetch(queryKey.join("/") as string, {});

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
      gcTime: DURABLE_CACHE_MAX_AGE,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
