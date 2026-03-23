import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type VenueBucket = 'restaurant' | 'bar';

export type Restaurant = {
  id: string;
  name: string;
  image: string;
  tags: string[];
  location: string;
  category: string;
  rating: number;
  votes: number;
  priceLevel: number;
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
  googleTypes?: string[];
  googlePrimaryType?: string;
  venueBucket?: VenueBucket;
  isHybrid?: boolean;
};

export type Matchup = {
  a: Restaurant;
  b: Restaurant;
};

export type ComparisonResult = 'a' | 'b';

export type HomeArea = {
  label: string;
  lat: number;
  lng: number;
};

export type ChainBiasPreference = 'off' | 'auto' | 'strong';

export type RankingProgress = {
  current: number;
  total: number;
};

export type FeatureFlags = {
  trustTransparency: boolean;
  tasteFingerprint: boolean;
  hiddenGems: boolean;
};

const DEFAULT_FLAGS: FeatureFlags = {
  trustTransparency: true,
  tasteFingerprint: true,
  hiddenGems: false,
};

type MatchupSource = 'insert_binary' | 'neighbor_verify' | 'rerank' | 'group_vote';

type MatchupSnapshot = {
  mode: AppState['mode'];
  pendingItem: string | null;
  userRanking: string[];
  insertionLow: number;
  insertionHigh: number;
  verificationIndex: number;
  verificationDirection: 'up' | 'down';
  verificationIterations: number;
  currentMatchup: Matchup | null;
  matchupHistory: Record<string, string>;
  pendingToRank: string[];
  rankingProgress: RankingProgress | null;
  isReranking: boolean;
};

interface AppState {
  restaurants: Restaurant[];
  userRanking: string[];
  homeArea: HomeArea | null;
  chainBias: ChainBiasPreference;
  featureFlags: FeatureFlags;
  serverDataLoaded: boolean;
  activeBucket: VenueBucket;
  
  mode: 'idle' | 'tournament' | 'insertion' | 'verification';
  pendingItem: string | null;
  pendingToRank: string[];
  rankingProgress: RankingProgress | null;
  insertionLow: number;
  insertionHigh: number;
  verificationIndex: number;
  verificationDirection: 'up' | 'down';
  verificationIterations: number;
  currentMatchup: Matchup | null;
  matchupHistory: Record<string, string>;
  matchupSessionId: string | null;
  isReranking: boolean;
  matchupUndoStack: MatchupSnapshot[];
  rankingMovements: Record<string, { delta: number; isNew: boolean }>;
  
  initialize: () => void;
  startFullTournament: () => void;
  addRestaurantToRank: (id: string) => void;
  startBatchRanking: (ids: string[]) => void;
  resolveMatchup: (winnerId: string) => void;
  resetRanking: () => void;
  removeFromRanking: (id: string) => void;
  rerankRestaurant: (id: string) => void;
  cancelBatchRanking: () => void;
  undoMatchup: () => void;
  setHomeArea: (area: HomeArea | null) => void;
  setChainBias: (pref: ChainBiasPreference) => void;
  setFeatureFlag: (flag: keyof FeatureFlags, value: boolean) => void;
  addNewRestaurant: (restaurant: Restaurant) => string;
  setActiveBucket: (bucket: VenueBucket) => void;
}

const MOCK_RESTAURANT_IDS = ['tn1','tn2','tn3','tn4','tn5','tn6','tn7','tn8','tn9','tn10','tn11','tn12','tn13','tn14','tn15'];

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSync(state: AppState) {
  if (!state.serverDataLoaded) return;
  if (syncTimeout) clearTimeout(syncTimeout);
  const snapshotBucket = state.activeBucket;
  syncTimeout = setTimeout(() => {
    const currentState = useStore.getState();
    if (currentState.activeBucket !== snapshotBucket) return;
    if (!currentState.serverDataLoaded) return;
    syncRankingsToServer(currentState);
  }, 300);
}

