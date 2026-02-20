import { cn } from "@/lib/utils";

interface PartnershipBadgeProps {
  src: string;
  alt: string;
  programName: string;
  className?: string;
  glowColor?: "cyan" | "green" | "purple" | "blue";
  link?: string;
}

const glowColors = {
  cyan: {
    border: "border-cyan-500/40",
    textAccent: "text-cyan-400",
    cornerColor: "hsl(188 95% 43%)",
    pulseColor: "rgba(6,182,212,0.4)",
  },
  green: {
    border: "border-green-500/40",
    textAccent: "text-green-400",
    cornerColor: "hsl(142 71% 45%)",
    pulseColor: "rgba(34,197,94,0.4)",
  },
  purple: {
    border: "border-purple-500/40",
    textAccent: "text-purple-400",
    cornerColor: "hsl(270 91% 65%)",
    pulseColor: "rgba(168,85,247,0.4)",
  },
  blue: {
    border: "border-blue-500/40",
    textAccent: "text-blue-400",
    cornerColor: "hsl(217 91% 60%)",
    pulseColor: "rgba(59,130,246,0.4)",
  },
};

export function PartnershipBadge({
  src,
  alt,
  programName,
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
      style={{ containerType: "inline-size" }}
    >
      <div
        className="absolute -inset-1 rounded-lg opacity-60 group-hover:opacity-100 blur transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse at center, ${colors.pulseColor}, transparent 70%)`,
        }}
      />

      <div
        className={cn(
          "relative overflow-hidden rounded-lg",
          "glass-panel",
          colors.border,
          "transition-all duration-500",
          "w-full min-w-0"
        )}
      >
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{
            background: `linear-gradient(135deg, ${colors.pulseColor}, transparent 50%)`,
          }}
        />

        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute w-full h-[100px] opacity-[0.04]"
            style={{
              background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.08), transparent)",
              animation: "partner-scanline 4s linear infinite",
            }}
          />
        </div>

        <div className="relative p-3 sm:p-4 md:p-5">
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

          <div className="relative flex items-center gap-3 sm:gap-4 md:gap-5">
            <div className="relative shrink-0">
              <div
                className="absolute inset-0 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-lg"
                style={{ background: colors.pulseColor }}
              />
              <img
                src={src}
                alt={alt}
                className="relative h-[10cqw] max-h-14 min-h-[32px] w-auto object-contain brightness-100 group-hover:brightness-110 transition-all duration-300"
              />
            </div>

            <div className="flex flex-col min-w-0 gap-0.5 sm:gap-1 flex-1 shrink-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <div
                  className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full animate-pulse flex-shrink-0"
                  style={{ backgroundColor: colors.cornerColor }}
                />
                <span className={cn(
                  "text-[2.5cqw] min-text-[9px] font-mono uppercase tracking-[0.15em] opacity-90 group-hover:opacity-100 transition-opacity whitespace-nowrap",
                  colors.textAccent
                )}>
                  PROGRAM MEMBER
                </span>
              </div>
              <span className="text-[4cqw] min-text-[12px] font-display font-bold text-white tracking-wide whitespace-nowrap">
                {programName}
              </span>
            </div>
          </div>
        </div>

        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1500 ease-in-out" />
        </div>

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

interface PartnerLogo {
  src: string;
  alt: string;
  name: string;
}

