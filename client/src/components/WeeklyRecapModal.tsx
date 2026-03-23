import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingUp, TrendingDown, ArrowRight, Plus, Trophy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

interface Mover {
  placeId: string;
  name: string;
  image: string | null;
  delta: number;
  rank: number;
  score: number;
}

interface TrendingItem {
  placeId: string;
  name: string;
  image: string | null;
  rank: number;
  score: number;
}

interface RecapData {
  show: boolean;
  firstWeek?: boolean;
  regionKey?: string;
  currentWeek?: string;
  globalMovers?: {
    up: Mover[];
    down: Mover[];
  };
  trending?: TrendingItem[];
}

const RECAP_DISMISS_KEY = 'take-weekly-recap-dismissed';

function isDismissedToday(): boolean {
  try {
    const stored = localStorage.getItem(RECAP_DISMISS_KEY);
    if (!stored) return false;
    const today = new Date().toISOString().slice(0, 10);
    return stored === today;
  } catch {
    return false;
  }
}

function markDismissedToday(): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(RECAP_DISMISS_KEY, today);
  } catch {}
}

export default function WeeklyRecapModal() {
  const [data, setData] = useState<RecapData | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const { isAuthenticated } = useAuth();
  const homeArea = useStore(s => s.homeArea);
  const [_, setLocation] = useLocation();

  useEffect(() => {
    if (!isAuthenticated || !homeArea?.lat || !homeArea?.lng) return;
    if (isDismissedToday()) return;

    const params = new URLSearchParams();
    params.set('lat', String(homeArea.lat));
    params.set('lng', String(homeArea.lng));

    fetch(`/api/recap/weekly?${params}`, { credentials: 'include' })
      .then(res => res.json())
      .then((result: RecapData) => {
        if (result.show) {
          setData(result);
          setOpen(true);
        }
      })
      .catch(() => {});
  }, [isAuthenticated, homeArea?.lat, homeArea?.lng]);

  const dismiss = async () => {
    setDismissing(true);
    markDismissedToday();
    try {
      await fetch('/api/recap/weekly/dismiss', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {}
    setOpen(false);
    setDismissing(false);
  };

  if (!data || !open) return null;

  const areaLabel = homeArea?.label || "your area";
  const hasMovers = data.globalMovers && (data.globalMovers.up.length > 0 || data.globalMovers.down.length > 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={dismiss}
          data-testid="modal-weekly-recap"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-md bg-background rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/50 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-primary" />
                <h2 className="text-lg font-heading font-black tracking-tight">
                  This week in {areaLabel}
                </h2>
              </div>
              <button
                onClick={dismiss}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
                data-testid="button-dismiss-recap"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">
              {data.firstWeek && data.trending ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Trophy size={16} className="text-amber-500" />
                    <h3 className="text-sm font-bold">Trending Now</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Here's what's popular in {areaLabel} right now. Come back next week to see who's moving up!
                  </p>
                  <div className="space-y-2">
                    {data.trending.map((item, i) => (
                      <MoverRow
                        key={item.placeId}
                        name={item.name}
                        image={item.image}
                        rank={item.rank}
                        score={item.score}
                        index={i}
                        badge={<span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">#{item.rank}</span>}
                      />
                    ))}
                  </div>
                </div>
              ) : hasMovers ? (
                <>
                  {data.globalMovers!.up.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={16} className="text-emerald-500" />
                        <h3 className="text-sm font-bold">Biggest Climbers</h3>
                      </div>
                      <div className="space-y-1.5">
                        {data.globalMovers!.up.map((m, i) => (
                          <MoverRow
                            key={m.placeId}
                            name={m.name}
                            image={m.image}
                            rank={m.rank}
                            score={m.score}
                            index={i}
                            badge={
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-0.5">
                                <TrendingUp size={10} />
                                +{m.delta}
                              </span>
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {data.globalMovers!.down.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <TrendingDown size={16} className="text-red-500" />
                        <h3 className="text-sm font-bold">Biggest Fallers</h3>
                      </div>
                      <div className="space-y-1.5">
                        {data.globalMovers!.down.map((m, i) => (
                          <MoverRow
                            key={m.placeId}
                            name={m.name}
                            image={m.image}
                            rank={m.rank}
                            score={m.score}
                            index={i}
                            badge={
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-0.5">
                                <TrendingDown size={10} />
                                {m.delta}
                              </span>
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground">No major movers this week — rankings held steady!</p>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border/50 px-5 py-4 space-y-2">
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => {
                    dismiss();
                    setLocation('/leaderboard');
                  }}
                  data-testid="button-recap-full-list"
                >
                  <ArrowRight size={16} className="mr-1.5" />
                  See full list
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    dismiss();
                    setLocation('/add');
                  }}
                  data-testid="button-recap-rank-new"
                >
                  <Plus size={16} className="mr-1.5" />
                  Rank new place
                </Button>
              </div>
              <button
                onClick={dismiss}
                disabled={dismissing}
                className="w-full text-xs text-muted-foreground py-1 hover:text-foreground transition-colors"
                data-testid="button-recap-dismiss-text"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MoverRow({ name, image, rank, score, index, badge }: {
  name: string;
  image: string | null;
  rank: number;
  score: number;
  index: number;
  badge: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-3 p-2 rounded-xl hover:bg-muted/50 transition-colors"
      data-testid={`row-mover-${index}`}
    >
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Trophy size={16} className="text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight truncate">{name}</p>
        <p className="text-[11px] text-muted-foreground">#{rank} · Score {score}</p>
      </div>
      {badge}
    </motion.div>
  );
}
