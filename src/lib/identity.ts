import { uploadFile } from "./pinata";

export type IdentityUpload = {
  cid: string;
  uri: string;
  name: string;
  type: string;
  size: number;
};

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

export { chunkKnowledgeText, extractKnowledgeText };

/**
 * Pin identity files through the server-side `/api/ipfs/pin/file` proxy
 * (zero private keys or embedding API keys in the browser bundle).
 * Runtime indexes genesis knowledge from the resulting IPFS CIDs server-side.
 */
export async function uploadIdentityFiles(files: File[], params: {
  agentName: string;
  agentWallet: string;
}): Promise<IdentityUpload[]> {
  if (files.length === 0) {
    return [];
  }

  return Promise.all(files.map(async (file) => {
    const cid = await uploadFile(file, {
      name: file.name,
      keyvalues: {
        scope: "identity",
        agentWallet: params.agentWallet,
        agentName: params.agentName,
        sourceName: file.name,
      },
    });

    return {
      cid,
      uri: `ipfs://${cid}`,
      name: file.name,
      type: file.type,
      size: file.size,
    };
  }));
}
