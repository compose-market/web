import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8">
      {/* Glitchy 404 Display */}
      <div className="relative">
        <h1 className="text-[120px] md:text-[180px] font-display font-black text-transparent bg-clip-text bg-gradient-to-br from-cyan-400 via-fuchsia-500 to-cyan-400 leading-none select-none">
          404
        </h1>
        <div className="absolute inset-0 text-[120px] md:text-[180px] font-display font-black text-cyan-400/20 blur-xl leading-none select-none">
          404
        </div>
      </div>

      {/* Error Card */}
      <Card className="glass-panel border-fuchsia-500/30 max-w-md w-full mx-4 corner-decoration">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-sm">
              <AlertCircle className="h-6 w-6 text-fuchsia-400" />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">
                SYSTEM ERROR
              </h2>
              <p className="text-xs font-mono text-muted-foreground">
                NODE_NOT_FOUND // PATH_UNDEFINED
              </p>
            </div>
          </div>

          <div className="p-4 bg-background/50 border border-sidebar-border rounded-sm">
            <p className="text-sm text-muted-foreground font-mono">
              <span className="text-fuchsia-400">&gt;</span> The requested protocol route does not exist in the Manowar network.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1 border-sidebar-border hover:border-cyan-500/50 font-mono"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              GO BACK
            </Button>
            <Link href="/">
              <Button className="flex-1 bg-cyan-500 text-black hover:bg-cyan-400 font-mono font-bold">
                <Home className="w-4 h-4 mr-2" />
                HOME
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Decorative Elements */}
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono">
        <span className="w-2 h-2 bg-fuchsia-500 rounded-full animate-pulse"></span>
        <span>ERROR_CODE: 0x404 // COMPOSE.MARKET</span>
      </div>
    </div>
  );
}
