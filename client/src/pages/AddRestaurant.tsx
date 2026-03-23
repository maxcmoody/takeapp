import { useStore, Restaurant } from "@/lib/store";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Search, Plus, MapPin, Check, Loader2, AlertTriangle, Star, TrendingUp, X, Info, LogIn, Trophy, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useDebounce } from "react-use";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useClerk } from "@clerk/clerk-react";
import { enrichTags, inferCategory } from "@shared/tagInference";
import { trackEvent } from "@/lib/analytics";

interface StagedPlace {
  place_id: string;
  name: string;
  address: string;
  types: string[];
  rating?: number;
  price_level?: number;
  photo_reference?: string;
  raw: any;
}

export default function AddRestaurant() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { openSignIn } = useClerk();
  const { restaurants, userRanking, addNewRestaurant, homeArea, chainBias, serverDataLoaded } = useStore();
  const sessionTokenRef = useRef(crypto.randomUUID());
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [nearbyPlaces, setNearbyPlaces] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [nearbyLoadingMore, setNearbyLoadingMore] = useState(false);
  const [nearbyNextToken, setNearbyNextToken] = useState<string | null>(null);
  const [nearbyHasMore, setNearbyHasMore] = useState(true);
  const [nearbyFetchError, setNearbyFetchError] = useState<string | null>(null);
  const [nearbyRatePaused, setNearbyRatePaused] = useState(false);
  const nearbyRatePauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyRadiusIdx = useRef(0);
  // Reduced from 5 to 3 radii — the two largest (75km, 100km) rarely add useful local results
  // and each triggers a fresh Google API call if the cache is cold.
  const NEARBY_RADII = [15000, 30000, 50000];
  const nearbyCategoryIdx = useRef(0);
  // Reduced category fallbacks: only fetch more categories when user explicitly scrolls.
  // Original had 12 auto-chaining requests; now capped at 6 most popular.
  const CATEGORY_FALLBACKS = [
    { keyword: 'pizza', type: 'restaurant' },
    { keyword: 'mexican', type: 'restaurant' },
    { keyword: 'bbq', type: 'restaurant' },
    { keyword: 'sushi', type: 'restaurant' },
    { keyword: 'burger', type: 'restaurant' },
    { keyword: 'breakfast', type: 'restaurant' },
  ];
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [stagedPlaces, setStagedPlaces] = useState<StagedPlace[]>([]);
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [showAlreadyRanked, setShowAlreadyRanked] = useState(false);
  
  const [currentLocation, setLocation] = useLocation();
  const { toast } = useToast();
  const isSeedMode = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('seed') === '1';
    } catch {
      return false;
    }
  }, [currentLocation]);

  const nearbySentinelRef = useRef<HTMLDivElement>(null);
  const nearbySeenIds = useRef(new Set<string>());
  const nearbySeenChainNames = useRef(new Set<string>());
  const nearbyIsFetching = useRef(false);
  const nearbyFetchGeneration = useRef(0);
  const nearbyAbortController = useRef<AbortController | null>(null);
  const nearbyConsecutiveEmpty = useRef(0);
  // Reduced from 5 — stop sooner to avoid burning through API budget on empty pages
  const MAX_CONSECUTIVE_EMPTY = 3;

  const rankedPlaceIds = new Set(
    restaurants
      .filter(r => userRanking.includes(r.id) && r.googlePlaceId)
      .map(r => r.googlePlaceId!)
  );

  const normalizeForMatch = useCallback((name: string): string => {
    return name
      .toLowerCase()
      .replace(/[''`]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }, []);

  const rankedNormalizedNames = useMemo(() => new Set(
    restaurants
      .filter(r => userRanking.includes(r.id))
      .map(r => normalizeForMatch(r.name))
  ), [restaurants, userRanking, normalizeForMatch]);

  const rankedNormalizedNamesArr = useMemo(() => Array.from(rankedNormalizedNames), [rankedNormalizedNames]);

  const fuzzyNameMatch = useCallback((a: string, b: string): boolean => {
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (shorter.length < 5) return false;
    const wordCount = shorter.split(" ").length;
    if (wordCount < 2) return false;
    if (longer.startsWith(shorter) && (longer.length === shorter.length || longer[shorter.length] === " ")) return true;
    return false;
  }, []);

  const isActuallyRanked = (placeId: string, name: string) => {
    if (rankedPlaceIds.has(placeId)) return true;
    const norm = normalizeForMatch(name);
    if (rankedNormalizedNames.has(norm)) return true;
    for (let i = 0; i < rankedNormalizedNamesArr.length; i++) {
      if (fuzzyNameMatch(norm, rankedNormalizedNamesArr[i])) return true;
    }
    return false;
  };

  const KNOWN_CHAINS = useMemo(() => new Set([
    "starbucks", "mcdonalds", "subway", "chipotle", "taco bell", "wendys",
    "burger king", "dunkin", "panera", "dominos", "pizza hut", "papa johns",
    "kfc", "chick-fil-a", "chickfila", "popeyes", "sonic", "arbys",
    "jack in the box", "whataburger", "five guys", "in-n-out", "shake shack",
    "panda express", "olive garden", "applebees", "chilis", "ihop",
    "dennys", "waffle house", "cracker barrel", "red lobster",
    "outback steakhouse", "longhorn steakhouse", "texas roadhouse",
    "buffalo wild wings", "wingstop", "zaxbys", "raising canes",
    "jersey mikes", "jimmy johns", "firehouse subs",
    "little caesars", "golden corral", "steak n shake", "culvers", "cookout",
    "checkers", "hardees", "carls jr", "bojangles",
    "dairy queen", "tropical smoothie", "smoothie king",
    "chipotle mexican grill", "white castle", "krispy kreme",
  ]), []);

  const normalizeChainName = useCallback((name: string): string => {
    return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  }, []);

  const isKnownChain = useCallback((name: string): boolean => {
    const norm = normalizeChainName(name);
    let found = false;
    KNOWN_CHAINS.forEach((chain) => {
      if (norm === chain || norm.startsWith(chain + " ") || norm.startsWith(chain + "#")) found = true;
    });
    return found;
  }, [normalizeChainName, KNOWN_CHAINS]);

  const filterNewResults = useCallback((results: any[]) => {
    return results.filter((p: any) => {
      if (nearbySeenIds.current.has(p.place_id)) return false;
      if (!showAlreadyRanked) {
        if (rankedPlaceIds.has(p.place_id)) return false;
        const norm = normalizeForMatch(p.name);
        if (rankedNormalizedNames.has(norm)) return false;
        for (let i = 0; i < rankedNormalizedNamesArr.length; i++) {
          if (fuzzyNameMatch(norm, rankedNormalizedNamesArr[i])) return false;
        }
      }
      const chainName = normalizeChainName(p.name);
      if (isKnownChain(p.name) && nearbySeenChainNames.current.has(chainName)) return false;
      nearbySeenIds.current.add(p.place_id);
      if (isKnownChain(p.name)) nearbySeenChainNames.current.add(chainName);
      return true;
    });
  }, [showAlreadyRanked, rankedPlaceIds, rankedNormalizedNames, rankedNormalizedNamesArr, normalizeForMatch, fuzzyNameMatch, normalizeChainName, isKnownChain]);

  const sortTakeFirst = useCallback((places: any[]) => {
    return [...places].sort((a, b) => {
      const aScore = a.take_score ?? 0;
      const bScore = b.take_score ?? 0;
      if (aScore > 0 && bScore === 0) return -1;
      if (aScore === 0 && bScore > 0) return 1;
      if (aScore > 0 && bScore > 0) return bScore - aScore;
      return 0;
    });
  }, []);

  // Category fallback: fetches ONE category page and stops.
  // The IntersectionObserver triggers subsequent pages on scroll — no auto-chaining.
  const fetchCategoryPage = useCallback(async () => {
    if (nearbyIsFetching.current) return;
    if (nearbyCategoryIdx.current >= CATEGORY_FALLBACKS.length) {
      setNearbyHasMore(false);
      setNearbyLoading(false);
      setNearbyLoadingMore(false);
      return;
    }
    nearbyIsFetching.current = true;
    setNearbyLoadingMore(true);

    const myGeneration = nearbyFetchGeneration.current;
    const cat = CATEGORY_FALLBACKS[nearbyCategoryIdx.current];
    nearbyCategoryIdx.current += 1;

    try {
      const params = new URLSearchParams();
      if (homeArea?.lat) params.set('lat', String(homeArea.lat));
      if (homeArea?.lng) params.set('lng', String(homeArea.lng));
      params.set('keyword', cat.keyword);
      params.set('type', cat.type);

      const res = await fetch(`/api/places/nearby/category?${params}`);
      if (myGeneration !== nearbyFetchGeneration.current) return;
      if (res.status === 429) {
        const errData = await res.json().catch(() => ({}));
        const retryMs = errData.retryAfterMs || 60000;
        setNearbyRatePaused(true);
        setNearbyLoading(false);
        setNearbyLoadingMore(false);
        if (nearbyRatePauseTimer.current) clearTimeout(nearbyRatePauseTimer.current);
        nearbyRatePauseTimer.current = setTimeout(() => {
          if (myGeneration === nearbyFetchGeneration.current) setNearbyRatePaused(false);
        }, Math.min(retryMs, 120000));
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (myGeneration !== nearbyFetchGeneration.current) return;
        const newResults = filterNewResults(data.results || []);
        if (newResults.length > 0) {
          nearbyConsecutiveEmpty.current = 0;
          setNearbyPlaces(prev => sortTakeFirst([...prev, ...newResults]));
        } else {
          nearbyConsecutiveEmpty.current += 1;
        }
        // Always mark hasMore based on whether there are more categories left —
        // don't auto-fetch them; let scroll trigger the next one.
        setNearbyHasMore(nearbyCategoryIdx.current < CATEGORY_FALLBACKS.length && nearbyConsecutiveEmpty.current < MAX_CONSECUTIVE_EMPTY);
      } else {
        setNearbyHasMore(false);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setNearbyHasMore(false);
      console.error("Category fallback fetch error", e);
    } finally {
      setNearbyLoading(false);
      setNearbyLoadingMore(false);
      nearbyIsFetching.current = false;
    }
  }, [homeArea?.lat, homeArea?.lng, filterNewResults, sortTakeFirst]);

  // Fetch ONE nearby page and stop. Radius expansion and category fallback
  // are triggered by the IntersectionObserver on scroll, not automatically.
  // This prevents the original behavior of firing up to 17 API calls per visit.
  const fetchNearbyPage = useCallback(async (pageToken?: string | null, radiusOverride?: number) => {
    if (nearbyIsFetching.current) return;
    nearbyIsFetching.current = true;
    const isFirstPage = !pageToken && !radiusOverride;
    if (isFirstPage) setNearbyLoading(true);
    else setNearbyLoadingMore(true);
    setNearbyFetchError(null);

    const myGeneration = nearbyFetchGeneration.current;

    try {
      const controller = new AbortController();
      nearbyAbortController.current = controller;

      const params = new URLSearchParams();
      if (homeArea?.lat) params.set('lat', String(homeArea.lat));
      if (homeArea?.lng) params.set('lng', String(homeArea.lng));
      if (pageToken) params.set('page_token', pageToken);
      if (radiusOverride) params.set('radius', String(radiusOverride));
      if (!showAlreadyRanked) {
        const excludeList = Array.from(rankedPlaceIds).join(',');
        if (excludeList) params.set('exclude', excludeList);
      }
      if (chainBias) params.set('biasChains', chainBias);
      params.set('rankedCount', String(userRanking.length));

      const res = await fetch(`/api/places/nearby?${params}`, { signal: controller.signal });

      if (myGeneration !== nearbyFetchGeneration.current) return;

      if (res.status === 503) {
        setApiKeyMissing(true);
        setManualMode(true);
        setNearbyHasMore(false);
        return;
      }
      if (res.status === 429) {
        const errData = await res.json().catch(() => ({}));
        const retryMs = errData.retryAfterMs || 60000;
        setNearbyRatePaused(true);
        setNearbyLoading(false);
        setNearbyLoadingMore(false);
        if (nearbyRatePauseTimer.current) clearTimeout(nearbyRatePauseTimer.current);
        nearbyRatePauseTimer.current = setTimeout(() => {
          if (myGeneration === nearbyFetchGeneration.current) setNearbyRatePaused(false);
        }, Math.min(retryMs, 120000));
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (myGeneration !== nearbyFetchGeneration.current) return;
        const newResults = filterNewResults(data.results || []);
        if (newResults.length > 0) {
          nearbyConsecutiveEmpty.current = 0;
          setNearbyPlaces(prev => {
            const merged = isFirstPage ? newResults : [...prev, ...newResults];
            return sortTakeFirst(merged);
          });
        } else {
          nearbyConsecutiveEmpty.current += 1;
        }

        const token = data.next_page_token || null;
        setNearbyNextToken(token);

        // Always set hasMore = true if there's more to load (next token, more radii, or categories).
        // The IntersectionObserver will trigger the actual next fetch on scroll.
        const hasNextToken = !!token;
        const hasMoreRadii = nearbyRadiusIdx.current + 1 < NEARBY_RADII.length;
        const hasMoreCategories = nearbyCategoryIdx.current < CATEGORY_FALLBACKS.length;
        const notTooManyEmpty = nearbyConsecutiveEmpty.current < MAX_CONSECUTIVE_EMPTY;

        if (!hasNextToken) {
          // Advance radius index for the next scroll-triggered fetch
          const nextIdx = nearbyRadiusIdx.current + 1;
          if (nextIdx < NEARBY_RADII.length) {
            nearbyRadiusIdx.current = nextIdx;
            nearbyConsecutiveEmpty.current = 0;
            setNearbyNextToken(null);
          }
        }

        setNearbyHasMore(
          notTooManyEmpty && (hasNextToken || hasMoreRadii || hasMoreCategories)
        );
      } else {
        const errMsg = `Fetch failed (${res.status})`;
        setNearbyFetchError(errMsg);
        setNearbyHasMore(false);
        console.error("Popular nearby fetch error:", errMsg);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const errMsg = e instanceof Error ? e.message : "Network error";
      setNearbyFetchError(errMsg);
      setNearbyHasMore(false);
      console.error("Failed to fetch nearby places", e);
    } finally {
      setNearbyLoading(false);
      setNearbyLoadingMore(false);
      nearbyIsFetching.current = false;
    }
  }, [homeArea?.lat, homeArea?.lng, rankedPlaceIds, rankedNormalizedNames, chainBias, showAlreadyRanked, filterNewResults, fetchCategoryPage, sortTakeFirst]);

  useEffect(() => {
    if (nearbyAbortController.current) {
      nearbyAbortController.current.abort();
      nearbyAbortController.current = null;
    }
    nearbyFetchGeneration.current += 1;
    nearbyIsFetching.current = false;
    nearbySeenIds.current.clear();
    nearbySeenChainNames.current.clear();
    nearbyRadiusIdx.current = 0;
    nearbyCategoryIdx.current = 0;
    nearbyConsecutiveEmpty.current = 0;
    setNearbyPlaces([]);
    setNearbyNextToken(null);
    setNearbyHasMore(true);
    setNearbyRatePaused(false);
    if (nearbyRatePauseTimer.current) { clearTimeout(nearbyRatePauseTimer.current); nearbyRatePauseTimer.current = null; }
    fetchNearbyPage(null);
  }, [homeArea?.lat, homeArea?.lng, chainBias, showAlreadyRanked]);

  useEffect(() => {
    return () => { if (nearbyRatePauseTimer.current) clearTimeout(nearbyRatePauseTimer.current); };
  }, []);

  useEffect(() => {
    if (!nearbySentinelRef.current || !nearbyHasMore) return;
    const scrollRoot = nearbySentinelRef.current.closest('main');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nearbyHasMore && !nearbyIsFetching.current && !nearbyRatePaused) {
          if (nearbyNextToken) {
            fetchNearbyPage(nearbyNextToken);
          } else if (nearbyRadiusIdx.current < NEARBY_RADII.length) {
            fetchNearbyPage(null, NEARBY_RADII[nearbyRadiusIdx.current]);
          } else {
            fetchCategoryPage();
          }
        }
      },
      { root: scrollRoot, rootMargin: '200px' }
    );
    observer.observe(nearbySentinelRef.current);
    return () => observer.disconnect();
  }, [nearbyHasMore, nearbyNextToken, nearbyPlaces.length, nearbyRatePaused, fetchNearbyPage, fetchCategoryPage]);

  useDebounce(
    () => {
      setDebouncedQuery(query);
    },
    500,
    [query]
  );

  useEffect(() => {
    if (!debouncedQuery || manualMode) return;
    if (debouncedQuery.length < 3) {
      setSuggestions([]);
      return;
    }

    const fetchSuggestions = async () => {
      setIsLoading(true);
      try {
        const acParams = new URLSearchParams({ input: debouncedQuery });
        if (homeArea?.lat) acParams.set('lat', String(homeArea.lat));
        if (homeArea?.lng) acParams.set('lng', String(homeArea.lng));
        acParams.set('sessiontoken', sessionTokenRef.current);
        const res = await fetch(`/api/places/autocomplete?${acParams}`);
        
        if (res.status === 503) {
            const errData = await res.json().catch(() => ({}));
            console.error("Places API error:", errData.message || errData.error);
            setApiKeyMissing(true);
            setManualMode(true);
            return;
        }

        const data = await res.json();
        if (data.predictions && data.predictions.length > 0) {
          setSuggestions(data.predictions);
        } else {
          setSuggestions([]);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSuggestions();
  }, [debouncedQuery, manualMode]);

  const handleSelectPlace = async (placeId: string) => {
    setIsLoading(true);
    try {
        const res = await fetch(`/api/places/details?place_id=${placeId}&sessiontoken=${sessionTokenRef.current}`);
        if (res.status === 503) {
            setApiKeyMissing(true);
            setManualMode(true);
            setSuggestions([]);
            return;
        }
        const data = await res.json();
        if (data.result) {
            setSelectedPlace({ ...data.result, place_id: placeId });
        }
    } catch (e) {
        console.error(e);
    } finally {
        setIsLoading(false);
        setSuggestions([]);
        sessionTokenRef.current = crypto.randomUUID();
    }
  };

  const isStaged = (placeId: string, name: string) => {
    return stagedPlaces.some(s => 
      s.place_id === placeId || s.name.toLowerCase() === name.toLowerCase()
    );
  };

  const handleStagePlace = () => {
    if (!selectedPlace) return;

    if (isStaged(selectedPlace.place_id, selectedPlace.name)) {
      setSelectedPlace(null);
      setQuery("");
      return;
    }

    const staged: StagedPlace = {
      place_id: selectedPlace.place_id,
      name: selectedPlace.name,
      address: selectedPlace.formatted_address || selectedPlace.vicinity || "",
      types: selectedPlace.types || [],
      rating: selectedPlace.rating,
      price_level: selectedPlace.price_level,
      photo_reference: selectedPlace.photos?.[0]?.photo_reference || selectedPlace.photo_reference,
      raw: selectedPlace,
    };

    setStagedPlaces(prev => [...prev, staged]);
    setSelectedPlace(null);
    setQuery("");
  };

  const handleUnstage = (placeId: string) => {
    setStagedPlaces(prev => prev.filter(s => s.place_id !== placeId));
  };

  const saveAndAddRestaurant = async (place: StagedPlace): Promise<string | null> => {
    const existing = restaurants.find(r => 
      r.googlePlaceId === place.place_id || 
      r.name.toLowerCase() === place.name.toLowerCase()
    );
    if (existing) {
      if (!userRanking.includes(existing.id)) {
        return existing.id;
      }
      return null;
    }

    const placeRating = typeof place.rating === 'number' ? place.rating : 0;
    const placePriceLevel = typeof place.price_level === 'number' ? place.price_level : 2;

    const newRestaurant: Partial<Restaurant> = {
        name: place.name,
        image: place.photo_reference
            ? `/api/places/photo?ref=${encodeURIComponent(place.photo_reference)}${place.place_id ? `&placeId=${encodeURIComponent(place.place_id)}` : ''}`
            : 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400&q=80',
        tags: enrichTags(place.name, place.types, place.types).slice(0, 5),
        location: place.address,
        category: inferCategory(place.name, place.types, place.types, place.types?.[0]),
        rating: placeRating,
        votes: 0,
        priceLevel: placePriceLevel,
        googlePlaceId: place.place_id,
        googleTypes: place.types || [],
        googlePrimaryType: place.types?.[0],
    };

    const tempId = `place_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    try {
        const res = await fetch('/api/restaurants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...newRestaurant,
                rating: String(placeRating),
                votes: "0",
                priceLevel: String(placePriceLevel),
                googlePlaceId: place.place_id
            })
        });
        const saved = await res.json();
        
        if (saved.success) {
            const finalRestaurant = { ...newRestaurant, id: saved.id } as Restaurant;
            addNewRestaurant(finalRestaurant);
            return finalRestaurant.id;
        }
    } catch (e) {
        console.error("Failed to save to DB", e);
    }

    const fallbackRestaurant = { ...newRestaurant, id: tempId } as Restaurant;
    addNewRestaurant(fallbackRestaurant);
    return fallbackRestaurant.id;
  };

  const startServerSession = async (restaurantIds: string[]) => {
    try {
      const res = await fetch('/api/ranking-sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ restaurantIds, bucket: useStore.getState().activeBucket }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.type === 'completed') {
        const { loadRankingsFromServer } = await import('@/lib/store');
        const serverData = await loadRankingsFromServer(useStore.getState().activeBucket);
        if (serverData) {
          useStore.setState({
            restaurants: serverData.restaurants,
            userRanking: serverData.ranking,
            rankingMovements: serverData.movements || {},
          });
        }
        setLocation('/my-list');
        return;
      }
      setLocation('/matchup');
    } catch (e) {
      console.error('Failed to start server session', e);
    }
  };

  const handleAddAllToRank = async () => {
    if (stagedPlaces.length === 0 && !selectedPlace) return;

    setIsAddingAll(true);

    const toAdd = [...stagedPlaces];
    if (selectedPlace) {
      const staged: StagedPlace = {
        place_id: selectedPlace.place_id,
        name: selectedPlace.name,
        address: selectedPlace.formatted_address || selectedPlace.vicinity || "",
        types: selectedPlace.types || [],
        rating: selectedPlace.rating,
        price_level: selectedPlace.price_level,
        photo_reference: selectedPlace.photos?.[0]?.photo_reference || selectedPlace.photo_reference,
        raw: selectedPlace,
      };
      if (!isStaged(staged.place_id, staged.name)) {
        toAdd.push(staged);
      }
    }

    const idsToRank: string[] = [];
    try {
      for (const place of toAdd) {
        const id = await saveAndAddRestaurant(place);
        if (id) idsToRank.push(id);
      }
    } catch (error) {
      console.error("Failed to add restaurants:", error);
    } finally {
      setIsAddingAll(false);
    }

    if (idsToRank.length > 0) {
      trackEvent({ event: "place_add_selected_count", properties: { count: idsToRank.length } });
      await startServerSession(idsToRank);
    }
  };

  const handleConfirmAddSingle = async () => {
    if (!selectedPlace) return;

    const staged: StagedPlace = {
      place_id: selectedPlace.place_id,
      name: selectedPlace.name,
      address: selectedPlace.formatted_address || selectedPlace.vicinity || "",
      types: selectedPlace.types || [],
      rating: selectedPlace.rating,
      price_level: selectedPlace.price_level,
      photo_reference: selectedPlace.photos?.[0]?.photo_reference || selectedPlace.photo_reference,
      raw: selectedPlace,
    };

    const allToAdd = [...stagedPlaces];
    if (!isStaged(staged.place_id, staged.name)) {
      allToAdd.push(staged);
    }

    setIsAddingAll(true);

    const idsToRank: string[] = [];
    for (const place of allToAdd) {
      const id = await saveAndAddRestaurant(place);
      if (id) idsToRank.push(id);
    }

    setStagedPlaces([]);
    setSelectedPlace(null);
    setQuery("");
    setIsAddingAll(false);

    if (idsToRank.length > 0) {
      await startServerSession(idsToRank);
    }
  };

  const handleStageNearby = (place: any) => {
    if (isStaged(place.place_id, place.name)) {
      handleUnstage(place.place_id);
      return;
    }
    const staged: StagedPlace = {
      place_id: place.place_id,
      name: place.name,
      address: place.vicinity || "",
      types: place.types || [],
      rating: place.rating,
      price_level: place.price_level,
      photo_reference: place.photos?.[0]?.photo_reference || place.photo_reference,
      raw: place,
    };
    setStagedPlaces(prev => [...prev, staged]);
  };

  const filtered = restaurants.filter(r => 
    !userRanking.includes(r.id) && 
    (r.name.toLowerCase().includes(query.toLowerCase()) || 
     r.category.toLowerCase().includes(query.toLowerCase()))
  );

  const priceLevelLabel = (level: number | undefined) => {
    if (level === undefined || level === null) return '';
    return '$'.repeat(level || 1);
  };

  const seedPicks = useMemo(() => {
    if (!isSeedMode) return [];
    return nearbyPlaces
      .filter(p => !isActuallyRanked(p.place_id, p.name))
      .slice(0, 12);
  }, [isSeedMode, nearbyPlaces]);

  const showSeedSection = isSeedMode && !query && !selectedPlace && !manualMode && seedPicks.length > 0;
  const showSuggested = !query && !selectedPlace && !manualMode && nearbyPlaces.length > 0;
  const showSearchResults = !selectedPlace && !manualMode && suggestions.length > 0 && query;
  const totalToAdd = stagedPlaces.length + (selectedPlace ? 1 : 0);

  if (!authLoading && !isAuthenticated) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <LogIn size={48} className="text-muted-foreground mb-4" />
          <h2 className="text-xl font-heading font-bold mb-2">Log in to rank restaurants</h2>
          <p className="text-muted-foreground mb-6 max-w-xs">Sign in to create your personal restaurant rankings and compete with friends.</p>
          <Button onClick={() => openSignIn()} className="rounded-full px-8" data-testid="button-login-to-rank">
            <LogIn size={18} className="mr-2" />
            Log in
          </Button>
        </div>
      </Layout>
    );
  }

  if (isAuthenticated && !serverDataLoaded) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mb-4" />
          <p className="text-muted-foreground text-sm">Loading your rankings...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 pt-8 min-h-screen bg-background pb-40">
        <div className="sticky top-0 bg-background/95 backdrop-blur-md z-10 pb-4 pt-4">
          <h1 className="text-2xl font-heading font-bold mb-1" data-testid="text-page-title">Add to Rank</h1>
          <div className="flex items-center gap-1.5 mb-6">
            <MapPin size={14} className="text-primary" />
            <span className="text-sm font-medium text-muted-foreground" data-testid="text-home-area-label">
              {homeArea?.label || "your area"}
            </span>
            <button
              onClick={() => setLocation('/edit-profile')}
              className="text-xs font-semibold text-primary ml-1 hover:underline"
              data-testid="button-change-area"
            >
              Change
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
            <Input 
              placeholder="Search restaurants..." 
              className="pl-12 h-14 rounded-2xl bg-secondary border-transparent focus:bg-background focus:border-primary text-lg"
              value={query}
              onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value === '') {
                      setSuggestions([]);
                      setSelectedPlace(null);
                  }
              }}
              autoFocus
              data-testid="input-search"
            />
            {isLoading && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <Loader2 className="animate-spin text-primary" size={20} />
                </div>
            )}
          </div>
          {apiKeyMissing && (
              <div className="flex items-center gap-2 text-xs text-amber-600 mt-2 bg-amber-50 p-2 rounded-lg">
                  <AlertTriangle size={12} />
                  <span>Google Places API not enabled. Enable "Places API" in your Google Cloud Console, then reload. Using manual mode for now.</span>
              </div>
          )}
        </div>

        {isSeedMode && !query && !selectedPlace && !manualMode && nearbyLoading && (
          <div className="mt-6 flex flex-col items-center gap-2 py-8" data-testid="seed-loading">
            <Sparkles size={20} className="text-primary" />
            <p className="text-sm text-muted-foreground">Loading suggestions near you...</p>
            <Loader2 className="animate-spin text-primary" size={20} />
          </div>
        )}

        {showSeedSection && (
          <div className="mt-4 mb-2" data-testid="section-seed-picks">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground" data-testid="text-seed-heading">Get Started</h2>
              <span className="text-xs text-muted-foreground">Tap to select, then rank</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {seedPicks.map((place) => {
                const staged = isStaged(place.place_id, place.name);
                const ref = place.photos?.[0]?.photo_reference || place.photo_reference;
                const photoUrl = ref
                  ? `/api/places/photo?ref=${encodeURIComponent(ref)}${place.place_id ? `&placeId=${encodeURIComponent(place.place_id)}` : ''}`
                  : null;
                return (
                  <div
                    key={place.place_id}
                    onClick={() => handleStageNearby(place)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${
                      staged
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border/50 bg-card hover:bg-secondary/50'
                    }`}
                    data-testid={`card-seed-${place.place_id}`}
                  >
                    {photoUrl ? (
                      <img src={photoUrl} alt={place.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                        <MapPin size={14} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-xs leading-tight line-clamp-1">{place.name}</h3>
                      <div className="flex items-center gap-1 mt-0.5">
                        {place.take_score ? (
                          <span className="text-[10px] font-semibold flex items-center gap-0.5">
                            <Trophy size={9} className="text-amber-400" />
                            {place.take_score}
                          </span>
                        ) : place.rating ? (
                          <span className="text-[10px] font-semibold flex items-center gap-0.5">
                            <Star size={9} className="text-amber-400" fill="currentColor" />
                            {place.rating}
                          </span>
                        ) : null}
                        {place.price_level && (
                          <span className="text-[10px] text-muted-foreground">{priceLevelLabel(place.price_level)}</span>
                        )}
                      </div>
                    </div>
                    {staged ? (
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                        <Check size={12} className="text-primary-foreground" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center flex-shrink-0">
                        <Plus size={12} className="text-muted-foreground" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {stagedPlaces.length > 0 && (
              <Button
                className="w-full h-12 text-lg font-bold shadow-lg shadow-primary/20 mt-4"
                onClick={handleAddAllToRank}
                disabled={isAddingAll}
                data-testid="button-seed-rank-all"
              >
                {isAddingAll ? (
                  <Loader2 className="animate-spin mr-2" size={18} />
                ) : (
                  <Check className="mr-2" size={18} />
                )}
                Rank {stagedPlaces.length} Place{stagedPlaces.length !== 1 ? 's' : ''}
              </Button>
            )}
          </div>
        )}

        {selectedPlace && (
            <div className="mt-4 p-4 bg-card rounded-2xl border-2 border-primary/20 shadow-lg animate-in slide-in-from-bottom-4">
                <h2 className="text-xl font-bold font-heading mb-1" data-testid="text-selected-name">{selectedPlace.name}</h2>
                <p className="text-sm text-muted-foreground mb-4 flex items-center gap-1">
                    <MapPin size={12} /> {selectedPlace.formatted_address || selectedPlace.vicinity}
                </p>
                
                <div className="flex gap-2 mb-4 flex-wrap">
                    {selectedPlace.types?.filter((t: string) => !['point_of_interest', 'establishment', 'food'].includes(t)).slice(0, 3).map((t: string) => (
                        <span key={t} className="text-xs bg-secondary px-2 py-1 rounded-md uppercase font-bold">
                            {t.replace(/_/g, ' ')}
                        </span>
                    ))}
                </div>

                <Button 
                    className="w-full h-12 text-lg font-bold shadow-lg shadow-primary/20" 
                    onClick={handleConfirmAddSingle} 
                    disabled={isAddingAll}
                    data-testid="button-confirm-add"
                >
                    {isAddingAll ? (
                        <Loader2 className="animate-spin mr-2" size={18} />
                    ) : (
                        <Check className="mr-2" size={18} />
                    )}
                    {stagedPlaces.length > 0 
                        ? `Rank All ${stagedPlaces.length + 1} Places`
                        : 'Add to Rank'
                    }
                </Button>
                <Button 
                    variant="outline" 
                    className="w-full h-11 mt-2 font-semibold rounded-xl"
                    onClick={handleStagePlace}
                    data-testid="button-add-more"
                >
                    <Plus size={18} className="mr-2" />
                    Select & Add More
                </Button>
                <div className="text-[10px] text-muted-foreground text-center mt-2">
                    Powered by Google
                </div>
            </div>
        )}

        {stagedPlaces.length > 0 && !selectedPlace && (
            <div className="mt-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground" data-testid="text-staged-heading">
                        Selected ({stagedPlaces.length})
                    </h2>
                </div>
                <div className="space-y-2">
                    <AnimatePresence>
                        {stagedPlaces.map((place) => (
                            <motion.div
                                key={place.place_id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="flex items-center gap-3 p-3 bg-card rounded-xl border border-primary/20"
                                data-testid={`card-staged-${place.place_id}`}
                            >
                                {place.photo_reference ? (
                                    <img 
                                        src={`/api/places/photo?ref=${encodeURIComponent(place.photo_reference)}${place.place_id ? `&placeId=${encodeURIComponent(place.place_id)}` : ''}`}
                                        alt={place.name}
                                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                                        loading="lazy"
                                    />
                                ) : (
                                    <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                                        <MapPin size={16} className="text-muted-foreground" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-sm truncate">{place.name}</h3>
                                    <p className="text-xs text-muted-foreground truncate">{place.address}</p>
                                </div>
                                <button 
                                    onClick={() => handleUnstage(place.place_id)}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors flex-shrink-0"
                                    data-testid={`button-unstage-${place.place_id}`}
                                >
                                    <X size={16} />
                                </button>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
                <Button 
                    className="w-full h-12 text-lg font-bold shadow-lg shadow-primary/20 mt-4" 
                    onClick={handleAddAllToRank} 
                    disabled={isAddingAll}
                    data-testid="button-rank-all-staged"
                >
                    {isAddingAll ? (
                        <Loader2 className="animate-spin mr-2" size={18} />
                    ) : (
                        <Check className="mr-2" size={18} />
                    )}
                    Rank All {stagedPlaces.length} Places
                </Button>
            </div>
        )}

        {showSearchResults && (
            <div className="space-y-2 mt-2">
                {suggestions.map((place) => {
                    const ranked = isActuallyRanked(place.place_id, place.structured_formatting.main_text);
                    const alreadyStaged = isStaged(place.place_id, place.structured_formatting.main_text);
                    return (
                        <div 
                            key={place.place_id}
                            onClick={() => !ranked && !alreadyStaged && handleSelectPlace(place.place_id)}
                            className={`p-3 bg-card rounded-xl border transition-colors ${ranked || alreadyStaged ? 'border-border/30 opacity-50 cursor-default' : 'border-border/50 hover:bg-secondary/50 cursor-pointer'}`}
                            data-testid={`card-suggestion-${place.place_id}`}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-bold">{place.structured_formatting.main_text}</div>
                                    <div className="text-xs text-muted-foreground">{place.structured_formatting.secondary_text}</div>
                                </div>
                                {ranked && (
                                    <span className="text-xs bg-secondary text-muted-foreground px-2 py-1 rounded-full font-semibold flex-shrink-0">Ranked</span>
                                )}
                                {alreadyStaged && !ranked && (
                                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-semibold flex-shrink-0">Selected</span>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div className="flex justify-end p-2">
                    <img src="https://developers.google.com/static/maps/documentation/images/powered_by_google_on_white.png" alt="Powered by Google" className="h-4 opacity-50" />
                </div>
            </div>
        )}

        {showSuggested && (
            <div className="mt-4">
                <div className="flex items-center gap-2 mb-3">
                    <TrendingUp size={16} className="text-primary" />
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground" data-testid="text-popular-heading">Popular Near You</h2>
                    <div className="relative group ml-auto">
                      <Info size={14} className="text-muted-foreground/50 cursor-help" data-testid="icon-chain-bias-info-add" />
                      <div className="absolute right-0 top-6 z-50 w-56 p-2.5 rounded-lg bg-popover border border-border shadow-lg text-xs text-muted-foreground opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-200">
                        We show fewer chains as you rank more places. Change this in Profile.
                      </div>
                    </div>
                </div>
                <label className="flex items-center gap-2 mb-3 cursor-pointer" data-testid="toggle-show-ranked">
                    <input
                      type="checkbox"
                      checked={showAlreadyRanked}
                      onChange={(e) => setShowAlreadyRanked(e.target.checked)}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-muted-foreground">Show already ranked</span>
                </label>
                {nearbyLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="animate-spin text-primary" size={24} />
                    </div>
                ) : (
                    <div className="space-y-2">
                        {nearbyPlaces.map((place) => {
                            const ranked = isActuallyRanked(place.place_id, place.name);
                            const staged = isStaged(place.place_id, place.name);
                            if (!showAlreadyRanked && ranked) return null;
                            return (
                                <div
                                    key={place.place_id}
                                    onClick={() => {
                                      if (ranked) return;
                                      handleStageNearby(place);
                                    }}
                                    className={`flex items-center gap-3 p-3 bg-card rounded-xl border transition-all cursor-pointer ${
                                      ranked
                                        ? 'border-border/30 opacity-50 cursor-default'
                                        : staged
                                        ? 'border-primary/40 bg-primary/5'
                                        : 'border-border/50 hover:bg-secondary/50'
                                    }`}
                                    data-testid={`card-nearby-${place.place_id}`}
                                >
                                    {place.photo_reference ? (
                                        <img 
                                            src={`/api/places/photo?ref=${encodeURIComponent(place.photo_reference)}${place.place_id ? `&placeId=${encodeURIComponent(place.place_id)}` : ''}`}
                                            alt={place.name}
                                            className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="w-14 h-14 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                                            <MapPin size={18} className="text-muted-foreground" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-bold text-sm truncate">{place.name}</h3>
                                            {ranked && (
                                                <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">Ranked</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate">{place.vicinity}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            {place.take_score ? (
                                                <span className="text-xs font-semibold flex items-center gap-0.5">
                                                    <Trophy size={11} className="text-amber-400" />
                                                    {place.take_score}
                                                </span>
                                            ) : place.rating ? (
                                                <span className="text-xs font-semibold flex items-center gap-0.5">
                                                    <Star size={12} className="text-amber-400" fill="currentColor" />
                                                    {place.rating}
                                                </span>
                                            ) : null}
                                            {place.price_level && (
                                                <span className="text-xs text-muted-foreground">{priceLevelLabel(place.price_level)}</span>
                                            )}
                                        </div>
                                    </div>
                                    {staged ? (
                                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0" data-testid={`icon-staged-${place.place_id}`}>
                                            <Check size={16} className="text-primary-foreground" />
                                        </div>
                                    ) : !ranked ? (
                                        <div className="w-8 h-8 rounded-full border-2 border-border flex items-center justify-center flex-shrink-0 text-muted-foreground">
                                            <Plus size={16} />
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                        <div ref={nearbySentinelRef} className="py-2">
                          {nearbyLoadingMore && (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="animate-spin text-primary" size={20} />
                            </div>
                          )}
                          {nearbyRatePaused && !nearbyLoadingMore && (
                            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                              <Loader2 className="animate-spin" size={14} />
                              <span>Loading more soon…</span>
                            </div>
                          )}
                          {!nearbyHasMore && !nearbyLoadingMore && !nearbyRatePaused && nearbyPlaces.length > 0 && (
                            <div className="text-center py-6 text-xs text-muted-foreground">
                              You've seen all nearby places. Check back later for more!
                            </div>
                          )}
                        </div>
                        {nearbyFetchError && (
                          <div className="text-center text-xs text-destructive p-2">
                            Failed to load more places. Scroll to retry.
                          </div>
                        )}
                    </div>
                )}
            </div>
        )}

        {!showSuggested && !showSearchResults && !selectedPlace && query && !isLoading && !manualMode && (
          <div className="mt-8 text-center text-muted-foreground">
            <p className="text-sm">No results found</p>
          </div>
        )}

        {manualMode && !selectedPlace && !showSearchResults && (
            <div className="mt-4 space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    Your Previously Added
                </h2>
                {filtered.length === 0 && (
                    <p className="text-center text-muted-foreground py-8 text-sm">No restaurants to show. Try a search above.</p>
                )}
                {filtered.map((r) => (
                    <div
                        key={r.id}
                        onClick={() => {
                            const staged: StagedPlace = {
                                place_id: r.googlePlaceId || r.id,
                                name: r.name,
                                address: r.location,
                                types: r.tags,
                                rating: r.rating,
                                price_level: r.priceLevel,
                                photo_reference: undefined,
                                raw: r,
                            };
                            if (!isStaged(staged.place_id, staged.name)) {
                                setStagedPlaces(prev => [...prev, staged]);
                            }
                        }}
                        className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border/50 hover:bg-secondary/50 cursor-pointer"
                    >
                        <img src={r.image && r.image.includes('/api/places/photo') && r.googlePlaceId && !r.image.includes('placeId=') ? `${r.image}${r.image.includes('?') ? '&' : '?'}placeId=${encodeURIComponent(r.googlePlaceId)}` : r.image} alt={r.name} className="w-14 h-14 rounded-lg object-cover" loading="lazy" />
                        <div className="flex-1 min-w-0">
                            <h3 className="font-bold truncate">{r.name}</h3>
                            <p className="text-xs text-muted-foreground truncate">{r.location}</p>
                        </div>
                        <Plus size={18} className="text-muted-foreground" />
                    </div>
                ))}
            </div>
        )}
      </div>
    </Layout>
  );
}
