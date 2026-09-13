import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  ExternalLink,
  Shield,
  Search,
  Filter,
  CheckCircle2,
  Lock,
  Cpu,
  Database,
  Mic,
  Workflow,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export interface ProviderItem {
  id: string;
  name: string;
  category: "llm" | "inference" | "multimodal" | "infra" | "tools";
  categoryLabel: string;
  description: string;
  modelsCount: string;
  trainingPolicy: "Zero Training on Prompts/Outputs" | "No Model Training on API Data" | "Ephemeral Relay Only";
  tosUrl: string;
  privacyUrl: string;
  dpaUrl?: string;
  jurisdiction: string;
}

const PROVIDERS: ProviderItem[] = [
  // Labs
  {
    id: "openai",
    name: "OpenAI",
    category: "llm",
    categoryLabel: "Labs",
    description: "GPT-5-*, text-embedding-*, whisper-*, and gpt-image-* models.",
    modelsCount: "40+ Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://openai.com/policies/terms-of-use",
    privacyUrl: "https://openai.com/policies/privacy-policy",
    dpaUrl: "https://openai.com/policies/data-processing-addendum",
    jurisdiction: "United States (California)",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    category: "llm",
    categoryLabel: "AI Foundation Lab",
    description: "Claude 5 Opus, Claude 5 Fable, Claude 4.6-4-8, and constitutional AI architectures.",
    modelsCount: "15+ Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://www.anthropic.com/legal/commercial-terms",
    privacyUrl: "https://www.anthropic.com/legal/privacy",
    dpaUrl: "https://www.anthropic.com/legal/dpa",
    jurisdiction: "United States (California)",
  },
  {
    id: "google",
    name: "Google Cloud / Vertex AI",
    category: "llm",
    categoryLabel: "AI Foundation Lab",
    description: "Gemini 3.*, Nano Banana, Lyria realtime, Veo, and text embeddings.",
    modelsCount: "20+ Models",
    trainingPolicy: "Zero Training on Prompts/Outputs",
    tosUrl: "https://cloud.google.com/terms",
    privacyUrl: "https://cloud.google.com/terms/cloud-privacy-notice",
    dpaUrl: "https://cloud.google.com/terms/data-processing-addendum",
    jurisdiction: "United States / Global",
  },
  {
    id: "alibaba",
    name: "Alibaba Cloud / Qwen",
    category: "llm",
    categoryLabel: "AI Foundation Lab",
    description: "Qwen, Wan, HappyHorse, and other Partners' open models.",
    modelsCount: "100+ Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-terms-of-use",
    privacyUrl: "https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-privacy-policy",
    jurisdiction: "Singapore / Global",
  },
  {
    id: "microsoft-azure",
    name: "Microsoft Azure AI / Foundry",
    category: "llm",
    categoryLabel: "Enterprise AI Platform",
    description: "Azure OpenAI, Cohere Command R+, Phi-4, and sovereign cloud AI deployments.",
    modelsCount: "10+ Models",
    trainingPolicy: "Zero Training on Prompts/Outputs",
    tosUrl: "https://www.microsoft.com/licensing/terms/product/forlegalterms",
    privacyUrl: "https://privacy.microsoft.com/en-us/privacystatement",
    dpaUrl: "https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA",
    jurisdiction: "United States (Washington)",
  },
  {
    id: "perplexity",
    name: "Perplexity AI",
    category: "llm",
    categoryLabel: "Online Search LLMs",
    description: "Sonar Reasoning, Sonar Pro, real-time grounded search intelligence.",
    modelsCount: "3 Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://www.perplexity.ai/hub/legal/terms-of-service",
    privacyUrl: "https://www.perplexity.ai/hub/legal/privacy-policy",
    jurisdiction: "United States (California)",
  },

  // High-performance inference
  {
    id: "fireworks",
    name: "Fireworks AI",
    category: "inference",
    categoryLabel: "Inference Engine",
    description: "Ultra-fast serverless inference.",
    modelsCount: "10+ Models",
    trainingPolicy: "Zero Training on Prompts/Outputs",
    tosUrl: "https://fireworks.ai/terms-of-service",
    privacyUrl: "https://fireworks.ai/privacy-policy",
    dpaUrl: "https://fireworks.ai/dpa",
    jurisdiction: "United States (California)",
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    category: "inference",
    categoryLabel: "Inference Engine",
    description: "Scalable low-latency hosting for open-weights LLMs, embeddings, and media generation models.",
    modelsCount: "100+ Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://deepinfra.com/terms",
    privacyUrl: "https://deepinfra.com/privacy",
    jurisdiction: "United States",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    category: "inference",
    categoryLabel: "Inference Engine",
    description: "Serverless model inference hub, specialized open-source transformers and pipelines.",
    modelsCount: "100+ Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://huggingface.co/terms-of-service",
    privacyUrl: "https://huggingface.co/privacy",
    dpaUrl: "https://huggingface.co/legal/dpa",
    jurisdiction: "United States / France",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    category: "inference",
    categoryLabel: "Edge Inference",
    description: "Edge-based neural network execution, bge embeddings, and Whisper speech models.",
    modelsCount: "50+ Models",
    trainingPolicy: "Zero Training on Prompts/Outputs",
    tosUrl: "https://www.cloudflare.com/website-terms/",
    privacyUrl: "https://www.cloudflare.com/privacypolicy/",
    dpaUrl: "https://www.cloudflare.com/cloudflare-customer-dpa/",
    jurisdiction: "United States (California)",
  },
  {
    id: "asicloud",
    name: "ASI Cloud (SingularityNET / Fetch.ai)",
    category: "inference",
    categoryLabel: "Decentralized Compute",
    description: "Decentralized artificial superintelligence compute network and open-source nodes.",
    modelsCount: "10+ Models",
    trainingPolicy: "Ephemeral Relay Only",
    tosUrl: "https://asi.singularitynet.io/terms",
    privacyUrl: "https://asi.singularitynet.io/privacy",
    jurisdiction: "Global / Decentralized",
  },

  // Multimodal & Voice
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "multimodal",
    categoryLabel: "Speech & Audio",
    description: "Hyper-realistic voice synthesis, multilingual text-to-speech, and sound effects.",
    modelsCount: "10+ Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://elevenlabs.io/terms-of-use",
    privacyUrl: "https://elevenlabs.io/privacy-policy",
    dpaUrl: "https://elevenlabs.io/dpa",
    jurisdiction: "United States / European Union",
  },
  {
    id: "cartesia",
    name: "Cartesia",
    category: "multimodal",
    categoryLabel: "Speech & Audio",
    description: "Sonic ultra-low-latency real-time voice streaming engine (under 100ms TTFB).",
    modelsCount: "10+ Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://cartesia.ai/terms",
    privacyUrl: "https://cartesia.ai/privacy",
    jurisdiction: "United States (California)",
  },
  {
    id: "deepgram",
    name: "Deepgram",
    category: "multimodal",
    categoryLabel: "Speech & Audio",
    description: "Nova-2 enterprise speech-to-text transcription and conversational voice models.",
    modelsCount: "10+ Models",
    trainingPolicy: "Zero Training on Prompts/Outputs",
    tosUrl: "https://deepgram.com/terms",
    privacyUrl: "https://deepgram.com/privacy",
    dpaUrl: "https://deepgram.com/dpa",
    jurisdiction: "United States",
  },
  {
    id: "roboflow",
    name: "Roboflow",
    category: "multimodal",
    categoryLabel: "Computer Vision",
    description: "Object detection, visual grounding, and customized computer vision models.",
    modelsCount: "20+ Models",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://roboflow.com/terms",
    privacyUrl: "https://roboflow.com/privacy",
    jurisdiction: "United States",
  },

  // Infrastructure & Memory
  {
    id: "filecoin",
    name: "Filecoin / Synapse Protocol",
    category: "infra",
    categoryLabel: "Storage & Settlement",
    description: "Decentralized verifiable state storage, cryptographic proofs, and calibration network.",
    modelsCount: "Mesh Storage",
    trainingPolicy: "Ephemeral Relay Only",
    tosUrl: "https://filecoin.io/terms/",
    privacyUrl: "https://filecoin.io/privacy-policy/",
    jurisdiction: "Decentralized / Protocol Labs",
  },
  {
    id: "pinata",
    name: "Pinata IPFS",
    category: "infra",
    categoryLabel: "Decentralized Storage",
    description: "IPFS pinning services, cryptographic content addressing, and gateway infrastructure.",
    modelsCount: "IPFS Gateway",
    trainingPolicy: "Ephemeral Relay Only",
    tosUrl: "https://www.pinata.cloud/terms-conditions",
    privacyUrl: "https://www.pinata.cloud/privacy-policy",
    jurisdiction: "United States",
  },
  {
    id: "neon",
    name: "Neon Tech",
    category: "infra",
    categoryLabel: "Database & Identity",
    description: "Serverless PostgreSQL database, pgvector indexing, and user state storage.",
    modelsCount: "Postgres / Vector",
    trainingPolicy: "Zero Training on Prompts/Outputs",
    tosUrl: "https://neon.tech/terms-of-service",
    privacyUrl: "https://neon.tech/privacy-policy",
    dpaUrl: "https://neon.tech/dpa",
    jurisdiction: "United States (California)",
  },
  {
    id: "aiven",
    name: "Aiven Cloud",
    category: "infra",
    categoryLabel: "Memory & Cache",
    description: "Managed Valkey, Redis caching, and real-time streaming infrastructure.",
    modelsCount: "Valkey / Redis",
    trainingPolicy: "Zero Training on Prompts/Outputs",
    tosUrl: "https://aiven.io/terms",
    privacyUrl: "https://aiven.io/privacy",
    dpaUrl: "https://aiven.io/dpa",
    jurisdiction: "European Union (Finland)",
  },

  // Tools & Orchestration
  {
    id: "composio",
    name: "Composio",
    category: "tools",
    categoryLabel: "Tool Integration",
    description: "Agent execution tools, OAuth connections, and 250+ enterprise SaaS connectors.",
    modelsCount: "250+ Connectors",
    trainingPolicy: "No Model Training on API Data",
    tosUrl: "https://composio.dev/terms",
    privacyUrl: "https://composio.dev/privacy",
    jurisdiction: "United States",
  },
  {
    id: "temporal",
    name: "Temporal Cloud",
    category: "tools",
    categoryLabel: "Durable Workflows",
    description: "Durable workflow engine, stateful agent loops, and execution tracking.",
    modelsCount: "Workflow Orchestrator",
    trainingPolicy: "Zero Training on Prompts/Outputs",
    tosUrl: "https://temporal.io/terms",
    privacyUrl: "https://temporal.io/privacy",
    dpaUrl: "https://temporal.io/dpa",
    jurisdiction: "United States (Washington)",
  },
];

