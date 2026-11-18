import { sdk } from "./sdk";
import { chunkKnowledgeText, extractKnowledgeText } from "./identity";

type WorkspaceUploadResult = {
  indexed: number;
  documents: Array<{ key: string }>;
};

const RUNTIME_URL = (import.meta.env.VITE_RUNTIME_URL || "https://runtime.compose.market").replace(/\/+$/, "");

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "workspace";
}

/**
 * Extract & chunk private workspace files in the browser, then delegate
 * vector embedding and storage to the authenticated Runtime `/api/workspace/index`
 * endpoint so zero API secrets ever enter the client bundle.
 */
export async function uploadWorkspaceFiles(files: File[], params: {
  agentWallet: string;
  userAddress: string;
}): Promise<WorkspaceUploadResult> {
  if (files.length === 0) {
    return { indexed: 0, documents: [] };
  }

  const prepared = await Promise.all(files.map(async (file) => {
    const text = (await extractKnowledgeText(file)).trim();
    if (!text) {
      return null;
    }

    const chunks = chunkKnowledgeText(text);
    if (chunks.length === 0) {
      return null;
    }

    return {
      file,
      chunks,
    };
  }));

  const documents = prepared
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .flatMap((item) => item.chunks.map((content, index) => ({
      content,
      key: `${slugify(item.file.name)}-${index + 1}`,
      source: "file" as const,
      metadata: {
        name: item.file.name,
        mimeType: item.file.type,
        size: item.file.size,
        chunk: index + 1,
        scope: "workspace",
      },
    })));

  if (documents.length === 0) {
    throw new Error("No readable workspace content found in the selected files");
  }

  // Runtime expects the same Compose Key JWT contract as the gateway.
  // `sdk.fetch` attaches Authorization / x-session-user-address / x-network-id automatically.
  const response = await sdk.fetch(`${RUNTIME_URL}/api/workspace/index`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agentWallet: params.agentWallet,
      documents,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Workspace indexing failed (${response.status}): ${error || response.statusText}`);
  }

  return await response.json() as WorkspaceUploadResult;
}
