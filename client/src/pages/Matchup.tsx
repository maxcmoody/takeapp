import { useStore, type Restaurant, loadRankingsFromServer, type VenueBucket } from "@/lib/store";
import { useLocation } from "wouter";
import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import { useWindowSize } from "react-use";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, Wine, UtensilsCrossed } from "lucide-react";

type ServerMatchup = {
  a: Restaurant;
  b: Restaurant;
};

type ServerSessionState = {
  type: "matchup";
  sessionId: string;
  currentIndex: number;
  totalQueue: number;
  currentPlaceId: string;
  matchup: ServerMatchup;
  phase: string;
} | {
  type: "completed";
  sessionId: string;
  insertedCount: number;
} | {
  type: "none";
} | null;

export default function Matchup() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const {
    currentMatchup, resolveMatchup, mode, userRanking, pendingToRank,
    rankingProgress, cancelBatchRanking, undoMatchup, matchupUndoStack,
    serverDataLoaded, restaurants, activeBucket
  } = useStore();
  const isVerifying = mode === 'verification';
  const [_, setLocation] = useLocation();
  const { width, height } = useWindowSize();
  const [showConfetti, setShowConfetti] = useState(false);

  const [serverSession, setServerSession] = useState<ServerSessionState>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const isServerMode = serverSession && serverSession.type === "matchup";
  const isClientMode = mode !== 'idle' && !isServerMode;
  const checkedRef = useRef(false);

  const checkActiveSession = useCallback(async () => {
    try {
      const bucket = useStore.getState().activeBucket;
      const res = await fetch(`/api/ranking-sessions/active?bucket=${bucket}`, { credentials: "include" });
      if (!res.ok) { setServerLoading(false); return; }
      const data = await res.json();
      if (data.type === "matchup") {
        setServerSession(data);
      } else {
        setServerSession({ type: "none" });
      }
    } catch {
      setServerSession({ type: "none" });
    } finally {
      setServerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation('/');
      return;
    }
    if (isAuthenticated && !checkedRef.current) {
      checkedRef.current = true;
      checkActiveSession();
    }
  }, [isAuthenticated, authLoading, setLocation, checkActiveSession]);

  const handleServerVote = async (winnerId: string) => {
    if (voting) return;
    setVoting(true);
    try {
      const res = await fetch("/api/ranking-sessions/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ winnerId, bucket: activeBucket }),
      });
      if (!res.ok) { setVoting(false); return; }
      const data = await res.json();
      if (data.type === "matchup") {
        setServerSession(data);
      } else if (data.type === "completed") {
        setServerSession({ type: "none" });
        const serverData = await loadRankingsFromServer(activeBucket);
        if (serverData) {
          useStore.setState({
            restaurants: serverData.restaurants,
            userRanking: serverData.ranking,
            rankingMovements: serverData.movements || {},
          });
        }
        setShowConfetti(true);
        setTimeout(() => setLocation('/my-list'), 1200);
      }
    } catch (e) {
      console.error("Vote error:", e);
    } finally {
      setVoting(false);
    }
  };

  const handleServerCancel = async () => {
    try {
      await fetch("/api/ranking-sessions/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bucket: activeBucket }),
      });
      setServerSession({ type: "none" });
      setLocation('/');
    } catch {
      setLocation('/');
    }
  };

  useEffect(() => {
    if (isServerMode || serverLoading) return;
    if (!serverDataLoaded) return;
    if (mode === 'idle' && pendingToRank.length === 0) {
      if (userRanking.length > 0) {
        setShowConfetti(true);
        setTimeout(() => setLocation('/my-list'), 1200);
      } else {
        setLocation('/');
      }
    }
  }, [mode, userRanking, pendingToRank.length, setLocation, serverDataLoaded, isServerMode, serverLoading]);

  const handleDismiss = () => {
    if (mode === 'idle' && pendingToRank.length === 0) {
      setLocation('/my-list');
    }
  };

  const handleCancel = () => {
    cancelBatchRanking();
    setLocation('/');
  };

  if (serverLoading) {
    return (
      <div className="h-screen w-full bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
      </div>
    );
  }

  if (isServerMode) {
    const session = serverSession as Extract<ServerSessionState, { type: "matchup" }>;
    const { matchup, currentIndex, totalQueue, currentPlaceId, phase } = session;
    const a = matchup.a as Restaurant;
    const b = matchup.b as Restaurant;
    const placingName = restaurants.find(r => r.id === currentPlaceId)?.name || a.name;

    return (
      <div className="h-screen w-full bg-background flex flex-col max-w-md mx-auto relative overflow-hidden">
        <button
          onClick={handleServerCancel}
          className="absolute top-6 left-4 z-30 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          data-testid="button-back-ranking"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="absolute top-0 left-0 right-0 p-6 z-20 text-center space-y-2">
          <div className={`inline-flex items-center gap-1.5 backdrop-blur-md py-1.5 px-4 rounded-full border ${activeBucket === 'bar' ? 'bg-purple-500/20 border-purple-500/30' : 'bg-primary/20 border-primary/30'}`} data-testid="badge-ranking-bucket">
            {activeBucket === 'bar' ? <Wine size={14} className="text-purple-400" /> : <UtensilsCrossed size={14} className="text-primary" />}
            <span className={`text-xs font-bold uppercase tracking-wider ${activeBucket === 'bar' ? 'text-purple-400' : 'text-primary'}`}>
              Ranking {activeBucket === 'bar' ? 'Bars' : 'Restaurants'}
            </span>
          </div>
          {totalQueue > 1 && (
            <div className="inline-flex items-center gap-2 bg-background/80 backdrop-blur-md py-1.5 px-4 rounded-full border border-border/50" data-testid="text-ranking-progress">
              <span className="text-xs font-bold text-primary">
                Ranking {currentIndex + 1} of {totalQueue}
              </span>
              <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${((currentIndex + 1) / totalQueue) * 100}%` }}
                />
              </div>
            </div>
          )}
          {phase === "verification" && (
            <div className="inline-flex items-center gap-1.5 bg-amber-500/20 backdrop-blur-md py-1.5 px-4 rounded-full border border-amber-500/30" data-testid="text-verifying-placement">
              <span className="text-xs font-bold text-amber-400 animate-pulse">
                Verifying placement…
              </span>
            </div>
          )}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground bg-background/80 backdrop-blur-md py-2 px-4 rounded-full inline-block border border-border/50">
              Which is better?
            </h2>
          </div>
          {totalQueue > 1 && (
            <p className="text-xs text-muted-foreground/80 bg-background/60 backdrop-blur-sm py-1 px-3 rounded-full inline-block">
              Placing: <span className="font-bold text-foreground">{placingName}</span>
            </p>
          )}
        </div>

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <div className="bg-background text-foreground font-black text-2xl w-16 h-16 rounded-full flex items-center justify-center border-4 border-background shadow-2xl">
            VS
          </div>
        </div>

        <div
          className={`flex-1 min-h-0 relative cursor-pointer group ${voting ? 'pointer-events-none opacity-70' : ''}`}
          onClick={() => handleServerVote(a.id)}
          data-testid="card-matchup-a"
        >
          <img src={a.image || ''} className="w-full h-full object-cover brightness-[0.6] group-hover:brightness-90 transition-all duration-500 scale-105 group-hover:scale-100" />
          <div className="absolute inset-0 flex flex-col justify-center items-center p-8 text-white z-10">
            <h2 className="text-4xl font-heading font-black text-center mb-2 drop-shadow-lg">{a.name}</h2>
            <div className="flex gap-2">
              {(a.tags || []).slice(0, 2).map(t => (
                <span key={t} className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold uppercase tracking-wider">{t}</span>
              ))}
            </div>
          </div>
          <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 mix-blend-overlay" />
        </div>

        <div
          className={`flex-1 min-h-0 relative cursor-pointer group ${voting ? 'pointer-events-none opacity-70' : ''}`}
          onClick={() => handleServerVote(b.id)}
          data-testid="card-matchup-b"
        >
          <img src={b.image || ''} className="w-full h-full object-cover brightness-[0.6] group-hover:brightness-90 transition-all duration-500 scale-105 group-hover:scale-100" />
          <div className="absolute inset-0 flex flex-col justify-center items-center p-8 text-white z-10">
            <h2 className="text-4xl font-heading font-black text-center mb-2 drop-shadow-lg">{b.name}</h2>
            <div className="flex gap-2">
              {(b.tags || []).slice(0, 2).map(t => (
                <span key={t} className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold uppercase tracking-wider">{t}</span>
              ))}
            </div>
          </div>
          <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 mix-blend-overlay" />
        </div>

        <div className="absolute bottom-8 left-0 right-0 z-20 text-center">
          <button
            onClick={handleServerCancel}
            className="text-white/60 hover:text-white font-medium text-sm transition-colors"
            data-testid="button-cancel-ranking"
          >
            Cancel Ranking
          </button>
        </div>
      </div>
    );
  }

  if (!currentMatchup || (mode === 'idle' && pendingToRank.length === 0)) {
    return (
      <div
        className="h-screen w-full bg-background flex items-center justify-center relative overflow-hidden cursor-pointer"
        onClick={handleDismiss}
        data-testid="screen-ranking-updated"
      >
        {showConfetti && <Confetti width={width} height={height} numberOfPieces={200} recycle={false} />}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center p-8"
        >
          <div className="text-6xl mb-4">🏆</div>
          <h1 className="text-4xl font-heading font-black text-primary mb-2">Ranking Updated!</h1>
          <p className="text-muted-foreground">Your list is smarter now.</p>
          <p className="text-xs text-muted-foreground/50 mt-4">Tap anywhere to continue</p>
        </motion.div>
      </div>
    );
  }

  const { a, b } = currentMatchup;
  const pendingRestaurant = useStore.getState().restaurants.find(r => r.id === useStore.getState().pendingItem);

  return (
    <div className="h-screen w-full bg-background flex flex-col max-w-md mx-auto relative overflow-hidden">
      <button
        onClick={matchupUndoStack.length > 0 ? undoMatchup : handleCancel}
        className="absolute top-6 left-4 z-30 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 transition-colors"
        data-testid="button-back-ranking"
      >
        <ArrowLeft size={20} />
      </button>

      <div className="absolute top-0 left-0 right-0 p-6 z-20 text-center space-y-2">
        <div className={`inline-flex items-center gap-1.5 backdrop-blur-md py-1.5 px-4 rounded-full border ${activeBucket === 'bar' ? 'bg-purple-500/20 border-purple-500/30' : 'bg-primary/20 border-primary/30'}`} data-testid="badge-ranking-bucket">
          {activeBucket === 'bar' ? <Wine size={14} className="text-purple-400" /> : <UtensilsCrossed size={14} className="text-primary" />}
          <span className={`text-xs font-bold uppercase tracking-wider ${activeBucket === 'bar' ? 'text-purple-400' : 'text-primary'}`}>
            Ranking {activeBucket === 'bar' ? 'Bars' : 'Restaurants'}
          </span>
        </div>
        {rankingProgress && rankingProgress.total > 1 && (
          <div className="inline-flex items-center gap-2 bg-background/80 backdrop-blur-md py-1.5 px-4 rounded-full border border-border/50" data-testid="text-ranking-progress">
            <span className="text-xs font-bold text-primary">
              Ranking {rankingProgress.current} of {rankingProgress.total}
            </span>
            <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${(rankingProgress.current / rankingProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        {isVerifying && (
          <div className="inline-flex items-center gap-1.5 bg-amber-500/20 backdrop-blur-md py-1.5 px-4 rounded-full border border-amber-500/30" data-testid="text-verifying-placement">
            <span className="text-xs font-bold text-amber-400 animate-pulse">
              Verifying placement…
            </span>
          </div>
        )}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground bg-background/80 backdrop-blur-md py-2 px-4 rounded-full inline-block border border-border/50">
            Which is better?
          </h2>
        </div>
        {pendingRestaurant && rankingProgress && rankingProgress.total > 1 && (
          <p className="text-xs text-muted-foreground/80 bg-background/60 backdrop-blur-sm py-1 px-3 rounded-full inline-block">
            Placing: <span className="font-bold text-foreground">{pendingRestaurant.name}</span>
          </p>
        )}
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
        <div className="bg-background text-foreground font-black text-2xl w-16 h-16 rounded-full flex items-center justify-center border-4 border-background shadow-2xl">
          VS
        </div>
      </div>

      <div
        className="flex-1 min-h-0 relative cursor-pointer group"
        onClick={() => resolveMatchup(a.id)}
        data-testid="card-matchup-a"
      >
        <img src={a.image} className="w-full h-full object-cover brightness-[0.6] group-hover:brightness-90 transition-all duration-500 scale-105 group-hover:scale-100" />
        <div className="absolute inset-0 flex flex-col justify-center items-center p-8 text-white z-10">
          <h2 className="text-4xl font-heading font-black text-center mb-2 drop-shadow-lg">{a.name}</h2>
          <div className="flex gap-2">
            {a.tags.slice(0, 2).map(t => (
              <span key={t} className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold uppercase tracking-wider">{t}</span>
            ))}
          </div>
        </div>
        <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 mix-blend-overlay" />
      </div>

      <div
        className="flex-1 min-h-0 relative cursor-pointer group"
        onClick={() => resolveMatchup(b.id)}
        data-testid="card-matchup-b"
      >
        <img src={b.image} className="w-full h-full object-cover brightness-[0.6] group-hover:brightness-90 transition-all duration-500 scale-105 group-hover:scale-100" />
        <div className="absolute inset-0 flex flex-col justify-center items-center p-8 text-white z-10">
          <h2 className="text-4xl font-heading font-black text-center mb-2 drop-shadow-lg">{b.name}</h2>
          <div className="flex gap-2">
            {b.tags.slice(0, 2).map(t => (
              <span key={t} className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold uppercase tracking-wider">{t}</span>
            ))}
          </div>
        </div>
        <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 mix-blend-overlay" />
      </div>

      <div className="absolute bottom-8 left-0 right-0 z-20 text-center">
        <button
          onClick={handleCancel}
          className="text-white/60 hover:text-white font-medium text-sm transition-colors"
          data-testid="button-cancel-ranking"
        >
          Cancel Ranking
        </button>
      </div>
    </div>
  );
}
