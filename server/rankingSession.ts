import { storage } from "./storage";
import type { RankingSession, VenueBucket } from "@shared/schema";

export type InsertionPhase = "binary" | "verification" | "done";

export interface InsertionStateData {
  phase: InsertionPhase;
  low: number;
  high: number;
  matchupHistory: Record<string, string>;
  verificationIndex: number;
  verificationDirection: "up" | "down";
  verificationIterations: number;
  currentMatchup: { aId: string; bId: string } | null;
  lastVoteKey?: string;
}

export interface SessionMatchup {
  sessionId: string;
  currentIndex: number;
  totalQueue: number;
  currentPlaceId: string;
  matchup: { aId: string; bId: string };
  phase: InsertionPhase;
}

export interface SessionComplete {
  sessionId: string;
  status: "completed";
  insertedCount: number;
}

export type SessionAdvanceResult =
  | { type: "matchup"; data: SessionMatchup }
  | { type: "completed"; data: SessionComplete }
  | { type: "error"; message: string };

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function createInitialInsertionState(
  placeRestaurantId: string,
  ranking: string[]
): InsertionStateData {
  if (ranking.length === 0) {
    return {
      phase: "done",
      low: 0,
      high: 0,
      matchupHistory: {},
      verificationIndex: 0,
      verificationDirection: "up",
      verificationIterations: 0,
      currentMatchup: null,
    };
  }
  const mid = Math.floor(ranking.length / 2);
  return {
    phase: "binary",
    low: 0,
    high: ranking.length,
    matchupHistory: {},
    verificationIndex: 0,
    verificationDirection: "up",
    verificationIterations: 0,
    currentMatchup: { aId: placeRestaurantId, bId: ranking[mid] },
  };
}

