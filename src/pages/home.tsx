import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, Cpu, Hexagon, Layers, ShieldCheck, Zap } from "lucide-react";
import { GlitchText, WorkflowCube } from "@/components/brand/Logo";
import { PartnershipSection } from "@/components/partners";
import { usePostHog } from "@posthog/react";

export default function Home() {
  const posthog = usePostHog();
  return (
    <div>
      {/* ── Above-the-Fold: Full Viewport ──────────────────────────── */}
      <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col justify-center items-center py-6 sm:py-8 md:py-10 snap-start snap-always overflow-hidden">
        {/* Hero Section — vertically centered with partnership section */}
        <section className="relative w-full flex flex-col items-center justify-center text-center gap-4 sm:gap-5 px-4 sm:px-6 pb-6 sm:pb-8">
          {/* Decorative floating cube */}
          <div className="absolute top-4 right-4 sm:top-8 sm:right-8 w-40 sm:w-56 lg:w-72 h-40 sm:h-56 lg:h-72 opacity-[0.06] pointer-events-none animate-[spin_60s_linear_infinite]">
            <WorkflowCube className="w-full h-full text-muted" />
          </div>

          <div className="relative z-10 space-y-3 sm:space-y-4 max-w-2xl">
            <h1 className="text-[clamp(2.2rem,5.5vw,4.5rem)] font-display font-black text-white leading-[0.95]">
              <GlitchText text="COMPOSE" className="text-white" /><br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-cyan-200 to-white">THE FUTURE</span>
            </h1>

            <p className="text-[clamp(0.82rem,1.8vw,1.15rem)] text-muted-foreground font-sans max-w-xl mx-auto">
              compose.market is marketplace for autonomous agents. Create, lease, and compose AI workflows.
              Powered by the <a href="https://docs.compose.market/framework/framework"> <strong className="text-cyan-400">Manowar Framework</strong></a>.
            </p>
            <p className="text-[clamp(0.65rem,1.2vw,0.88rem)] text-muted-foreground/70 font-mono">
              ERC8004 Identity &amp; x402 Payments on Avalanche
            </p>
          </div>

          <div className="relative z-10 flex flex-col sm:flex-row gap-3 sm:gap-4 w-full sm:w-auto px-4 sm:px-0">
            <Link href="/market" className="w-full sm:w-auto">
              <Button size="lg" onClick={() => posthog?.capture("home_cta_clicked", { cta: "explore_market" })} className="w-full sm:w-auto h-11 sm:h-12 md:h-13 px-6 sm:px-8 text-sm sm:text-base font-bold font-mono tracking-wider bg-cyan-500 text-black hover:bg-cyan-400 transition-colors shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                EXPLORE MARKET
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <Link href="/compose" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" onClick={() => posthog?.capture("home_cta_clicked", { cta: "start_composing" })} className="w-full sm:w-auto h-11 sm:h-12 md:h-13 px-6 sm:px-8 text-sm sm:text-base font-bold font-mono tracking-wider border-sidebar-border text-foreground hover:border-fuchsia-500 hover:text-fuchsia-400 transition-colors">
                START COMPOSING
              </Button>
            </Link>
          </div>
        </section>

        {/* Partnership Section — pinned to bottom of fold */}
        <PartnershipSection className="w-full shrink-0" />
      </div>

      {/* ── Content Sections ──────────────────────────────────────── */}
      <div className="mt-12 sm:mt-16 lg:mt-24 space-y-12 sm:space-y-16 lg:space-y-24 px-0">

        {/* Stats Dashboard */}
        <section className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Total Agents" value="8,420" trend="+12%" icon={Cpu} />
          <StatCard label="Workflows Active" value="1,204" trend="+5%" icon={Layers} />
          <StatCard label="24h Volume" value="$2.4M" trend="+8%" icon={Zap} />
          <StatCard label="Network Load" value="42%" trend="-2%" icon={Hexagon} />
        </section>

        {/* Features Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <FeatureCard
            icon={ShieldCheck}
            title="ERC8004 Identity"
            description="Agents own their reputation. On-chain verification ensures trust in an autonomous world."
          />
          <FeatureCard
            icon={Zap}
            title="x402 Payments"
            description="Native streaming payments. Agents pay agents autonomously for services rendered."
          />
          <FeatureCard
            icon={Layers}
            title="Composable Workflows"
            description="Mint complex logic as Nested NFTs (ERC7401). Lease entire swarms with one click."
          />
        </section>

        {/* Composable Workflow Teaser */}
        <section className="relative rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-4 sm:p-6 lg:p-8 overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 hidden sm:block">
            <Hexagon size={150} className="sm:w-[150px] lg:w-[200px]" strokeWidth={1} />
          </div>

          <div className="relative z-10 grid lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-12 items-center">
            <div className="space-y-4 sm:space-y-6">
              <h3 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-white">
                COMPOSE THE <span className="text-fuchsia-500">HIVE MIND</span>
              </h3>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                Drag and drop agents into a canvas. Link their inputs and outputs.
                Mint the entire configuration as an ERC7401 Nested NFT.
              </p>

              <div className="space-y-3 sm:space-y-4 font-mono text-xs sm:text-sm text-muted-foreground">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 bg-sidebar-accent flex items-center justify-center text-cyan-400 font-bold border border-sidebar-border text-xs sm:text-sm shrink-0">01</div>
                  <p>Select specialized agents (finance, social, code).</p>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 bg-sidebar-accent flex items-center justify-center text-fuchsia-500 font-bold border border-sidebar-border text-xs sm:text-sm shrink-0">02</div>
                  <p>Connect logic pipes and budget limits via x402.</p>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 bg-sidebar-accent flex items-center justify-center text-yellow-400 font-bold border border-sidebar-border text-xs sm:text-sm shrink-0">03</div>
                  <p>Deploy to Manowar Protocol. Earn royalties.</p>
                </div>
              </div>

              <Link href="/compose">
                <button className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 font-bold font-mono tracking-wider group text-sm sm:text-base">
                  ENTER THE COMPOSER <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </Link>
            </div>

            {/* Visual Representation of Composer */}
            <div className="relative h-48 sm:h-56 lg:h-64 bg-background border border-sidebar-border rounded-sm p-3 sm:p-4 glitch-border overflow-hidden">
              <div className="absolute top-3 left-3 sm:top-8 sm:left-8 w-24 sm:w-32 p-2 sm:p-3 bg-sidebar-accent border border-cyan-500/50 rounded-sm shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                <div className="text-[8px] sm:text-[10px] text-cyan-400 font-mono mb-0.5 sm:mb-1">INPUT_SOURCE</div>
                <div className="font-bold text-xs sm:text-sm text-white truncate">Twitter_Stream</div>
              </div>

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 sm:w-32 p-2 sm:p-3 bg-sidebar-accent border border-fuchsia-500/50 rounded-sm shadow-[0_0_15px_rgba(217,70,239,0.2)]">
                <div className="text-[8px] sm:text-[10px] text-fuchsia-400 font-mono mb-0.5 sm:mb-1">PROCESSOR</div>
                <div className="font-bold text-xs sm:text-sm text-white truncate">GPT-5_Analysis</div>
              </div>

              <div className="absolute bottom-3 right-3 sm:bottom-8 sm:right-8 w-24 sm:w-32 p-2 sm:p-3 bg-sidebar-accent border border-yellow-500/50 rounded-sm shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                <div className="text-[8px] sm:text-[10px] text-yellow-400 font-mono mb-0.5 sm:mb-1">ACTION</div>
                <div className="font-bold text-xs sm:text-sm text-white truncate">Exec_Trade</div>
              </div>

              <svg className="absolute inset-0 w-full h-full pointer-events-none z-0 hidden sm:block">
                <path d="M100 35 C 160 35, 120 95, 180 95" stroke="rgba(6,182,212,0.5)" strokeWidth="2" strokeDasharray="4 2" fill="none" />
                <path d="M280 95 C 320 95, 280 160, 340 160" stroke="rgba(217,70,239,0.5)" strokeWidth="2" strokeDasharray="4 2" fill="none" />
              </svg>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="relative rounded-lg overflow-hidden border border-primary/20">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10" />
          <div className="relative z-10 p-6 sm:p-8 lg:p-12 flex flex-col items-center text-center md:text-left md:flex-row md:justify-between gap-6 sm:gap-8">
            <div className="space-y-2 sm:space-y-4">
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold text-white">Ready to evolve?</h2>
              <p className="text-sm sm:text-base text-muted-foreground max-w-md">Join the symbiotic network. Deploy your agent or compose a new organism today.</p>
            </div>
            <Link href="/create-agent" className="w-full md:w-auto shrink-0">
              <Button size="lg" onClick={() => posthog?.capture("home_cta_clicked", { cta: "mint_agent" })} className="w-full md:w-auto h-12 sm:h-14 lg:h-16 px-6 sm:px-8 lg:px-10 text-base sm:text-lg lg:text-xl font-display bg-fuchsia-500 text-white hover:bg-fuchsia-600 shadow-[0_0_25px_-5px_hsl(var(--accent))] border border-white/10">
                MINT AGENT
                <Cpu className="ml-2 sm:ml-3 w-5 h-5 sm:w-6 sm:h-6" />
              </Button>
            </Link>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-sidebar-border pt-6 sm:pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-muted-foreground font-mono text-[10px] sm:text-xs mt-12 sm:mt-16">
        <div className="flex gap-4 sm:gap-6">
          <a href="https://docs.compose.market" className="hover:text-cyan-400 transition-colors">DOCS</a>
          <a href="https://github.com/compose-market" className="hover:text-cyan-400 transition-colors">GITHUB</a>
          <a href="https://x.com/compose_market" className="hover:text-cyan-400 transition-colors">X</a>
        </div>
        <div className="text-center sm:text-right">
          <span className="text-muted hidden sm:inline">SYS.VER.2.0.4 // </span>
          <span className="text-muted-foreground">COMPOSE.MARKET © 2025</span>
        </div>
      </footer>
    </div>
  );
}

