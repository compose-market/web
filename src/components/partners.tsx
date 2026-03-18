import { useRef, useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/* ── Partnership Badge ─────────────────────────────────────────────── */

interface PartnershipBadgeProps {
  src: string;
  alt: string;
  className?: string;
  glowColor?: "cyan" | "green" | "purple" | "blue";
  link?: string;
}

const glowColors = {
  cyan: {
    border: "border-cyan-500/40",
    cornerColor: "hsl(188 95% 43%)",
    pulseColor: "rgba(6,182,212,0.4)",
  },
  green: {
    border: "border-green-500/40",
    cornerColor: "hsl(142 71% 45%)",
    pulseColor: "rgba(34,197,94,0.4)",
  },
  purple: {
    border: "border-purple-500/40",
    cornerColor: "hsl(270 91% 65%)",
    pulseColor: "rgba(168,85,247,0.4)",
  },
  blue: {
    border: "border-blue-500/40",
    cornerColor: "hsl(217 91% 60%)",
    pulseColor: "rgba(59,130,246,0.4)",
  },
};

export function PartnershipBadge({
  src,
  alt,
  className,
  glowColor = "cyan",
  link,
}: PartnershipBadgeProps) {
  const colors = glowColors[glowColor];

  const content = (
    <div
      className={cn(
        "relative group cursor-pointer transition-all duration-500",
        className
      )}
    >
      {/* Outer glow */}
      <div
        className="absolute -inset-1 rounded-lg opacity-60 group-hover:opacity-100 blur transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse at center, ${colors.pulseColor}, transparent 70%)`,
        }}
      />

      {/* Badge container — image-only, uniform height */}
      <div
        className={cn(
          "relative overflow-hidden rounded-lg",
          "glass-panel",
          colors.border,
          "transition-all duration-500",
          "w-full h-full flex items-center justify-center"
        )}
      >
        {/* Hover shine */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{
            background: `linear-gradient(135deg, ${colors.pulseColor}, transparent 50%)`,
          }}
        />

        {/* Scanline effect */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute w-full h-[100px] opacity-[0.04]"
            style={{
              background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.08), transparent)",
              animation: "partner-scanline 4s linear infinite",
            }}
          />
        </div>

        {/* Corner decorations */}
        <div className="relative p-2.5 sm:p-3 md:p-4 flex items-center justify-center w-full h-full">
          <div
            className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 transition-all duration-300 group-hover:w-6 group-hover:h-6"
            style={{ borderColor: colors.cornerColor, opacity: 0.6 }}
          />
          <div
            className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 transition-all duration-300 group-hover:w-6 group-hover:h-6"
            style={{ borderColor: colors.cornerColor, opacity: 0.6 }}
          />
          <div
            className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 transition-all duration-300 group-hover:w-6 group-hover:h-6"
            style={{ borderColor: colors.cornerColor, opacity: 0.6 }}
          />
          <div
            className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 transition-all duration-300 group-hover:w-6 group-hover:h-6"
            style={{ borderColor: colors.cornerColor, opacity: 0.6 }}
          />

          {/* Badge image — centered, uniform */}
          <img
            src={src}
            alt={alt}
            className="relative h-10 sm:h-12 md:h-14 w-auto max-w-[90%] object-contain brightness-100 group-hover:brightness-110 transition-all duration-300"
          />
        </div>

        {/* Shimmer line */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1500 ease-in-out" />
        </div>

        {/* Bottom glow line */}
        <div
          className="absolute bottom-0 left-0 right-0 h-px opacity-30 group-hover:opacity-60 transition-opacity"
          style={{
            background: `linear-gradient(90deg, transparent, ${colors.cornerColor}, transparent)`,
          }}
        />
      </div>
    </div>
  );

  if (link) {
    return (
      <a href={link} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0">
        {content}
      </a>
    );
  }

  return content;
}

/* ── Partner Logo Data ─────────────────────────────────────────────── */

interface PartnerLogo {
  src: string;
  alt: string;
  name: string;
}

