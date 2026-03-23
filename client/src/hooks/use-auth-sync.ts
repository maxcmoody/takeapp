import { useEffect, useRef } from "react";
import { useAuth } from "./use-auth";
import { useStore, loadRankingsFromServer } from "@/lib/store";

export function useAuthSync() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeBucket = useStore(s => s.activeBucket);
  const hasLoaded = useRef(false);
  const lastUserId = useRef<string | null>(null);
  const lastBucket = useRef(activeBucket);
  const redirectChecked = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated && user && !redirectChecked.current) {
      redirectChecked.current = true;
      const pendingCode = sessionStorage.getItem("pendingInviteCode");
      if (pendingCode) {
        sessionStorage.removeItem("pendingInviteCode");
        window.location.replace(`/invite/${pendingCode}`);
      }
    }

    if (isAuthenticated && user && user.id !== lastUserId.current) {
      lastUserId.current = user.id;
      hasLoaded.current = false;
    }

    if (isAuthenticated && user && activeBucket !== lastBucket.current) {
      lastBucket.current = activeBucket;
      hasLoaded.current = false;
    }

    if (isAuthenticated && user && !hasLoaded.current) {
      hasLoaded.current = true;
      useStore.setState({ serverDataLoaded: false });
      loadRankingsFromServer(activeBucket).then((data) => {
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
            serverDataLoaded: false,
          });
        }
      });
    }

    if (!isAuthenticated) {
      if (lastUserId.current) {
        lastUserId.current = null;
        hasLoaded.current = false;
      }
      useStore.setState({
        restaurants: [],
        userRanking: [],
        mode: 'idle',
        pendingItem: null,
        pendingToRank: [],
        rankingProgress: null,
        serverDataLoaded: false,
      });
    }
  }, [isAuthenticated, isLoading, user, activeBucket]);
}
