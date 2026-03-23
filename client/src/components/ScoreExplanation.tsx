import { useState } from "react";
import { Info, Trophy, TrendingUp, Shield, Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";

export type ConfidenceTier = 'new' | 'growing' | 'proven';

export function getConfidenceTier(appearances: number): ConfidenceTier {
  if (appearances >= 8) return 'proven';
  if (appearances >= 3) return 'growing';
  return 'new';
}

const TIER_CONFIG: Record<ConfidenceTier, { label: string; color: string; icon: typeof Shield }> = {
  new: { label: 'New', color: 'text-blue-500 bg-blue-500/10', icon: Sparkles },
  growing: { label: 'Growing', color: 'text-amber-500 bg-amber-500/10', icon: TrendingUp },
  proven: { label: 'Proven', color: 'text-emerald-500 bg-emerald-500/10', icon: Shield },
};

export function ConfidenceBadge({ appearances }: { appearances: number }) {
  const { featureFlags } = useStore();
  if (!featureFlags.trustTransparency) return null;

  const tier = getConfidenceTier(appearances);
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${config.color}`} data-testid={`badge-confidence-${tier}`}>
      <Icon size={10} />
      {config.label}
    </span>
  );
}

export function generateExplanation(
  score: number,
  appearances: number,
  neighbors?: { name: string; score: number }[],
): string {
  const tier = getConfidenceTier(appearances);
  const scoreVal = score;

  if (tier === 'new' && scoreVal >= 75) {
    return `Up-and-coming: strong wins with ${appearances} ranking${appearances !== 1 ? 's' : ''}`;
  }

  if (tier === 'proven') {
    if (neighbors && neighbors.length >= 2) {
      const below = neighbors.filter(n => n.score < score).slice(0, 2);
      if (below.length >= 2) {
        return `Often ranked above ${below[0].name} and ${below[1].name}`;
      }
      if (below.length === 1) {
        return `High score across ${appearances} lists, ranked above ${below[0].name}`;
      }
    }
    return `High score across ${appearances} lists`;
  }

  if (tier === 'growing') {
    if (neighbors && neighbors.length >= 1) {
      const below = neighbors.filter(n => n.score < score);
      if (below.length >= 1) {
        return `Growing reputation, ranked above ${below[0].name}`;
      }
    }
    return `Building reputation across ${appearances} rankings`;
  }

  return `Ranked in ${appearances} list${appearances !== 1 ? 's' : ''}`;
}

export function ScoreExplanationPopover({
  score,
  appearances,
  neighbors,
}: {
  score: number;
  appearances: number;
  neighbors?: { name: string; score: number }[];
}) {
  const { featureFlags } = useStore();
  const [open, setOpen] = useState(false);

  if (!featureFlags.trustTransparency) return null;

  const explanation = generateExplanation(score, appearances, neighbors);
  const tier = getConfidenceTier(appearances);
  const config = TIER_CONFIG[tier];

  return (
    <div className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setOpen(!open); }}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5"
        data-testid="button-why-here"
      >
        <Info size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setOpen(false); }} />
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 bg-popover border border-border rounded-xl shadow-lg p-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Trophy size={12} className="text-amber-500" fill="currentColor" />
              <span className="font-bold text-sm">{score}</span>
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-auto ${config.color}`}>
                {config.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{explanation}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1.5">Based on {appearances} user ranking{appearances !== 1 ? 's' : ''}</p>
            <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-popover border-r border-b border-border rotate-45" />
          </div>
        </>
      )}
    </div>
  );
}