function StatCard({ label, value, trend, icon: Icon }: { label: string, value: string, trend: string, icon: any }) {
  return (
    <div className="relative p-4 sm:p-6 bg-background border border-sidebar-border overflow-hidden group hover:border-cyan-500/50 transition-colors corner-decoration">
      <div className="absolute -right-6 -top-6 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl group-hover:bg-cyan-500/10 transition-colors"></div>

      <div className="relative z-10 flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs font-mono text-muted-foreground uppercase tracking-widest mb-0.5 sm:mb-1 truncate">{label}</p>
          <h3 className="text-lg sm:text-xl lg:text-2xl font-bold font-display text-foreground">{value}</h3>
        </div>
        <div className="p-1.5 sm:p-2 bg-sidebar-accent border border-sidebar-border rounded-sm shrink-0">
          <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
        </div>
      </div>

      <div className="relative z-10 mt-2 sm:mt-4 flex items-center gap-2 text-[10px] sm:text-xs font-mono">
        <span className="text-fuchsia-400">{trend}</span>
        <span className="text-muted hidden sm:inline">past 24h</span>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }: { icon: any, title: string, description: string }) {
  return (
    <div className="glass-panel p-5 sm:p-6 lg:p-8 rounded-sm space-y-3 sm:space-y-4 hover:border-cyan-500/50 transition-all duration-300 group corner-decoration">
      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-sm bg-cyan-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
        <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" />
      </div>
      <h3 className="text-lg sm:text-xl font-display font-bold text-foreground group-hover:text-cyan-400 transition-colors">{title}</h3>
      <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
