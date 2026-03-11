import { apiUrl } from "@/lib/api";

export interface BackpackConnectionInfo {
  slug: string;
  name: string;
  connected: boolean;
  accountId?: string;
  status?: string;
}

export function resolveBackpackUserId(preferred?: string | null): string {
  if (preferred && preferred.trim().length > 0) {
    return preferred;
  }

  const existing = sessionStorage.getItem("composio_anon_id");
  if (existing) {
    return existing;
  }

  const created = `anon_${crypto.randomUUID()}`;
  sessionStorage.setItem("composio_anon_id", created);
  return created;
}

export async function fetchBackpackConnections(userId: string): Promise<BackpackConnectionInfo[]> {
  const response = await fetch(
    apiUrl(`/api/backpack/connections?userId=${encodeURIComponent(userId)}`),
    { method: "GET" },
  );

  if (!response.ok) {
    throw new Error(`Failed to load Backpack connections (${response.status})`);
  }

  const payload = await response.json() as { connections?: BackpackConnectionInfo[] };
  return Array.isArray(payload.connections) ? payload.connections : [];
}
