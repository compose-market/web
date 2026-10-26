import type { QueryClient } from "@tanstack/react-query";
import type {
  ChannelName,
  ChannelStatusResponse,
} from "@compose-market/sdk";
import { hasSessionAuth, sdk, RUNTIME_BASE_URL } from "@/lib/sdk";
import { CHANNELS_BASE_URL } from "@/lib/performance/urls";
import { readOwnerSnapshot, writeOwnerSnapshot } from "@/lib/cache";

export type NotificationsPayload = Awaited<ReturnType<typeof sdk.notifications.list>>;

export interface BackpackConnectionInfo {
  slug: string;
  name: string;
  connected: boolean;
  granted?: boolean;
  accountId?: string;
  connectedAccountId?: string;
  status?: string;
}

export interface BackpackConnectorVarSpec {
  varName: string;
  description?: string;
  obtainUrl?: string;
}

export interface BackpackConnectorRow {
  slug: string;
  name: string;
  connected: boolean;
  allowed: boolean;
  status: string;
  missingVars: BackpackConnectorVarSpec[];
  actions?: string[];
}

export type BackpackChannelStatusMap = Partial<Record<ChannelName, ChannelStatusResponse>>;

export const BACKPACK_CLOUD_PERMISSION_TYPES = [
  "filesystem",
  "camera",
  "microphone",
  "geolocation",
  "clipboard",
  "notifications",
] as const;

export type BackpackCloudPermission = typeof BACKPACK_CLOUD_PERMISSION_TYPES[number];

export const BACKPACK_STALE_TIME = 60_000;
export const BACKPACK_GC_TIME = 15 * 60 * 1000;

function isBackpackCloudPermission(value: string): value is BackpackCloudPermission {
  return BACKPACK_CLOUD_PERMISSION_TYPES.includes(value as BackpackCloudPermission);
}

function normalizeWalletKey(address: string): string {
  const trimmed = address.trim();
  return /^0x[a-f0-9]{40}$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function permissionStorageKey(agentWallet: string, permission: BackpackCloudPermission, userAddress?: string | null): string {
  const scope = userAddress ? `${normalizeWalletKey(userAddress)}_` : "";
  return `consent_${scope}${normalizeWalletKey(agentWallet)}_${permission}`;
}

export function getCachedPermissions(agentWallet?: string | null, userAddress?: string | null): BackpackCloudPermission[] {
  if (!agentWallet) return [];
  if (userAddress) {
    const snap = readOwnerSnapshot<BackpackCloudPermission[]>("backpack-permissions", userAddress, agentWallet);
    if (snap && Array.isArray(snap.data)) {
      return snap.data.filter(isBackpackCloudPermission);
    }
  }
  return BACKPACK_CLOUD_PERMISSION_TYPES.filter((permission) => (
    sessionStorage.getItem(permissionStorageKey(agentWallet, permission, userAddress)) === "granted"
  ));
}

export function getCachedBackpackPermissions(agentWallet?: string | null): BackpackCloudPermission[] {
  if (!agentWallet) return [];
  return BACKPACK_CLOUD_PERMISSION_TYPES.filter((permission) => (
    sessionStorage.getItem(permissionStorageKey(agentWallet, permission)) === "granted"
  ));
}

export function cacheBackpackPermission(
  agentWallet: string,
  permission: BackpackCloudPermission,
  granted: boolean,
  userAddress?: string | null,
): void {
  const key = permissionStorageKey(agentWallet, permission, userAddress);
  if (granted) {
    sessionStorage.setItem(key, "granted");
  } else {
    sessionStorage.removeItem(key);
  }
  if (userAddress) {
    const current = new Set(getCachedPermissions(agentWallet, userAddress));
    if (granted) current.add(permission);
    else current.delete(permission);
    writeOwnerSnapshot("backpack-permissions", userAddress, [...current], agentWallet);
  }
}

export function resolveBackpackUserId(preferred?: string | null): string {
  return preferred && preferred.trim().length > 0 ? preferred.trim() : "";
}

// =============================================================================
// Query Keys
// =============================================================================

export function notificationsQueryKey(userAddress: string) {
  return ["notifications", normalizeWalletKey(userAddress)] as const;
}

export function backpackAccountsQueryKey(userAddress: string) {
  return ["backpack", "accounts", normalizeWalletKey(userAddress)] as const;
}

export function backpackConnectorsQueryKey(userAddress: string) {
  return ["backpack", "connectors", normalizeWalletKey(userAddress)] as const;
}

export function backpackChannelsQueryKey(userAddress: string, agentWallet: string) {
  return ["backpack", "channels", normalizeWalletKey(userAddress), normalizeWalletKey(agentWallet)] as const;
}

export function backpackPermissionsQueryKey(userAddress: string, agentWallet: string) {
  return ["backpack", "permissions", normalizeWalletKey(userAddress), normalizeWalletKey(agentWallet)] as const;
}

export async function fetchBackpackConnections(userAddress: string, agentWallet: string): Promise<BackpackConnectionInfo[]> {
  const payload = await sdk.accounts.list({ userAddress, agentWallet }) as { connections?: BackpackConnectionInfo[] };
  return Array.isArray(payload.connections) ? payload.connections : [];
}

export async function fetchBackpackPermissions(userAddress: string, agentWallet: string): Promise<BackpackCloudPermission[]> {
  const payload = await sdk.permissions.list({ userAddress, agentWallet }) as {
    permissions?: Array<{ consentType?: string; granted?: boolean }>;
  };

  const granted = Array.isArray(payload.permissions)
    ? payload.permissions
      .filter((permission) => permission.granted && typeof permission.consentType === "string" && isBackpackCloudPermission(permission.consentType))
      .map((permission) => permission.consentType as BackpackCloudPermission)
    : [];

  BACKPACK_CLOUD_PERMISSION_TYPES.forEach((permission) => {
    cacheBackpackPermission(agentWallet, permission, granted.includes(permission));
  });

  return granted;
}

export async function grantBackpackPermission(userAddress: string, agentWallet: string, consentType: BackpackCloudPermission): Promise<void> {
  await sdk.permissions.grant({ userAddress, agentWallet, consentType });
  cacheBackpackPermission(agentWallet, consentType, true);
}

export async function revokeBackpackPermission(userAddress: string, agentWallet: string, consentType: BackpackCloudPermission): Promise<void> {
  await sdk.permissions.revoke({ userAddress, agentWallet, consentType });
  cacheBackpackPermission(agentWallet, consentType, false);
}
