import { createPaymentFetch } from "./payment";
import {
  chunkKnowledgeText,
  embedKnowledgeChunks,
  enqueueBackgroundTask,
  extractKnowledgeText,
  uploadFilecoinFile,
} from "./identity";

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

export async function uploadWorkspaceFiles(files: File[], params: {
  agentWallet: string;
  chainId: number;
  sessionToken: string;
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

    const embeddings = await embedKnowledgeChunks(chunks);
    return {
      file,
      chunks,
      embeddings,
    };
  }));

  const documents = prepared
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .flatMap((item) => item.chunks.map((content, index) => ({
      content,
      key: `${slugify(item.file.name)}-${index + 1}`,
      source: "file" as const,
      embedding: item.embeddings[index],
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

  const fetchWithPayment = createPaymentFetch({
    chainId: params.chainId,
    sessionToken: params.sessionToken,
  });

  const response = await fetchWithPayment(`${RUNTIME_URL}/api/workspace/index`, {
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

  const result = await response.json() as WorkspaceUploadResult;

  prepared
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .forEach((item) => {
      enqueueBackgroundTask(async () => {
        const artifact = {
          version: "1.0.0",
          scope: "workspace",
          agentWallet: params.agentWallet,
          userAddress: params.userAddress,
          source: {
            name: item.file.name,
            type: item.file.type,
            size: item.file.size,
          },
          chunks: item.embeddings.map((embedding, index) => ({
            index: index + 1,
            embedding,
          })),
          createdAt: new Date().toISOString(),
        };

        const artifactFile = new File(
          [JSON.stringify(artifact)],
          `${slugify(item.file.name)}.workspace.json`,
          { type: "application/json" },
        );

        await uploadFilecoinFile(artifactFile, {
          scope: "workspace-artifact",
          agentWallet: params.agentWallet,
          userAddress: params.userAddress,
          sourceName: item.file.name,
        });
      });
    });

  return result;
}
