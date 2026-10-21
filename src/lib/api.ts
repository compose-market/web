type SdkFetchInit = Parameters<typeof import("./sdk").sdk.fetch>[1];

export function normalizeSdkFetchInit(init?: RequestInit): SdkFetchInit {
  if (!init) {
    return undefined;
  }
  if (init.signal === null) {
    const { signal: _signal, ...rest } = init;
    return rest as SdkFetchInit;
  }
  return init as SdkFetchInit;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const { sdk } = await import("./sdk");
  return sdk.fetch(path, normalizeSdkFetchInit(init));
}