const partnerLogos: PartnerLogo[] = [
  { src: "/partners/11labs.png", alt: "ElevenLabs", name: "ElevenLabs" },
  { src: "/partners/aiven.png", alt: "AIven", name: "AIven" },
  { src: "/partners/algolia.svg", alt: "Algolia", name: "Algolia" },
  { src: "/partners/alibaba.png", alt: "Alibaba Cloud", name: "Alibaba Cloud" },
  { src: "/partners/anam.png", alt: "Anam", name: "Anam" },
  { src: "/partners/apify.svg", alt: "Apify", name: "Apify" },
  // { src: "/partners/arize.png", alt: "Arize", name: "Arize" },
  { src: "/partners/asicloud.png", alt: "ASI:Cloud", name: "ASI:Cloud" },
  { src: "/partners/avalanche.svg", alt: "Avalanche", name: "Avalanche" },
  { src: "/partners/azure-ai.png", alt: "Azure AI", name: "Azure AI" },
  { src: "/partners/cartesia.png", alt: "Cartesia", name: "Cartesia" },
  { src: "/partners/chaingpt.png", alt: "ChainGPT", name: "ChainGPT" },
  { src: "/partners/chroma.png", alt: "ChromaDB", name: "ChromaDB" },
  { src: "/partners/cloudflare.png", alt: "Cloudflare", name: "Cloudflare" },
  { src: "/partners/confluent.png", alt: "Confluent", name: "Confluent" },
  { src: "/partners/confidence.png", alt: "Confidence", name: "Confidence" },
  // { src: "/partners/contextual-ai.png", alt: "Contextual AI", name: "Contextual AI" },
  { src: "/partners/couchbase.png", alt: "Couchbase", name: "Couchbase" },
  { src: "/partners/datadog.png", alt: "Datadog", name: "Datadog" },
  { src: "/partners/daytona.svg", alt: "Daytona", name: "Daytona" },
  { src: "/partners/deepgram.png", alt: "Deepgram", name: "Deepgram" },
  { src: "/partners/digitalocean.png", alt: "DigitalOcean", name: "DigitalOcean" },
  // { src: "/partners/fal.png", alt: "Fal AI", name: "Fal AI" },
  { src: "/partners/fireworks-ai.png", alt: "Fireworks AI", name: "Fireworks AI" },
  // { src: "/partners/framer.png", alt: "Framer", name: "Framer" },
  { src: "/partners/huggingface.png", alt: "Hugging Face", name: "Hugging Face" },
  { src: "/partners/intercom.png", alt: "Intercom", name: "Intercom" },
  { src: "/partners/lambda.png", alt: "Lambda AI", name: "Lambda AI" },
  { src: "/partners/langchain.png", alt: "LangChain", name: "LangChain" },
  { src: "/partners/linkup.png", alt: "Linkup", name: "Linkup" },
  { src: "/partners/massive.png", alt: "Massive", name: "Massive" },
  { src: "/partners/mem0.png", alt: "Mem0", name: "Mem0" },
  { src: "/partners/mixpanel.png", alt: "Mixpanel", name: "Mixpanel" },
  { src: "/partners/modal.png", alt: "Modal", name: "Modal" },
  { src: "/partners/mongodb.png", alt: "MongoDB", name: "MongoDB" },
  { src: "/partners/neo4j.png", alt: "Neo4j", name: "Neo4j" },
  { src: "/partners/neon.png", alt: "Neon", name: "Neon" },
  { src: "/partners/nvidia.png", alt: "NVIDIA", name: "NVIDIA" },
  { src: "/partners/openai.png", alt: "OpenAI", name: "OpenAI" },
  { src: "/partners/perplexity.png", alt: "Perplexity", name: "Perplexity" },
  // { src: "/partners/qdrant.svg", alt: "Qdrant", name: "Qdrant" },
  { src: "/partners/quicknode.png", alt: "Quicknode", name: "Quicknode" },
  { src: "/partners/redis.png", alt: "Redis", name: "Redis" },
  { src: "/partners/roboflow.png", alt: "Roboflow", name: "Roboflow" },
  // { src: "/partners/solo.png", alt: "Solo AI", name: "Solo AI" },
  { src: "/partners/telnyx.png", alt: "Telnyx", name: "Telnyx" },
  { src: "/partners/temporal.png", alt: "Temporal", name: "Temporal" },
  { src: "/partners/thirdweb.png", alt: "Thirdweb", name: "Thirdweb" },
  { src: "/partners/vertex-ai.png", alt: "Vertex AI", name: "Vertex AI" },
];

/* ── Infinite Marquee ──────────────────────────────────────────────── */