const CATEGORIES = [
  { id: "all", label: "All Providers", icon: Sparkles },
  { id: "llm", label: "Labs", icon: Cpu },
  { id: "inference", label: "Inference", icon: Filter },
  { id: "multimodal", label: "Speech & Vision", icon: Mic },
  { id: "infra", label: "Data & Storage", icon: Database },
  { id: "tools", label: "Tools & Workflows", icon: Workflow },
];

export default function ProvidersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filteredProviders = useMemo(() => {
    return PROVIDERS.filter((provider) => {
      const matchesCategory =
        selectedCategory === "all" || provider.category === selectedCategory;
      const matchesSearch =
        provider.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        provider.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        provider.categoryLabel.toLowerCase().includes(searchTerm.toLowerCase()) ||
        provider.jurisdiction.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [searchTerm, selectedCategory]);

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden font-sans space-y-4 max-w-7xl mx-auto px-4 md:px-8 pt-4 pb-2">
      {/* Top Header & Filter Controls (Fixed in Viewport) */}
      <div className="shrink-0 space-y-3 pb-3 border-b border-cyan-400/15">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Link
                href="/keys"
                className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors mr-2"
              >
                <ArrowLeft size={13} /> Dashboard
              </Link>
              <Badge className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-mono text-[9px] uppercase tracking-wider">
                GDPR Art. 28 • Sub-Processors
              </Badge>
              <Badge className="bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/30 font-mono text-[9px] uppercase tracking-wider hidden sm:inline-flex">
                650+ Models • 30+ Providers
              </Badge>
            </div>
            <h1 className="text-xl md:text-2xl font-display font-bold uppercase tracking-wider text-foreground">
              Third-Party Model Providers & Sub-Processors
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">
              Compose.Market acts strictly as a technical conduit and aggregator.
              Below is the comprehensive directory of third-party laboratories, inference engines, and infrastructure providers.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 bg-cyan-950/30 border border-cyan-500/20 px-3 py-1.5 rounded-lg shrink-0 self-start md:self-auto">
            <Lock size={13} className="text-cyan-400" />
            <span>Zero Training on Your Prompts</span>
          </div>
        </div>

        {/* Compact Compliance Highlights */}
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/15 p-2.5 backdrop-blur-md grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              <strong className="text-cyan-300 font-display uppercase tracking-wider">Relay Only:</strong> Direct API pass-through without payload storage.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-fuchsia-400 shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              <strong className="text-fuchsia-300 font-display uppercase tracking-wider">No Training:</strong> Contractually prohibited from model training.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              <strong className="text-cyan-300 font-display uppercase tracking-wider">Direct Governance:</strong> Sub-processor ToS and DPAs apply.
            </span>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between pt-1">
          <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all cursor-pointer
                    ${active
                      ? "bg-cyan-500/20 border border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]"
                      : "bg-muted/40 border border-white/5 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    }
                  `}
                >
                  <Icon size={12} />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search provider, model, region..."
              className="pl-8 h-8 bg-black/40 border-cyan-500/20 text-xs font-mono focus-visible:ring-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Internal Scrollable Provider Cards Container */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-8 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredProviders.map((provider) => (
            <div
              key={provider.id}
              className="rounded-xl border border-cyan-500/20 bg-black/40 p-4 hover:border-cyan-400/40 hover:shadow-[0_0_15px_-3px_rgba(6,182,212,0.15)] transition-all flex flex-col justify-between"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-cyan-400/80">
                      {provider.categoryLabel}
                    </span>
                    <h3 className="text-base font-display font-bold tracking-wide text-foreground">
                      {provider.name}
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="font-mono text-[9px] bg-cyan-500/5 text-cyan-300 border-cyan-500/20"
                  >
                    {provider.modelsCount}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {provider.description}
                </p>

                <div className="pt-1 space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                    <span>Policy: </span>
                    <span className="text-cyan-300 font-medium">{provider.trainingPolicy}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 shrink-0" />
                    <span>Jurisdiction: </span>
                    <span className="text-foreground/90">{provider.jurisdiction}</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <a
                    href={provider.tosUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                  >
                    Terms <ExternalLink size={10} />
                  </a>
                  <span className="text-muted-foreground text-xs">•</span>
                  <a
                    href={provider.privacyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                  >
                    Privacy <ExternalLink size={10} />
                  </a>
                  {provider.dpaUrl && (
                    <>
                      <span className="text-muted-foreground text-xs">•</span>
                      <a
                        href={provider.dpaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-mono text-fuchsia-400 hover:text-fuchsia-300 underline underline-offset-2"
                      >
                        DPA <ExternalLink size={10} />
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredProviders.length === 0 && (
          <div className="text-center py-12 border border-dashed border-white/10 rounded-xl">
            <p className="text-xs font-mono text-muted-foreground">
              No providers found matching "{searchTerm}".
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
