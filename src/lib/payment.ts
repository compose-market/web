/**
 * x402 Payment Utilities
 * 
 * Handles signature normalization for Avalanche Fuji compatibility.
 */

const AVALANCHE_FUJI_CHAIN_ID = 43113;

// Set to false to disable signature normalization
const ENABLE_SIGNATURE_NORMALIZATION = false;

/**
 * Normalizes ECDSA signature v value to legacy format (27/28)
 */
function normalizeSignatureV(signature: string, chainId: number): string {
  const cleanSig = signature.startsWith('0x') ? signature.slice(2) : signature;

  if (cleanSig.length !== 130) {
    return signature;
  }

  const vHex = cleanSig.slice(128);
  const vValue = parseInt(vHex, 16);

  let normalizedV: number;

  if (vValue === 0 || vValue === 1) {
    normalizedV = vValue + 27;
  } else if (vValue === 27 || vValue === 28) {
    normalizedV = vValue;
  } else if (vValue >= 35) {
    const yParity = (vValue - 35 - chainId * 2) % 2;
    normalizedV = yParity + 27;
  } else {
    normalizedV = vValue;
  }

  const prefix = signature.startsWith('0x') ? '0x' : '';
  return prefix + cleanSig.slice(0, 128) + normalizedV.toString(16).padStart(2, '0');
}

/**
 * Creates a fetch wrapper that normalizes payment signatures for Avalanche Fuji
 */
export function createNormalizedFetch(chainId: number = AVALANCHE_FUJI_CHAIN_ID): typeof fetch {
  return async (input, init) => {
    if (ENABLE_SIGNATURE_NORMALIZATION) {
      let paymentHeader: string | null = null;

      if (init?.headers instanceof Headers) {
        paymentHeader = init.headers.get('payment-signature') || init.headers.get('PAYMENT-SIGNATURE');
      } else if (typeof init?.headers === 'object' && init.headers !== null) {
        const headers = init.headers as Record<string, string>;
        paymentHeader = headers['payment-signature'] || headers['PAYMENT-SIGNATURE'];
      }

      if (paymentHeader) {
        try {
          const decoded = JSON.parse(atob(paymentHeader));

          if (decoded.payload?.signature) {
            const normalizedSig = normalizeSignatureV(decoded.payload.signature, chainId);
            decoded.payload.signature = normalizedSig;
            const normalizedPaymentHeader = btoa(JSON.stringify(decoded));

            if (init?.headers instanceof Headers) {
              init.headers.set('PAYMENT-SIGNATURE', normalizedPaymentHeader);
            } else if (typeof init?.headers === 'object' && init.headers !== null) {
              const headers = init.headers as Record<string, string>;
              delete headers['payment-signature'];
              delete headers['PAYMENT-SIGNATURE'];
              headers['PAYMENT-SIGNATURE'] = normalizedPaymentHeader;
            }
          }
        } catch {
          // Ignore normalization errors
        }
      }
    }

    return fetch(input, init);
  };
}
