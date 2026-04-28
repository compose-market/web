import * as filecoinPin from "filecoin-pin";
import { filecoin, filecoinCalibration } from "viem/chains";

type IdentityUpload = {
  cid: string;
  uri: string;
  name: string;
  type: string;
  size: number;
};

type IdentityArtifact = {
  version: "1.0.0";
  scope: "identity";
  agentWallet: string;
  source: IdentityUpload;
  chunks: Array<{
    index: number;
    content: string;
    embedding: number[];
  }>;
  createdAt: string;
};

const FILECOIN_NETWORK = (import.meta.env.VITE_FILECOIN_NETWORK || "calibration").toLowerCase();
const FILECOIN_RPC_URL = import.meta.env.VITE_FILECOIN_RPC_URL;
const FILECOIN_PRIVATE_KEY = normalizeHex(import.meta.env.VITE_FILECOIN_PRIVATE_KEY);
const VOYAGE_API_KEY = import.meta.env.VITE_MONGO_DB_API_KEY || import.meta.env.MONGO_DB_API_KEY || "";
const { checkUploadReadiness, createCarFromFile, executeUpload } = filecoinPin;

const backgroundQueue: Array<() => Promise<void>> = [];
let backgroundRunning = false;
let filecoinClientPromise: Promise<FilecoinClient> | null = null;

type FilecoinClient = Parameters<typeof executeUpload>[0];
type FilecoinBootstrap = (config: {
  privateKey: `0x${string}`;
  rpcUrl?: string;
  chain: typeof filecoin | typeof filecoinCalibration;
}) => Promise<FilecoinClient>;

function normalizeHex(value: string | undefined): `0x${string}` | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "knowledge";
}

function chunkKnowledgeText(text: string, maxChars = 1400, overlap = 180): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf("\n", end);
      if (boundary > start + Math.floor(maxChars * 0.5)) {
        end = boundary;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

async function getFilecoinClient() {
  if (!filecoinClientPromise) {
    if (!FILECOIN_PRIVATE_KEY) {
      throw new Error("VITE_FILECOIN_PRIVATE_KEY is required for Filecoin uploads");
    }

    const config = {
      privateKey: FILECOIN_PRIVATE_KEY,
      ...(FILECOIN_RPC_URL ? { rpcUrl: FILECOIN_RPC_URL } : {}),
      chain: FILECOIN_NETWORK === "mainnet" ? filecoin : filecoinCalibration,
    };

    filecoinClientPromise = getFilecoinBootstrap()(config);
  }

  return filecoinClientPromise;
}

function getFilecoinBootstrap(): FilecoinBootstrap {
  const candidates = Object.entries(filecoinPin).filter(
    ([key, value]) => key.startsWith("initialize") && typeof value === "function",
  );

  if (candidates.length !== 1) {
    throw new Error("filecoin-pin initializer export is unavailable");
  }

  return candidates[0][1] as unknown as FilecoinBootstrap;
}

async function ensureFilecoinUploadReady(client: FilecoinClient, fileSize: number) {
  return checkUploadReadiness({
    synapse: client,
    fileSize,
    autoConfigureAllowances: true,
  });
}

async function executeFilecoinUpload(
  client: FilecoinClient,
  carBytes: Uint8Array,
  rootCid: Awaited<ReturnType<typeof createCarFromFile>>["rootCid"],
  metadata: Record<string, string>,
) {
  return executeUpload(client, carBytes, rootCid, {
    logger: console as never,
    contextId: `compose-identity-${Date.now()}`,
    ipniValidation: { enabled: false },
    metadata,
  });
}

async function uploadFilecoinFile(file: File, metadata: Record<string, string>): Promise<string> {
  const client = await getFilecoinClient();
  const car = await createCarFromFile(file);
  const readiness = await ensureFilecoinUploadReady(client, car.carBytes.length);

  if (readiness.status !== "ready") {
    throw new Error(readiness.suggestions[0] || readiness.validation.errorMessage || "Filecoin upload is not ready");
  }

  await executeFilecoinUpload(client, car.carBytes, car.rootCid, metadata);

  return car.rootCid.toString();
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const documentInit = {
    data: new Uint8Array(await file.arrayBuffer()),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0];
  const document = await pdfjs.getDocument(documentInit).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) {
      pages.push(text);
    }
  }

  return pages.join("\n\n");
}

async function extractKnowledgeText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    return extractPdfText(file);
  }

  if (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".html") ||
    lowerName.endsWith(".xml")
  ) {
    return file.text();
  }

  throw new Error(`Unsupported identity file type: ${file.name}`);
}

async function embedKnowledgeChunks(chunks: string[]): Promise<number[][]> {
  if (!chunks.length) {
    return [];
  }

  if (!VOYAGE_API_KEY) {
    throw new Error("VITE_MONGO_DB_API_KEY is required for knowledge embeddings");
  }

  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: chunks,
      model: "voyage-4-large",
      input_type: "document",
      output_dimension: 1024,
    }),
  });

  if (!response.ok) {
    throw new Error(`Voyage embeddings failed (${response.status})`);
  }

  const payload = await response.json() as {
    data: Array<{ index: number; embedding: number[] }>;
  };

  return payload.data
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);
}

async function drainBackgroundQueue(): Promise<void> {
  if (backgroundRunning) {
    return;
  }

  backgroundRunning = true;
  try {
    while (backgroundQueue.length > 0) {
      const task = backgroundQueue.shift();
      if (!task) {
        continue;
      }
      try {
        await task();
      } catch (error) {
        console.error("[identity] background task failed", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    backgroundRunning = false;
  }
}

export function enqueueBackgroundTask(task: () => Promise<void>): void {
  backgroundQueue.push(task);
  void drainBackgroundQueue();
}

export { chunkKnowledgeText, embedKnowledgeChunks, extractKnowledgeText, uploadFilecoinFile };

export async function uploadIdentityFiles(files: File[], params: {
  agentName: string;
  agentWallet: string;
}): Promise<IdentityUpload[]> {
  if (files.length === 0) {
    return [];
  }

  const uploads = await Promise.all(files.map(async (file) => {
    const cid = await uploadFilecoinFile(file, {
      scope: "identity",
      agentWallet: params.agentWallet,
      agentName: params.agentName,
      sourceName: file.name,
    });

    const upload: IdentityUpload = {
      cid,
      uri: `ipfs://${cid}`,
      name: file.name,
      type: file.type,
      size: file.size,
    };

    enqueueBackgroundTask(async () => {
      const text = (await extractKnowledgeText(file)).trim();
      if (!text) {
        return;
      }

      const chunks = chunkKnowledgeText(text);
      if (chunks.length === 0) {
        return;
      }

      const embeddings = await embedKnowledgeChunks(chunks);
      const artifact: IdentityArtifact = {
        version: "1.0.0",
        scope: "identity",
        agentWallet: params.agentWallet,
        source: upload,
        chunks: chunks.map((content, index) => ({
          index: index + 1,
          content,
          embedding: embeddings[index],
        })),
        createdAt: new Date().toISOString(),
      };

      const artifactFile = new File(
        [JSON.stringify(artifact)],
        `${slugify(file.name)}.identity.json`,
        { type: "application/json" },
      );

      await uploadFilecoinFile(artifactFile, {
        scope: "identity-artifact",
        agentWallet: params.agentWallet,
        sourceCid: upload.cid,
        sourceName: file.name,
      });
    });

    return upload;
  }));

  return uploads;
}
