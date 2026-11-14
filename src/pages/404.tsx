import { AlertCircle, ArrowLeft, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="cm-web-page">
      <div className="cm-web-page__canvas">
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="relative">
            <h1 className="font-display font-black leading-none select-none text-transparent bg-clip-text bg-gradient-to-br from-cyan-400 via-fuchsia-500 to-cyan-400 text-6xl sm:text-8xl">
              404
            </h1>
            <div
              aria-hidden="true"
              className="absolute inset-0 font-display font-black leading-none select-none text-cyan-400/20 blur-xl text-6xl sm:text-8xl"
            >
              404
            </div>
          </div>

          <div className="cm-shell-panel border-fuchsia-500/30 max-w-md w-full p-6 space-y-4 text-left">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-md">
                <AlertCircle className="h-5 w-5 text-fuchsia-400" />
              </div>
              <div>
                <h2 className="text-lg font-display font-bold text-foreground">
                  Page Not Found
                </h2>
                <p className="text-xs font-mono text-muted-foreground">
                  This route does not exist or has moved.
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 border-sidebar-border hover:border-cyan-500/50 font-mono"
                onClick={() => window.history.back()}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button asChild className="flex-1 bg-cyan-500 text-black hover:bg-cyan-400 font-mono font-bold">
                <Link href="/market">
                  <Store className="w-4 h-4 mr-2" />
                  Market
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