async function syncRankingsToServer(state: AppState) {
  if (state.userRanking.length === 0) return;
  
  const rankedRestaurants = state.userRanking
    .map(id => state.restaurants.find(r => r.id === id))
    .filter((r): r is Restaurant => !!r);

  if (rankedRestaurants.length === 0) return;

  try {
    const res = await fetch('/api/rankings/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        restaurants: rankedRestaurants.map(r => ({
          id: r.id,
          name: r.name,
          googlePlaceId: r.googlePlaceId,
          image: r.image || undefined,
          tags: r.tags || undefined,
          location: r.location || undefined,
          category: r.category || undefined,
          rating: r.rating !== undefined ? String(r.rating) : undefined,
          priceLevel: r.priceLevel !== undefined ? String(r.priceLevel) : undefined,
          lat: r.lat,
          lng: r.lng,
        })),
        ranking: state.userRanking,
        bucket: state.activeBucket,
      }),
    });
    if (res.status === 401) {
      console.warn('Not authenticated, rankings not synced to server');
    }
  } catch (e) {
    console.error('Failed to sync rankings:', e);
  }
}

export async function startServerRankingSession(restaurantIds: string[]): Promise<'matchup' | 'completed' | 'error'> {
  try {
    const bucket = useStore.getState().activeBucket;
    const res = await fetch('/api/ranking-sessions/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ restaurantIds, bucket }),
    });
    if (!res.ok) return 'error';
    const data = await res.json();
    if (data.type === 'completed') {
      const serverData = await loadRankingsFromServer(useStore.getState().activeBucket);
      if (serverData) {
        useStore.setState({
          restaurants: serverData.restaurants,
          userRanking: serverData.ranking,
          rankingMovements: serverData.movements || {},
        });
      }
      return 'completed';
    }
    return 'matchup';
  } catch (e) {
    console.error('Failed to start server session', e);
    return 'error';
  }
}