const partnerLogos: PartnerLogo[] = [
  { src: "/partners/cloudflare.jpg", alt: "Cloudflare", name: "Cloudflare" },
  { src: "/partners/vertex.jpg", alt: "Vertex AI", name: "Vertex AI" },
  { src: "/partners/langchain.jpg", alt: "LangChain", name: "LangChain" },
  { src: "/partners/redis.jpg", alt: "Redis", name: "Redis" },
  { src: "/partners/perplexity.jpg", alt: "Perplexity", name: "Perplexity" },
  { src: "/partners/thirdweb.jpg", alt: "Thirdweb", name: "Thirdweb" },
  { src: "/partners/openai.jpg", alt: "OpenAI", name: "OpenAI" },
  { src: "/partners/modal.jpg", alt: "Modal", name: "Modal" },
  { src: "/partners/cartesia.jpg", alt: "Cartesia", name: "Cartesia" },
  { src: "/partners/huggingface.jpg", alt: "Hugging Face", name: "Hugging Face" },
  { src: "/partners/temporal.jpg", alt: "Temporal", name: "Temporal" },
  { src: "/partners/couchbase.jpg", alt: "Couchbase", name: "Couchbase" },
  { src: "/partners/deepgram.jpg", alt: "Deepgram", name: "Deepgram" },
  { src: "/partners/telnyx.jpg", alt: "Telnyx", name: "Telnyx" },
  { src: "/partners/mem0.jpg", alt: "Mem0", name: "Mem0" },
  { src: "/partners/fireworks-ai.jpg", alt: "Fireworks AI", name: "Fireworks AI" },
  { src: "/partners/lambda-ai.jpg", alt: "Lambda AI", name: "Lambda AI" },
  { src: "/partners/chaingpt.jpg", alt: "ChainGPT", name: "ChainGPT" },
  { src: "/partners/asi-cloud.jpg", alt: "ASI:Cloud", name: "ASI:Cloud" },
  { src: "/partners/roboflow.jpg", alt: "Roboflow", name: "Roboflow" },
  { src: "/partners/neo4j.jpg", alt: "Neo4j", name: "Neo4j" },
  { src: "/partners/confluent.jpg", alt: "Confluent", name: "Confluent" },
  { src: "/partners/11labs.jpg", alt: "ElevenLabs", name: "ElevenLabs" },
];

function PartnerLogoCarousel() {
  const duplicatedLogos = [...partnerLogos, ...partnerLogos];

  return (
    <div className="relative w-full overflow-hidden py-1.5">
      <div
        className="absolute left-0 top-0 bottom-0 w-8 sm:w-10 md:w-14 lg:w-16 xl:w-20 z-10 pointer-events-none"
        style={{
          background: "linear-gradient(to right, hsl(var(--card)), transparent)",
        }}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-8 sm:w-10 md:w-14 lg:w-16 xl:w-20 z-10 pointer-events-none"
        style={{
          background: "linear-gradient(to left, hsl(var(--card)), transparent)",
        }}
      />

      <div className="flex animate-partner-carousel">
        {duplicatedLogos.map((logo, index) => (
          <div
            key={`${logo.name}-${index}`}
            className="flex items-center justify-center shrink-0 px-3 sm:px-4 md:px-5 lg:px-6"
          >
            <img
              src={logo.src}
              alt={logo.alt}
              className="h-4 sm:h-5 md:h-6 lg:h-7 xl:h-8 w-auto object-contain opacity-70 hover:opacity-100 transition-all duration-300"
              title={logo.name}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PartnershipSection({ className }: { className?: string }) {
  return (
    <section className={cn("w-full", className)}>
      <div className="w-full border-t border-sidebar-border bg-card/10 backdrop-blur-none">
        <div className="py-4 sm:py-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 lg:gap-12">
            <div className="flex flex-col gap-1 sm:gap-1.5 shrink-0 w-fit">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 flex-1">
              <PartnershipBadge
                src="/partners/nvidia-badge.jpg"
                alt="NVIDIA Inception Program"
                programName="NVIDIA Inception"
                glowColor="green"
                link="https://www.nvidia.com/en-us/startups/"
                className="w-full"
              />
              <PartnershipBadge
                src="/partners/microsoft-badge.jpg"
                alt="Microsoft for Startups"
                programName="Microsoft for Startups"
                glowColor="blue"
                link="https://www.microsoft.com/en-us/startups"
                className="w-full"
              />
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 md:px-8 lg:px-12 pb-4 sm:pb-5 md:pb-6 border-t border-sidebar-border/50">
          <PartnerLogoCarousel />
        </div>
      </div>
    </section>
  );
}