function computeNextVerification(
  pendingId: string,
  idx: number,
  ranking: string[],
  history: Record<string, string>,
  iters: number,
  dir: "up" | "down",
  firstWinner?: string
): {
  ranking: string[];
  idx: number;
  dir: "up" | "down";
  iters: number;
  nextNeighborId: string;
} | null {
  const MAX_ITERS = 10;
  let currentIdx = idx;
  let currentIters = iters;
  let currentDir = dir;
  let currentWinner = firstWinner;
  const workingRanking = [...ranking];

  if (currentIters >= MAX_ITERS) return null;

  if (currentWinner === undefined) {
    if (currentDir === "up" && currentIdx > 0) {
      const neighborId = workingRanking[currentIdx - 1];
      const cached: string | undefined = history[pairKey(pendingId, neighborId)];
      if (cached) {
        currentWinner = cached;
      } else {
        return { ranking: workingRanking, idx: currentIdx, dir: currentDir, iters: currentIters, nextNeighborId: neighborId };
      }
    } else if (currentDir === "down" && currentIdx < workingRanking.length - 1) {
      const neighborId = workingRanking[currentIdx + 1];
      const cached: string | undefined = history[pairKey(pendingId, neighborId)];
      if (cached) {
        currentWinner = cached;
      } else {
        return { ranking: workingRanking, idx: currentIdx, dir: currentDir, iters: currentIters, nextNeighborId: neighborId };
      }
    } else {
      return null;
    }
  }

  while (currentIters < MAX_ITERS) {
    if (currentDir === "up") {
      if (currentWinner === pendingId) {
        const aboveIdx = currentIdx - 1;
        if (aboveIdx < 0) return null;
        [workingRanking[currentIdx], workingRanking[aboveIdx]] = [workingRanking[aboveIdx], workingRanking[currentIdx]];
        currentIdx = aboveIdx;
        if (currentIdx > 0) {
          const neighborId = workingRanking[currentIdx - 1];
          const cached: string | undefined = history[pairKey(pendingId, neighborId)];
          if (cached) {
            currentWinner = cached;
            currentIters++;
            continue;
          }
          return { ranking: workingRanking, idx: currentIdx, dir: "up", iters: currentIters, nextNeighborId: neighborId };
        } else {
          currentDir = "down";
          if (currentIdx >= workingRanking.length - 1) return null;
          const neighborId = workingRanking[currentIdx + 1];
          const cached2: string | undefined = history[pairKey(pendingId, neighborId)];
          if (cached2) {
            currentWinner = cached2;
            currentIters++;
            continue;
          }
          return { ranking: workingRanking, idx: currentIdx, dir: "down", iters: currentIters, nextNeighborId: neighborId };
        }
      } else {
        currentDir = "down";
        if (currentIdx >= workingRanking.length - 1) return null;
        const neighborId = workingRanking[currentIdx + 1];
        const cached3: string | undefined = history[pairKey(pendingId, neighborId)];
        if (cached3) {
          currentWinner = cached3;
          currentIters++;
          continue;
        }
        return { ranking: workingRanking, idx: currentIdx, dir: "down", iters: currentIters, nextNeighborId: neighborId };
      }
    } else {
      if (currentWinner !== pendingId) {
        const belowIdx = currentIdx + 1;
        if (belowIdx >= workingRanking.length) return null;
        [workingRanking[currentIdx], workingRanking[belowIdx]] = [workingRanking[belowIdx], workingRanking[currentIdx]];
        currentIdx = belowIdx;
        if (currentIdx < workingRanking.length - 1) {
          const neighborId = workingRanking[currentIdx + 1];
          const cached4: string | undefined = history[pairKey(pendingId, neighborId)];
          if (cached4) {
            currentWinner = cached4;
            currentIters++;
            continue;
          }
          return { ranking: workingRanking, idx: currentIdx, dir: "down", iters: currentIters, nextNeighborId: neighborId };
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

export async function startSession(
  userId: string,
  restaurantIds: string[],
  bucket: VenueBucket = "restaurant"
): Promise<SessionAdvanceResult> {
  await storage.abandonActiveRankingSessions(userId, bucket);

  const existingRankings = await storage.getUserRankings(userId, bucket);
  const rankedRestaurantIds = new Set(existingRankings.map(r => r.restaurant.id));
  const rankingOrder = existingRankings
    .sort((a, b) => a.rankPosition - b.rankPosition)
    .map(r => r.restaurant.id);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const id of restaurantIds) {
    if (!seen.has(id) && !rankedRestaurantIds.has(id)) {
      seen.add(id);
      deduped.push(id);
    }
  }

  if (deduped.length === 0) {
    return { type: "completed", data: { sessionId: "", status: "completed", insertedCount: 0 } };
  }

  const firstId = deduped[0];
  const insertionState = createInitialInsertionState(firstId, rankingOrder);

  if (insertionState.phase === "done") {
    const newRanking = [...rankingOrder, firstId];
    if (deduped.length === 1) {
      await commitRankingToDb(userId, newRanking, bucket);
      return { type: "completed", data: { sessionId: "", status: "completed", insertedCount: 1 } };
    }
    const secondId = deduped[1];
    const secondState = createInitialInsertionState(secondId, newRanking);
    if (secondState.phase === "done") {
      const finalRanking = [...newRanking, secondId];
      let inserted = 2;
      let currentRanking = finalRanking;
      let queueIdx = 2;
      while (queueIdx < deduped.length) {
        const nextId = deduped[queueIdx];
        const nextState = createInitialInsertionState(nextId, currentRanking);
        if (nextState.phase !== "done") {
          const session = await storage.createRankingSession({
            userId,
            queue: deduped,
            currentIndex: queueIdx,
            currentPlaceId: nextId,
            insertionState: nextState as any,
            userRankingOrder: currentRanking,
            status: "active",
            bucket,
          });
          return {
            type: "matchup",
            data: {
              sessionId: session.id,
              currentIndex: queueIdx,
              totalQueue: deduped.length,
              currentPlaceId: nextId,
              matchup: nextState.currentMatchup!,
              phase: nextState.phase,
            },
          };
        }
        currentRanking = [...currentRanking, nextId];
        inserted++;
        queueIdx++;
      }
      await commitRankingToDb(userId, currentRanking, bucket);
      return { type: "completed", data: { sessionId: "", status: "completed", insertedCount: inserted } };
    }
    const session = await storage.createRankingSession({
      userId,
      queue: deduped,
      currentIndex: 1,
      currentPlaceId: secondId,
      insertionState: secondState as any,
      userRankingOrder: newRanking,
      status: "active",
      bucket,
    });
    return {
      type: "matchup",
      data: {
        sessionId: session.id,
        currentIndex: 1,
        totalQueue: deduped.length,
        currentPlaceId: secondId,
        matchup: secondState.currentMatchup!,
        phase: secondState.phase,
      },
    };
  }

  const session = await storage.createRankingSession({
    userId,
    queue: deduped,
    currentIndex: 0,
    currentPlaceId: firstId,
    insertionState: insertionState as any,
    userRankingOrder: rankingOrder,
    status: "active",
    bucket,
  });

  return {
    type: "matchup",
    data: {
      sessionId: session.id,
      currentIndex: 0,
      totalQueue: deduped.length,
      currentPlaceId: firstId,
      matchup: insertionState.currentMatchup!,
      phase: insertionState.phase,
    },
  };
}

export async function getActiveSession(
  userId: string,
  bucket?: VenueBucket
): Promise<SessionAdvanceResult | null> {
  const session = await storage.getActiveRankingSession(userId, bucket);
  if (!session) return null;

  const state = session.insertionState as unknown as InsertionStateData;
  if (!state?.currentMatchup || !session.currentPlaceId) {
    return null;
  }

  return {
    type: "matchup",
    data: {
      sessionId: session.id,
      currentIndex: session.currentIndex,
      totalQueue: (session.queue || []).length,
      currentPlaceId: session.currentPlaceId,
      matchup: state.currentMatchup,
      phase: state.phase,
    },
  };
}

export async function processVote(
  userId: string,
  winnerId: string,
  bucket?: VenueBucket
): Promise<SessionAdvanceResult> {
  const session = await storage.getActiveRankingSession(userId, bucket);
  if (!session) {
    return { type: "error", message: "No active ranking session" };
  }

  const state = session.insertionState as unknown as InsertionStateData;
  if (!state?.currentMatchup || !session.currentPlaceId) {
    return { type: "error", message: "Session has no active comparison" };
  }

  const { aId, bId } = state.currentMatchup;
  if (winnerId !== aId && winnerId !== bId) {
    return { type: "error", message: "Winner must be one of the compared restaurants" };
  }

  const voteKey = `${aId}:${bId}:${winnerId}`;
  if (state.lastVoteKey === voteKey) {
    return getActiveSession(userId, bucket) as Promise<SessionAdvanceResult>;
  }

  const pendingId = session.currentPlaceId;
  const ranking = [...(session.userRankingOrder || [])];
  const queue = session.queue || [];

  const history = { ...state.matchupHistory };
  const opponentId = aId === pendingId ? bId : aId;
  history[pairKey(pendingId, opponentId)] = winnerId;

  if (state.phase === "binary") {
    const mid = Math.floor((state.low + state.high) / 2);
    let newLow = state.low;
    let newHigh = state.high;

    if (winnerId === pendingId) {
      newHigh = mid;
    } else {
      newLow = mid + 1;
    }

    if (newLow >= newHigh) {
      const newRanking = [...ranking];
      newRanking.splice(newLow, 0, pendingId);
      const verResult = computeNextVerification(pendingId, newLow, newRanking, history, 0, "up");
      if (verResult) {
        const newState: InsertionStateData = {
          phase: "verification",
          low: newLow,
          high: newHigh,
          matchupHistory: history,
          verificationIndex: verResult.idx,
          verificationDirection: verResult.dir,
          verificationIterations: verResult.iters,
          currentMatchup: { aId: pendingId, bId: verResult.nextNeighborId },
          lastVoteKey: voteKey,
        };
        await storage.updateRankingSession(session.id, {
          insertionState: newState as any,
          userRankingOrder: verResult.ranking,
        });
        return {
          type: "matchup",
          data: {
            sessionId: session.id,
            currentIndex: session.currentIndex,
            totalQueue: queue.length,
            currentPlaceId: pendingId,
            matchup: newState.currentMatchup!,
            phase: "verification",
          },
        };
      } else {
        return await commitAndAdvance(session, newRanking, queue, userId);
      }
    } else {
      const newMid = Math.floor((newLow + newHigh) / 2);
      const newState: InsertionStateData = {
        ...state,
        low: newLow,
        high: newHigh,
        matchupHistory: history,
        currentMatchup: { aId: pendingId, bId: ranking[newMid] },
        lastVoteKey: voteKey,
      };
      await storage.updateRankingSession(session.id, {
        insertionState: newState as any,
      });
      return {
        type: "matchup",
        data: {
          sessionId: session.id,
          currentIndex: session.currentIndex,
          totalQueue: queue.length,
          currentPlaceId: pendingId,
          matchup: newState.currentMatchup!,
          phase: "binary",
        },
      };
    }
  } else if (state.phase === "verification") {
    const verResult = computeNextVerification(
      pendingId,
      state.verificationIndex,
      ranking,
      history,
      state.verificationIterations + 1,
      state.verificationDirection,
      winnerId
    );
    if (verResult) {
      const newState: InsertionStateData = {
        ...state,
        matchupHistory: history,
        verificationIndex: verResult.idx,
        verificationDirection: verResult.dir,
        verificationIterations: verResult.iters,
        currentMatchup: { aId: pendingId, bId: verResult.nextNeighborId },
        lastVoteKey: voteKey,
      };
      await storage.updateRankingSession(session.id, {
        insertionState: newState as any,
        userRankingOrder: verResult.ranking,
      });
      return {
        type: "matchup",
        data: {
          sessionId: session.id,
          currentIndex: session.currentIndex,
          totalQueue: queue.length,
          currentPlaceId: pendingId,
          matchup: newState.currentMatchup!,
          phase: "verification",
        },
      };
    } else {
      return await commitAndAdvance(session, ranking, queue, userId);
    }
  }

  return { type: "error", message: "Invalid session state" };
}

async function commitAndAdvance(
  session: RankingSession,
  finalRanking: string[],
  queue: string[],
  userId: string
): Promise<SessionAdvanceResult> {
  const sessionBucket = (session.bucket as VenueBucket) || "restaurant";
  const nextIndex = session.currentIndex + 1;

  if (nextIndex >= queue.length) {
    await commitRankingToDb(userId, finalRanking, sessionBucket);
    await storage.updateRankingSession(session.id, {
      status: "completed",
      userRankingOrder: finalRanking,
      currentIndex: nextIndex,
      currentPlaceId: null,
      insertionState: { phase: "done", currentMatchup: null } as any,
    });
    return {
      type: "completed",
      data: { sessionId: session.id, status: "completed", insertedCount: queue.length },
    };
  }

  const nextPlaceId = queue[nextIndex];
  const nextState = createInitialInsertionState(nextPlaceId, finalRanking);

  if (nextState.phase === "done") {
    const newRanking = [...finalRanking, nextPlaceId];
    const updatedSession = { ...session, currentIndex: nextIndex, userRankingOrder: newRanking, queue };
    return await commitAndAdvance(updatedSession as RankingSession, newRanking, queue, userId);
  }

  await storage.updateRankingSession(session.id, {
    currentIndex: nextIndex,
    currentPlaceId: nextPlaceId,
    insertionState: nextState as any,
    userRankingOrder: finalRanking,
  });

  return {
    type: "matchup",
    data: {
      sessionId: session.id,
      currentIndex: nextIndex,
      totalQueue: queue.length,
      currentPlaceId: nextPlaceId,
      matchup: nextState.currentMatchup!,
      phase: nextState.phase,
    },
  };
}

async function commitRankingToDb(userId: string, rankingOrder: string[], bucket: VenueBucket = "restaurant"): Promise<void> {
  const rankings = rankingOrder.map((restaurantId, idx) => ({
    restaurantId,
    rankPosition: idx + 1,
    listLength: rankingOrder.length,
  }));
  await storage.syncUserRankings(userId, rankings, bucket);
}

export async function cancelSession(userId: string, bucket?: VenueBucket): Promise<boolean> {
  const session = await storage.getActiveRankingSession(userId, bucket);
  if (!session) return false;
  await storage.updateRankingSession(session.id, { status: "abandoned" });
  return true;
}
