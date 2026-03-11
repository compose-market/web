export interface MintShareData {
  type: 'agent' | 'workflow';
  name: string;
  walletAddress: string;
  txHash: string;
  chainId: number;
}

const STORAGE_KEY = 'compose_mint_share';

export function saveMintSuccessForShare(data: MintShareData): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save mint share data:', e);
  }
}

export function getMintSuccessForShare(): MintShareData | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as MintShareData;
    }
  } catch (e) {
    console.warn('Failed to retrieve mint share data:', e);
  }
  return null;
}

export function clearMintSuccessShare(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear mint share data:', e);
  }
}

export function buildShareIntentUrl(name: string, type: 'agent' | 'workflow', walletAddress: string): string {
  const text = `I've just built ${name} on compose.market! Come try it out`;
  const url = `https://compose.market/${type}/${walletAddress}`;
  const params = new URLSearchParams({
    text,
    url,
  });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}