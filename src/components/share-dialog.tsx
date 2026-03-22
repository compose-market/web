import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CHAIN_CONFIG } from "@/lib/performance/chains-data";
import { buildShareIntentUrl, type MintShareData } from "@/lib/share";
import { Link } from "wouter";

interface ShareSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MintShareData | null;
}

export function ShareSuccessDialog({ open, onOpenChange, data }: ShareSuccessDialogProps) {
  if (!data) return null;

  const { type, name, walletAddress, txHash, chainId } = data;
  const isAgent = type === 'agent';
  const detailPath = `/${type}/${walletAddress}`;
  const explorerUrl = `${CHAIN_CONFIG[chainId]?.explorer}/tx/${txHash}`;
  const shareUrl = buildShareIntentUrl(name, type, walletAddress);

  const handleShare = () => {
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-cyan-500/30">
        <DialogHeader>
          <DialogTitle className="font-display text-lg sm:text-xl flex items-center gap-2">
            <span className="text-cyan-400">✓</span>
            {isAgent ? 'Agent Minted!' : 'Workflow Minted!'}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground">{name}</span> has been deployed to {CHAIN_CONFIG[chainId]?.name || 'blockchain'}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-4">
          <div className="flex gap-2">
            <Link href={detailPath}>
              <Button
                className="flex-1 bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold"
                onClick={() => onOpenChange(false)}
              >
                See {isAgent ? 'Agent' : 'Workflow'}
              </Button>
            </Link>
            <Button
              variant="outline"
              className="flex-1 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
              onClick={handleShare}
            >
              Share on X
            </Button>
          </div>

          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-cyan-400 transition-colors py-2"
          >
            View Transaction <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
