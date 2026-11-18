import {
  Binary,
  Braces,
  FileText,
  Image as ImageIcon,
  Languages,
  ListTree,
  MessageSquare,
  Mic,
  Search,
  Sparkles,
  Tags,
  Video,
  type LucideIcon,
} from "lucide-react";

export type ModalityIcon =
  | "binary"
  | "braces"
  | "fileText"
  | "image"
  | "languages"
  | "listTree"
  | "messageSquare"
  | "mic"
  | "search"
  | "sparkles"
  | "tags"
  | "video";

export type ModalityTone =
  | "audio"
  | "classification"
  | "conversational"
  | "embedding"
  | "image"
  | "research"
  | "summarization"
  | "text"
  | "translation"
  | "video"
  | "all"
  | "unknown";

function normalizedType(typeId: string): string {
  return typeId.trim().toLowerCase();
}

export function typeTone(typeId: string): ModalityTone {
  if (typeId === "all") return "all";
  const id = normalizedType(typeId);

  if (id.includes("text-generation") || id.includes("text2text")) return "text";
  if (id.includes("chat")) return "text";
  if (id.includes("image")) return "image";
  if (id.includes("audio") || id.includes("speech")) return "audio";
  if (id.includes("video")) return "video";
  if (id.includes("embedding") || id.includes("feature")) return "embedding";
  if (id.includes("conversational")) return "conversational";
  if (id.includes("classification")) return "classification";
  if (id.includes("translation")) return "translation";
  if (id.includes("summarization")) return "summarization";
  if (id.includes("research")) return "research";
  if (id.includes("text")) return "text";

  return "unknown";
}

export function typeClass(typeId: string): string {
  const tone = typeTone(typeId);
  if (tone === "all" || tone === "unknown") return "";
  return `cm-type--${tone}`;
}

export function typeIconName(typeId: string): ModalityIcon {
  if (typeId === "all") return "sparkles";
  const id = normalizedType(typeId);

  if (id.includes("image")) return "image";
  if (id.includes("audio") || id.includes("speech")) return "mic";
  if (id.includes("video")) return "video";
  if (id.includes("embedding") || id.includes("feature")) return "braces";
  if (id.includes("classification")) return "tags";
  if (id.includes("translation")) return "languages";
  if (id.includes("summarization")) return "listTree";
  if (id.includes("research")) return "search";
  if (id.includes("conversational") || id.includes("chat")) return "messageSquare";
  if (id.includes("text-generation") || id.includes("text2text") || id.includes("text")) return "fileText";

  return "binary";
}

export function typeLabel(label: string): string {
  if (label === "All Models") return "All";
  return label
    .replace("Text Generation", "Text Gen")
    .replace("Text2text Generation", "Text2Text")
    .replace("Text To Image", "Image")
    .replace("Image To Image", "Img2Img")
    .replace("Text To Video", "Video")
    .replace("Text To Audio", "Audio")
    .replace("Text To Speech", "TTS")
    .replace("Automatic Speech Recognition", "ASR")
    .replace("Speech To Text", "STT")
    .replace("Feature Extraction", "Embedding")
    .replace("Sentence Similarity", "Similarity")
    .replace("Text Classification", "Classify")
    .replace("Image Classification", "Img Classify")
    .replace("Deep Research", "Research");
}

const icons: Record<ModalityIcon, LucideIcon> = {
  binary: Binary,
  braces: Braces,
  fileText: FileText,
  image: ImageIcon,
  languages: Languages,
  listTree: ListTree,
  messageSquare: MessageSquare,
  mic: Mic,
  search: Search,
  sparkles: Sparkles,
  tags: Tags,
  video: Video,
};

export function typeIcon(typeId: string, className = "cm-type-icon") {
  const Icon = icons[typeIconName(typeId)];
  return <Icon className={className} />;
}