export async function loadRankingsFromServer(bucket: VenueBucket = 'restaurant'): Promise<{ restaurants: Restaurant[]; ranking: string[]; movements?: Record<string, { delta: number; isNew: boolean }> } | null> {
  try {
    const res = await fetch(`/api/rankings?bucket=${bucket}`, { credentials: 'include' });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('Failed to load rankings from server:', e);
    return null;
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function beginInsertion(id: string, userRanking: string[], restaurants: Restaurant[]): Partial<AppState> {
  if (userRanking.length === 0) {
    return {
      userRanking: [id],
      mode: 'idle' as const,
      pendingItem: null,
      currentMatchup: null,
      insertionLow: 0,
      insertionHigh: 0,
      matchupHistory: {},
    };
  }
  const mid = Math.floor(userRanking.length / 2);
  return {
    mode: 'insertion' as const,
    pendingItem: id,
    insertionLow: 0,
    insertionHigh: userRanking.length,
    matchupHistory: {},
    currentMatchup: {
      a: restaurants.find((r: Restaurant) => r.id === id)!,
      b: restaurants.find((r: Restaurant) => r.id === userRanking[mid])!,
    },
  };
}

function beginVerification(pendingItem: string, insertionIndex: number, ranking: string[], restaurants: Restaurant[]): Partial<AppState> {
  const maxIdx = ranking.length - 1;
  if (insertionIndex > 0) {
    return {
      mode: 'verification' as const,
      verificationIndex: insertionIndex,
      verificationDirection: 'up' as const,
      verificationIterations: 0,
      currentMatchup: {
        a: restaurants.find((r: Restaurant) => r.id === pendingItem)!,
        b: restaurants.find((r: Restaurant) => r.id === ranking[insertionIndex - 1])!,
      },
    };
  }
  if (insertionIndex < maxIdx) {
    return {
      mode: 'verification' as const,
      verificationIndex: insertionIndex,
      verificationDirection: 'down' as const,
      verificationIterations: 0,
      currentMatchup: {
        a: restaurants.find((r: Restaurant) => r.id === pendingItem)!,
        b: restaurants.find((r: Restaurant) => r.id === ranking[insertionIndex + 1])!,
      },
    };
  }
  return { mode: 'idle' as const };
}

type VerificationResult = {
  ranking: string[];
  idx: number;
  dir: 'up' | 'down';
  iters: number;
  nextNeighborId: string;
} | null;

function resolveVerificationLoop(
  pendingItem: string,
  startIdx: number,
  ranking: string[],
  history: Record<string, string>,
  startIters: number,
  startDir: 'up' | 'down',
  firstWinner?: string,
): VerificationResult {
  let idx = startIdx;
  let iters = startIters;
  let dir = startDir;
  const MAX_ITERS = 10;

  if (iters >= MAX_ITERS) return null;

  let currentWinner = firstWinner;

  if (currentWinner === undefined) {
    if (dir === 'up' && idx > 0) {
      const neighborId = ranking[idx - 1];
      const cached = history[pairKey(pendingItem, neighborId)];
      if (cached) {
        currentWinner = cached;
      } else {
        return { ranking, idx, dir, iters, nextNeighborId: neighborId };
      }
    } else if (dir === 'down' && idx < ranking.length - 1) {
      const neighborId = ranking[idx + 1];
      const cached = history[pairKey(pendingItem, neighborId)];
      if (cached) {
        currentWinner = cached;
      } else {
        return { ranking, idx, dir, iters, nextNeighborId: neighborId };
      }
    } else {
      return null;
    }
  }

  while (iters < MAX_ITERS) {
    if (dir === 'up') {
      if (currentWinner === pendingItem) {
        const aboveIdx = idx - 1;
        if (aboveIdx < 0) return null;
        [ranking[idx], ranking[aboveIdx]] = [ranking[aboveIdx], ranking[idx]];
        idx = aboveIdx;
        if (idx > 0) {
          const neighborId = ranking[idx - 1];
          const cached: string | undefined = history[pairKey(pendingItem, neighborId)];
          if (cached) {
            currentWinner = cached;
            iters++;
            continue;
          }
          return { ranking, idx, dir: 'up', iters, nextNeighborId: neighborId };
        } else {
          dir = 'down';
          if (idx >= ranking.length - 1) return null;
          const neighborId = ranking[idx + 1];
          const cached2: string | undefined = history[pairKey(pendingItem, neighborId)];
          if (cached2) {
            currentWinner = cached2;
            iters++;
            continue;
          }
          return { ranking, idx, dir: 'down', iters, nextNeighborId: neighborId };
        }
      } else {
        dir = 'down';
        if (idx >= ranking.length - 1) return null;
        const neighborId = ranking[idx + 1];
        const cached3: string | undefined = history[pairKey(pendingItem, neighborId)];
        if (cached3) {
          currentWinner = cached3;
          iters++;
          continue;
        }
        return { ranking, idx, dir: 'down', iters, nextNeighborId: neighborId };
      }
    } else {
      if (currentWinner !== pendingItem) {
        const belowIdx = idx + 1;
        if (belowIdx >= ranking.length) return null;
        [ranking[idx], ranking[belowIdx]] = [ranking[belowIdx], ranking[idx]];
        idx = belowIdx;
        if (idx < ranking.length - 1) {
          const neighborId = ranking[idx + 1];
          const cached4: string | undefined = history[pairKey(pendingItem, neighborId)];
          if (cached4) {
            currentWinner = cached4;
            iters++;
            continue;
          }
          return { ranking, idx, dir: 'down', iters, nextNeighborId: neighborId };
        } else {
          return null;
        }
      } else {
        return null;
      }
    }
  }
  return null;
}

const IDLE_STATE: Partial<AppState> = {
  mode: 'idle' as const,
  pendingItem: null,
  currentMatchup: null,
  insertionLow: 0,
  insertionHigh: 0,
  verificationIndex: 0,
  verificationDirection: 'up' as const,
  verificationIterations: 0,
  pendingToRank: [],
  rankingProgress: null,
  matchupHistory: {},
  matchupSessionId: null,
  isReranking: false,
  matchupUndoStack: [],
};

function logMatchup(
  winnerId: string,
  loserId: string,
  source: MatchupSource,
  restaurants: Restaurant[],
  sessionId: string | null,
) {
  const winner = restaurants.find(r => r.id === winnerId);
  const loser = restaurants.find(r => r.id === loserId);
  if (!winner?.googlePlaceId || !loser?.googlePlaceId) return;

  const loc = winner.lat != null && winner.lng != null
    ? { winnerLat: winner.lat, winnerLng: winner.lng }
    : loser.lat != null && loser.lng != null
    ? { winnerLat: loser.lat, winnerLng: loser.lng }
    : {};

  fetch('/api/matchups/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      winnerPlaceId: winner.googlePlaceId,
      loserPlaceId: loser.googlePlaceId,
      source,
      sessionId,
      ...loc,
    }),
  }).catch(() => {});
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      restaurants: [],
      userRanking: [],
      homeArea: { label: "Chattanooga, TN", lat: 35.0456, lng: -85.3097 },
      chainBias: 'auto',
      featureFlags: { ...DEFAULT_FLAGS },
      serverDataLoaded: false,
      activeBucket: 'restaurant' as VenueBucket,
      mode: 'idle',
      pendingItem: null,
      pendingToRank: [],
      rankingProgress: null,
      insertionLow: 0,
      insertionHigh: 0,
      verificationIndex: 0,
      verificationDirection: 'up' as const,
      verificationIterations: 0,
      currentMatchup: null,
      matchupHistory: {},
      matchupSessionId: null,
      isReranking: false,
      matchupUndoStack: [],
      rankingMovements: {},

      initialize: () => {},

      addNewRestaurant: (restaurant: Restaurant): string => {
        const { restaurants } = get();

        const updateImage = (existing: Restaurant) => {
          if (restaurant.image && restaurant.image !== existing.image) {
            set({ restaurants: restaurants.map(r => r.id === existing.id ? { ...r, image: restaurant.image } : r) });
          }
        };

        const byId = restaurants.find(r => r.id === restaurant.id);
        if (byId) {
          updateImage(byId);
          return byId.id;
        }
        if (restaurant.googlePlaceId) {
          const byPlaceId = restaurants.find(r => r.googlePlaceId === restaurant.googlePlaceId);
          if (byPlaceId) {
            updateImage(byPlaceId);
            return byPlaceId.id;
          }
        }
        const isNearby = (a: Restaurant, b: Restaurant): boolean => {
          if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
            const dlat = a.lat - b.lat;
            const dlng = a.lng - b.lng;
            return Math.sqrt(dlat * dlat + dlng * dlng) < 0.02;
          }
          return false;
        };
        const byName = restaurants.find(r =>
          r.name.toLowerCase() === restaurant.name.toLowerCase() && isNearby(r, restaurant)
        );
        if (byName) {
          updateImage(byName);
          return byName.id;
        }
        set({ restaurants: [...restaurants, restaurant] });
        return restaurant.id;
      },

      resetRanking: () => {
        set({ userRanking: [], ...IDLE_STATE });
        fetch('/api/rankings', { method: 'DELETE', credentials: 'include' }).catch(() => {});
      },

      removeFromRanking: (id: string) => {
        const { userRanking } = get();
        set({ userRanking: userRanking.filter(rid => rid !== id) });
        debouncedSync(get());
      },

      rerankRestaurant: (id: string) => {
        const { userRanking, restaurants } = get();
        if (!userRanking.includes(id)) return;
        const filteredRanking = userRanking.filter(rid => rid !== id);
        if (filteredRanking.length === 0) {
          set({ userRanking: [id] });
          debouncedSync(get());
          return;
        }
        const insertionState = beginInsertion(id, filteredRanking, restaurants);
        set({
          userRanking: filteredRanking,
          pendingToRank: [],
          rankingProgress: { current: 1, total: 1 },
          isReranking: true,
          matchupSessionId: `rerank_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ...insertionState,
        });
      },

      cancelBatchRanking: () => {
        set(IDLE_STATE);
      },

      undoMatchup: () => {
        const { matchupUndoStack } = get();
        if (matchupUndoStack.length === 0) return;
        const prev = matchupUndoStack[matchupUndoStack.length - 1];
        set({
          mode: prev.mode,
          pendingItem: prev.pendingItem,
          userRanking: prev.userRanking,
          insertionLow: prev.insertionLow,
          insertionHigh: prev.insertionHigh,
          verificationIndex: prev.verificationIndex,
          verificationDirection: prev.verificationDirection,
          verificationIterations: prev.verificationIterations,
          currentMatchup: prev.currentMatchup,
          matchupHistory: prev.matchupHistory,
          pendingToRank: prev.pendingToRank,
          rankingProgress: prev.rankingProgress,
          isReranking: prev.isReranking,
          matchupUndoStack: matchupUndoStack.slice(0, -1),
        });
      },

      setHomeArea: (area: HomeArea | null) => {
        set({ homeArea: area });
      },

      setChainBias: (pref: ChainBiasPreference) => {
        set({ chainBias: pref });
      },

      setFeatureFlag: (flag: keyof FeatureFlags, value: boolean) => {
        set(state => ({
          featureFlags: { ...state.featureFlags, [flag]: value },
        }));
      },

      setActiveBucket: (bucket: VenueBucket) => {
        if (syncTimeout) {
          clearTimeout(syncTimeout);
          syncTimeout = null;
        }
        set({ activeBucket: bucket, serverDataLoaded: false });
        loadRankingsFromServer(bucket).then((data) => {
          if (data) {
            useStore.setState({
              restaurants: data.restaurants,
              userRanking: data.ranking,
              rankingMovements: data.movements || {},
              mode: 'idle',
              pendingItem: null,
              pendingToRank: [],
              rankingProgress: null,
              serverDataLoaded: true,
            });
          } else {
            useStore.setState({
              restaurants: [],
              userRanking: [],
              mode: 'idle',
              pendingItem: null,
              pendingToRank: [],
              rankingProgress: null,
              serverDataLoaded: true,
            });
          }
        });
      },

      startFullTournament: () => {
        set({ mode: 'idle' });
      },

      addRestaurantToRank: (id: string) => {
        const { userRanking, restaurants } = get();
        if (userRanking.includes(id)) return;
        const sessionId = `single_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const insertionState = beginInsertion(id, userRanking, restaurants);
        if (insertionState.mode === 'idle') {
          set({ ...insertionState, pendingToRank: [], rankingProgress: null, matchupSessionId: null, isReranking: false });
          debouncedSync(get());
          return;
        }
        set({
          ...insertionState,
          pendingToRank: [],
          rankingProgress: { current: 1, total: 1 },
          matchupSessionId: sessionId,
          isReranking: false,
        });
      },

      startBatchRanking: (ids: string[]) => {
        const { userRanking, restaurants } = get();
        const toRank = ids.filter(id => !userRanking.includes(id));
        if (toRank.length === 0) return;

        const sessionId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const total = toRank.length;
        const firstId = toRank[0];
        const remaining = toRank.slice(1);

        const insertionState = beginInsertion(firstId, userRanking, restaurants);
        if (insertionState.mode === 'idle') {
          const updatedRanking = insertionState.userRanking!;
          if (remaining.length === 0) {
            set({ ...insertionState, pendingToRank: [], rankingProgress: null, matchupSessionId: null, isReranking: false });
            debouncedSync(get());
            return;
          }
          const nextId = remaining[0];
          const nextRemaining = remaining.slice(1);
          const nextState = beginInsertion(nextId, updatedRanking, restaurants);
          set({
            ...nextState,
            userRanking: updatedRanking,
            pendingToRank: nextRemaining,
            rankingProgress: { current: 2, total },
            matchupSessionId: sessionId,
            isReranking: false,
          });
          if (nextState.mode === 'idle') {
            debouncedSync(get());
          }
          return;
        }

        set({
          ...insertionState,
          pendingToRank: remaining,
          rankingProgress: { current: 1, total },
          matchupSessionId: sessionId,
          isReranking: false,
        });
      },

      resolveMatchup: (winnerId: string) => {
        const { mode, pendingItem, userRanking, insertionLow, insertionHigh, restaurants, pendingToRank, rankingProgress, verificationIndex, verificationDirection, verificationIterations, matchupHistory, matchupSessionId, isReranking, matchupUndoStack, currentMatchup } = get();

        const snapshot: MatchupSnapshot = {
          mode,
          pendingItem,
          userRanking: [...userRanking],
          insertionLow,
          insertionHigh,
          verificationIndex,
          verificationDirection,
          verificationIterations,
          currentMatchup,
          matchupHistory: { ...matchupHistory },
          pendingToRank: [...pendingToRank],
          rankingProgress: rankingProgress ? { ...rankingProgress } : null,
          isReranking,
        };
        const newUndoStack = [...matchupUndoStack, snapshot];
        set({ matchupUndoStack: newUndoStack });

        const proceedToNextOrIdle = (ranking: string[]) => {
          if (pendingToRank.length > 0) {
            const nextId = pendingToRank[0];
            const nextRemaining = pendingToRank.slice(1);
            const total = rankingProgress?.total ?? 1;
            const currentNum = (rankingProgress?.current ?? 0) + 1;

            const insertionState = beginInsertion(nextId, ranking, restaurants);

            if (insertionState.mode === 'idle') {
              const updatedRanking = insertionState.userRanking!;
              if (nextRemaining.length === 0) {
                set({ userRanking: updatedRanking, ...IDLE_STATE });
                debouncedSync(get());
                return;
              }
              const next2Id = nextRemaining[0];
              const next2Remaining = nextRemaining.slice(1);
              const next2State = beginInsertion(next2Id, updatedRanking, restaurants);
              set({
                ...next2State,
                userRanking: updatedRanking,
                pendingToRank: next2Remaining,
                rankingProgress: { current: currentNum + 1, total },
              });
              if (next2State.mode === 'idle') {
                debouncedSync(get());
              }
              return;
            }

            set({
              ...insertionState,
              userRanking: ranking,
              pendingToRank: nextRemaining,
              rankingProgress: { current: currentNum, total },
            });
          } else {
            set({ userRanking: ranking, ...IDLE_STATE });
            debouncedSync(get());
          }
        };

        if (mode === 'insertion' && pendingItem) {
          const mid = Math.floor((insertionLow + insertionHigh) / 2);
          const opponentId = userRanking[mid];
          const localHistory = { ...matchupHistory, [pairKey(pendingItem, opponentId)]: winnerId };
          let newLow = insertionLow;
          let newHigh = insertionHigh;

          const loserId = winnerId === pendingItem ? opponentId : pendingItem;
          const source: MatchupSource = isReranking ? 'rerank' : 'insert_binary';
          logMatchup(winnerId, loserId, source, restaurants, matchupSessionId);

          if (winnerId === pendingItem) {
            newHigh = mid;
          } else {
            newLow = mid + 1;
          }

          if (newLow >= newHigh) {
            const newRanking = [...userRanking];
            newRanking.splice(newLow, 0, pendingItem);
            const result = resolveVerificationLoop(pendingItem, newLow, newRanking, localHistory, 0, 'up');
            if (result) {
              set({
                matchupHistory: localHistory,
                userRanking: result.ranking,
                verificationIndex: result.idx,
                verificationDirection: result.dir,
                verificationIterations: result.iters,
                mode: 'verification' as const,
                pendingItem: pendingItem,
                currentMatchup: {
                  a: restaurants.find((r: Restaurant) => r.id === pendingItem)!,
                  b: restaurants.find((r: Restaurant) => r.id === result.nextNeighborId)!,
                },
              });
            } else {
              set({ matchupHistory: localHistory });
              proceedToNextOrIdle(newRanking);
            }
          } else {
            const newMid = Math.floor((newLow + newHigh) / 2);
            set({
              matchupHistory: localHistory,
              insertionLow: newLow,
              insertionHigh: newHigh,
              currentMatchup: {
                a: restaurants.find((r: Restaurant) => r.id === pendingItem)!,
                b: restaurants.find((r: Restaurant) => r.id === userRanking[newMid])!
              }
            });
          }
        } else if (mode === 'verification' && pendingItem) {
          const ranking = [...userRanking];
          const localHistory = { ...matchupHistory };
          let idx = verificationIndex;
          let dir: 'up' | 'down' = verificationDirection;
          const currentOpponentId = dir === 'up' && idx > 0
            ? ranking[idx - 1]
            : dir === 'down' && idx < ranking.length - 1
            ? ranking[idx + 1]
            : null;
          if (currentOpponentId) {
            localHistory[pairKey(pendingItem, currentOpponentId)] = winnerId;
            const vLoserId = winnerId === pendingItem ? currentOpponentId : pendingItem;
            const vSource: MatchupSource = isReranking ? 'rerank' : 'neighbor_verify';
            logMatchup(winnerId, vLoserId, vSource, restaurants, matchupSessionId);
          }

          const result = resolveVerificationLoop(pendingItem, idx, ranking, localHistory, verificationIterations + 1, dir, winnerId);
          if (result) {
            set({
              matchupHistory: localHistory,
              userRanking: result.ranking,
              verificationIndex: result.idx,
              verificationDirection: result.dir,
              verificationIterations: result.iters,
              currentMatchup: {
                a: restaurants.find((r: Restaurant) => r.id === pendingItem)!,
                b: restaurants.find((r: Restaurant) => r.id === result.nextNeighborId)!,
              },
            });
          } else {
            set({ matchupHistory: localHistory });
            proceedToNextOrIdle(ranking);
          }
        }
      }
    }),
    {
      name: 'take-chattanooga-storage',
      version: 9,
      partialize: (state) => ({
        homeArea: state.homeArea,
        chainBias: state.chainBias,
        featureFlags: state.featureFlags,
        activeBucket: state.activeBucket,
      }),
      migrate: (persistedState: any, version: number) => {
        const state = persistedState as any;
        if (version < 3) {
          state.restaurants = (state.restaurants || []).filter(
            (r: any) => !MOCK_RESTAURANT_IDS.includes(r.id)
          );
          state.userRanking = (state.userRanking || []).filter(
            (id: string) => !MOCK_RESTAURANT_IDS.includes(id)
          );
        }
        if (version < 4) {
          if (!state.homeArea) {
            state.homeArea = { label: "Chattanooga, TN", lat: 35.0456, lng: -85.3097 };
          }
        }
        if (version < 5) {
          if (!state.chainBias) {
            state.chainBias = 'auto';
          }
        }
        if (version < 6) {
          delete state.userId;
        }
        if (version < 7) {
          state.pendingToRank = [];
          state.rankingProgress = null;
        }
        if (version < 8) {
          state.userRanking = [];
        }
        if (version < 9) {
          delete state.restaurants;
          delete state.userRanking;
        }
        return persistedState as AppState;
      },
    }
  )
);
