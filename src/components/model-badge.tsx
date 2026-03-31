/**
 * ModelBadge — Shows model name + capability tags (colored) + price
 * Capabilities shown as inline colored mini-tags (text, image, audio, etc.)
 */
import { formatModelTypeLabel, getPrimaryModelType, getDefaultModelPricingSections, getModelTypeValues } from "@/lib/models";
import type { CatalogModel } from "@/lib/models";

interface ModelBadgeProps {
  model: CatalogModel | null;
  onClick: () => void;
}

function formatBadgePrice(model: CatalogModel): string {
  const sections = getDefaultModelPricingSections(model);
  if (sections.length === 0) return "—";
  for (const section of sections) {
    for (const entry of section.entries) {
      const label = entry.label.toLowerCase();
      if (label.includes("input") || label.includes("prompt") || label.includes("cost") || label.includes("generation") || label.includes("megapixel") || label.includes("second")) {
        const val = parseFloat(entry.value);
        if (val === 0) return "FREE";
        if (Number.isFinite(val)) {
          if (val < 0.001) return `$${val.toFixed(5)}`;
          if (val < 1) return `$${val.toFixed(3)}`;
          return `$${val.toFixed(2)}`;
        }
      }
    }
  }
  return "—";
}

/** Map capability keywords to CSS color modifier */
function getCapClass(cap: string): string {
  const c = cap.toLowerCase();
  if (c.includes("image")) return "cm-playground__cap-tag--image";
  if (c.includes("audio") || c.includes("speech")) return "cm-playground__cap-tag--audio";
  if (c.includes("video")) return "cm-playground__cap-tag--video";
  if (c.includes("embed") || c.includes("feature")) return "cm-playground__cap-tag--embedding";
  if (c.includes("code")) return "cm-playground__cap-tag--code";
  return "cm-playground__cap-tag--text";
}

/** Compact capability label */
function capLabel(cap: string): string {
  const c = cap.toLowerCase();
  if (c === "chat-completions") return "text";
  if (c === "text-generation") return "text";
  if (c === "text2text-generation") return "text";
  if (c.includes("text-to-image") || c.includes("text2image")) return "img";
  if (c.includes("image-to-image")) return "img2img";
  if (c.includes("image") && c.includes("class")) return "img-cls";
  if (c.includes("text-to-video")) return "video";
  if (c.includes("text-to-audio")) return "audio";
  if (c.includes("text-to-speech")) return "tts";
  if (c.includes("speech") || c.includes("asr")) return "stt";
  if (c.includes("embed") || c.includes("feature")) return "embed";
  if (c.includes("code")) return "code";
  if (c.includes("research")) return "research";
  if (c.includes("translation")) return "xlat";
  if (c.includes("summarization")) return "summary";
  if (c.includes("classification")) return "classify";
  // Shorten
  return cap.replace(/-/g, " ").split(" ").map(w => w.slice(0, 4)).join("");
}

export function ModelBadge({ model, onClick }: ModelBadgeProps) {
  if (!model) {
    return (
      <button className="cm-playground__badge" onClick={onClick} type="button">
        <span className="cm-playground__badge-name" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>
          Select model…
        </span>
        <span className="cm-playground__badge-shortcut">⌘K</span>
      </button>
    );
  }

  const price = formatBadgePrice(model);

  return (
    <button className="cm-playground__badge" onClick={onClick} type="button" title={`${model.modelId} · ${model.provider}`}>
      <span className="cm-playground__badge-dot" />
      <span className="cm-playground__badge-name">{model.name || model.modelId}</span>
      <span className="cm-playground__badge-price">{price}</span>
      <span className="cm-playground__badge-shortcut">⌘K</span>
    </button>
  );
}