function LogoItem({ logo }: { logo: PartnerLogo }) {
  return (
    <div
      className="group flex h-10 sm:h-11 items-center justify-center rounded-lg border border-sidebar-border/70 bg-black/20 px-4 sm:px-5 transition-all duration-300 hover:border-cyan-400/60 hover:bg-black/35 shrink-0"
    >
      <img
        src={logo.src}
        alt={logo.alt}
        title={logo.name}
        draggable={false}
        className="h-[clamp(0.85rem,1.8vw,1.25rem)] w-auto max-w-[100px] object-contain opacity-75 grayscale transition-all duration-300 group-hover:opacity-100 group-hover:grayscale-0"
      />
    </div>
  );
}

function PartnerLogoMarquee() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Split logos into two rows for visual interest
  const midpoint = Math.ceil(partnerLogos.length / 2);
  const topLogos = partnerLogos.slice(0, midpoint);
  const bottomLogos = partnerLogos.slice(midpoint);

  return (
    <div
      ref={containerRef}
      className="marquee-container relative w-full overflow-hidden"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      {/* Fade masks — left and right */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-12 sm:w-16 md:w-24 z-10"
        style={{
          background: "linear-gradient(to right, hsl(222 47% 3%), transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-12 sm:w-16 md:w-24 z-10"
        style={{
          background: "linear-gradient(to left, hsl(222 47% 3%), transparent)",
        }}
      />

      {/* Top row — scrolls left */}
      <div className="flex w-max">
        <div
          className="marquee-track flex gap-2.5 sm:gap-3"
          style={{
            animationDuration: "80s",
            animationPlayState: isPaused ? "paused" : "running",
          } as CSSProperties}
        >
          {topLogos.map((logo, i) => (
            <LogoItem key={`top-a-${i}`} logo={logo} />
          ))}
          {/* Duplicate for seamless loop */}
          {topLogos.map((logo, i) => (
            <LogoItem key={`top-b-${i}`} logo={logo} />
          ))}
        </div>
      </div>

      {/* Bottom row — scrolls right (reverse direction) */}
      <div className="flex w-max mt-2.5 sm:mt-3">
        <div
          className="marquee-track-reverse flex gap-2.5 sm:gap-3"
          style={{
            animationDuration: "90s",
            animationPlayState: isPaused ? "paused" : "running",
          } as CSSProperties}
        >
          {bottomLogos.map((logo, i) => (
            <LogoItem key={`bot-a-${i}`} logo={logo} />
          ))}
          {/* Duplicate for seamless loop */}
          {bottomLogos.map((logo, i) => (
            <LogoItem key={`bot-b-${i}`} logo={logo} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Partnership Section ───────────────────────────────────────────── */

export function PartnershipSection({ className }: { className?: string }) {
  return (
    <section className={cn("w-full", className)}>
      {/* Badges row — "Backed by" text (1/4 left) + badges (3/4 right) */}
      <div className="w-full border-t border-sidebar-border bg-card/10">
        <div className="px-4 sm:px-6 md:px-8 lg:px-12 py-3 sm:py-4 md:py-5">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 sm:gap-5 lg:gap-8">
            {/* Left — "Backed By" title — takes ~1/4 */}
            <div className="flex flex-col gap-1 sm:gap-1.5 shrink-0 lg:basis-1/4">
              <div className="flex items-center gap-3 w-full">
                <span className="text-[10px] sm:text-xs md:text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground/80 whitespace-nowrap">
                  Backed By
                </span>
                <div className="h-px grow bg-gradient-to-r from-cyan-500/50 to-transparent" />
              </div>
              <div className="text-base sm:text-lg md:text-xl lg:text-2xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-white/90 to-fuchsia-400 tracking-wide whitespace-nowrap leading-none">
                THE LEADERS BUILDING AI
              </div>
            </div>

            {/* Right — Badge images (equal sized) — takes ~2/4 */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:basis-2/4 h-16 sm:h-[4.5rem] md:h-20">
              <PartnershipBadge
                src="/partners/badges/nvidia-badge.png"
                alt="NVIDIA Inception Program"
                glowColor="green"
                link="https://www.nvidia.com/en-us/startups/"
                className="w-full h-full"
              />
              <PartnershipBadge
                src="/partners/badges/microsoft-badge.png"
                alt="Microsoft for Startups"
                glowColor="blue"
                link="https://www.microsoft.com/en-us/startups"
                className="w-full h-full"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Partner logos marquee — full width, edge to edge */}
      <div className="w-full border-t border-sidebar-border/50 py-3 sm:py-4 md:py-5 pb-4 sm:pb-5 md:pb-6 bg-card/5">
        <PartnerLogoMarquee />
      </div>
    </section>
  );
}
