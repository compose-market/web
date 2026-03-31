/**
 * CapabilityChips — TWO distinct chip groups in a single row
 *
 * Left: Type chips (Text, Image, Audio, Video, etc.) with type-matched colors
 * Right: Provider chips (OpenAI, Anthropic, etc.) with accent color
 * Separated by a labeled divider.
 */
import { useMemo } from "react";
import type { ModelCategory } from "@/lib/models";

interface CapabilityChipsProps {
  selectedType: string;
  onTypeChange: (type: string) => void;
  typeCategories: ModelCategory[];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  providerCategories: ModelCategory[];
}

/** Map type ID → CSS color modifier class */
function getTypeColorClass(typeId: string): string {
  if (typeId === "all") return "";
  const id = typeId.toLowerCase();
  if (id.includes("text-generation") || id.includes("text2text")) return "cm-playground__chip--type-text";
  if (id.includes("chat")) return "cm-playground__chip--type-text";
  if (id.includes("image")) return "cm-playground__chip--type-image";
  if (id.includes("audio") || id.includes("speech")) return "cm-playground__chip--type-audio";
  if (id.includes("video")) return "cm-playground__chip--type-video";
  if (id.includes("embedding") || id.includes("feature")) return "cm-playground__chip--type-embedding";
  if (id.includes("conversational")) return "cm-playground__chip--type-conversational";
  if (id.includes("classification")) return "cm-playground__chip--type-classification";
  if (id.includes("translation")) return "cm-playground__chip--type-translation";
  if (id.includes("summarization")) return "cm-playground__chip--type-summarization";
  if (id.includes("research")) return "cm-playground__chip--type-research";
  return "";
}

function compactTypeLabel(label: string): string {
  if (label === "All Models") return "All";
  // Shorten common long labels
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

function compactProviderLabel(label: string): string {
  if (label === "All Providers") return "All";
  // Capitalize first letter
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function CapabilityChips({
  selectedType,
  onTypeChange,
  typeCategories,
  selectedProvider,
  onProviderChange,
  providerCategories,
}: CapabilityChipsProps) {
  // Show top providers (limit to 10 + All)
  const displayProviders = useMemo(() => {
    if (providerCategories.length <= 11) return providerCategories;
    return providerCategories.slice(0, 11);
  }, [providerCategories]);

  return (
    <div className="cm-playground__chips">
      {/* ── Type Chips ── */}
      <span className="cm-playground__chip-label">Type</span>
      <div className="cm-playground__chip-section cm-playground__chip-section--types">
        {typeCategories.map((cat) => {
          const isActive = selectedType === cat.id;
          const colorClass = getTypeColorClass(cat.id);
          return (
            <button
              key={`t-${cat.id}`}
              className={[
                "cm-playground__chip",
                colorClass,
                isActive ? "cm-playground__chip--active" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onTypeChange(cat.id)}
              type="button"
            >
              {compactTypeLabel(cat.label)}
              <span className="cm-playground__chip-count">{cat.count}</span>
            </button>
          );
        })}
      </div>

      {/* ── Divider ── */}
      <div className="cm-playground__divider" />

      {/* ── Provider Chips ── */}
      <span className="cm-playground__chip-label">Provider</span>
      <div className="cm-playground__chip-section cm-playground__chip-section--providers">
        {displayProviders.map((cat) => {
          const isActive = selectedProvider === cat.id;
          return (
            <button
              key={`p-${cat.id}`}
              className={[
                "cm-playground__chip",
                "cm-playground__chip--provider",
                isActive ? "cm-playground__chip--active" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onProviderChange(cat.id)}
              type="button"
            >
              {compactProviderLabel(cat.label)}
              <span className="cm-playground__chip-count">{cat.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
