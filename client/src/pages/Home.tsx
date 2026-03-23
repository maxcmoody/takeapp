import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useStore, type Restaurant } from "@/lib/store";
import Layout from "@/components/Layout";
import { Plus, Trophy, Share2, MapPin, Loader2, Pizza, UtensilsCrossed, Flame, Users, List, Beef, Fish, Coffee, Sandwich, Soup, Egg, Wine, Beer, Star, Sparkles, ArrowRight, TrendingUp, TrendingDown, LocateFixed, Target } from "lucide-react";
import { getGenreIcon } from "@/lib/genreIcons";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { BucketToggle } from "@/components/BucketToggle";
import WeeklyRecapModal from "@/components/WeeklyRecapModal";
import { getDisplayCategoryLabel } from "@shared/displayCategory";

interface LeaderboardEntry {
  id: string;
  name: string;
  image: string | null;
  category: string | null;
  location: string | null;
  priceLevel: string | null;
  googlePlaceId: string | null;
  score: number;
  appearances: number;
  tags?: string[];
  lat?: number;
  lng?: number;
  googleTypes?: string[] | null;
  googlePrimaryType?: string | null;
  movement?: number | null;
  isNew?: boolean;
}

// Removed fetchPlacePhoto — was firing /api/places/details for every card without an image,
// causing up to 100 uncached API calls per page load. The leaderboard endpoint already
// returns image URLs from the DB; if none exists we show a placeholder.

const RESTAURANT_GENRE_BARS: { tag: string; label: string; icon: typeof Pizza; color: string }[] = [
  { tag: '', label: 'restaurants', icon: Star, color: 'text-primary' },
  { tag: 'pizza', label: 'pizza', icon: Pizza, color: 'text-orange-500' },
  { tag: 'burgers', label: 'burgers', icon: Beef, color: 'text-amber-600' },
  { tag: 'mexican', label: 'Mexican', icon: Flame, color: 'text-red-500' },
  { tag: 'seafood', label: 'seafood', icon: Fish, color: 'text-cyan-500' },
  { tag: 'bbq', label: 'BBQ', icon: Flame, color: 'text-orange-600' },
  { tag: 'italian', label: 'Italian', icon: UtensilsCrossed, color: 'text-green-600' },
  { tag: 'asian', label: 'Asian', icon: Soup, color: 'text-rose-500' },
  { tag: 'breakfast', label: 'breakfast', icon: Egg, color: 'text-yellow-500' },
  { tag: 'coffee', label: 'coffee & cafe', icon: Coffee, color: 'text-amber-700' },
  { tag: 'southern', label: 'Southern', icon: UtensilsCrossed, color: 'text-amber-500' },
  { tag: 'bar', label: 'bars & drinks', icon: Wine, color: 'text-purple-500' },
  { tag: 'sandwich', label: 'sandwiches', icon: Sandwich, color: 'text-lime-600' },
];

const BAR_GENRE_BARS: { tag: string; label: string; icon: typeof Pizza; color: string }[] = [
  { tag: '', label: 'bars', icon: Wine, color: 'text-purple-500' },
  { tag: 'cocktail', label: 'cocktail bars', icon: Wine, color: 'text-pink-500' },
  { tag: 'wine', label: 'wine bars', icon: Wine, color: 'text-red-500' },
  { tag: 'beer', label: 'beer & breweries', icon: Beer, color: 'text-amber-600' },
  { tag: 'sports', label: 'sports bars', icon: Flame, color: 'text-orange-500' },
  { tag: 'dive', label: 'dive bars', icon: Star, color: 'text-yellow-500' },
  { tag: 'lounge', label: 'lounges', icon: Soup, color: 'text-indigo-500' },
  { tag: 'pub', label: 'pubs', icon: Beer, color: 'text-amber-700' },
];

function RestaurantImage({ entry }: { entry: LeaderboardEntry }) {
  const [failed, setFailed] = useState(false);

  if (entry.image && !failed) {
    const imgSrc = entry.image.includes('/api/places/photo') && entry.googlePlaceId && !entry.image.includes('placeId=')
      ? `${entry.image}${entry.image.includes('?') ? '&' : '?'}placeId=${encodeURIComponent(entry.googlePlaceId)}`
      : entry.image;
    return (
      <img
        src={imgSrc}
        alt={entry.name}
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-secondary">
      <UtensilsCrossed size={32} className="text-muted-foreground/30" />
    </div>
  );
}

function ensureRestaurantInStore(entry: LeaderboardEntry): string {
  const { addNewRestaurant } = useStore.getState();
  const newRestaurant: Restaurant = {
    id: entry.id,
    name: entry.name,
    image: entry.image || '',
    tags: entry.tags || [],
    location: entry.location || '',
    category: entry.category || '',
    rating: entry.score,
    votes: entry.appearances,
    priceLevel: entry.priceLevel ? parseInt(entry.priceLevel) : 0,
    googlePlaceId: entry.googlePlaceId || undefined,
    lat: entry.lat,
    lng: entry.lng,
    googleTypes: entry.googleTypes || undefined,
    googlePrimaryType: entry.googlePrimaryType || undefined,
  };
  return addNewRestaurant(newRestaurant);
}

function LeaderboardBar({ 
  title, 
  icon, 
  scoreIcon,
  entries, 
  loading,
  noTakeData,
  lowDataChip,
  tag,
  featured,
}: { 
  title: string; 
  icon: React.ReactNode;
  scoreIcon?: React.ReactNode;
  entries: LeaderboardEntry[]; 
  loading: boolean;
  noTakeData?: boolean;
  lowDataChip?: boolean;
  tag?: string;
  featured?: boolean;
}) {
  const [_, setLocation] = useLocation();
  const activeBucket = useStore(s => s.activeBucket);

  return (
    <div className="space-y-3 mb-6 last:mb-0">
      <div className={cn(
        "flex items-start justify-between px-6",
        featured && "pb-1"
      )}>
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <div className="mt-1">{icon}</div>
          <div className="flex flex-col min-w-0">
            <h2 className={cn(
              "font-heading truncate",
              featured ? "text-base font-black tracking-tight" : "text-base font-bold"
            )} data-testid={`text-section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
              {featured ? (
                <>
                  <span className="text-primary">Top</span>{" "}
                  {title.replace(/^Top\s*/, '')}
                </>
              ) : title}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              {noTakeData && (
                <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full" data-testid="chip-no-take-data">
                  No TAKE data yet
                </span>
              )}
              {lowDataChip && !noTakeData && (
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-400/15 px-2 py-0.5 rounded-full" data-testid="chip-low-data">
                  New area &bull; rankings may shift fast
                </span>
              )}
            </div>
          </div>
        </div>
        {!loading && entries.length > 0 && !featured && (
          <button
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-0.5"
            onClick={() => setLocation(tag ? `/leaderboard?tag=${encodeURIComponent(tag)}` : '/leaderboard')}
            data-testid={`button-see-more-${tag || 'overall'}`}
          >
            See more
            <ArrowRight size={12} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-primary" size={20} />
        </div>
      ) : entries.length === 0 ? (
        <div className="px-6">
          <p className="text-sm text-muted-foreground py-4">No ranked {activeBucket === 'bar' ? 'bars' : 'restaurants'} yet. Start ranking to build the leaderboard!</p>
        </div>
      ) : featured ? (
        <div className="px-6 space-y-3">
          {entries.slice(0, 4).filter(Boolean).map((entry, i) => {
            const handleCardClick = () => {
              const id = ensureRestaurantInStore(entry);
              setLocation(`/restaurant/${id}`);
            };
            const displayCategory = getDisplayCategoryLabel(entry.googleTypes, entry.googlePrimaryType, entry.category);
            return (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                className="group relative h-32 bg-card rounded-2xl overflow-hidden border border-border/50 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
                onClick={handleCardClick}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(); }}
                data-testid={`card-featured-${entry.id}`}
              >
                <div className="flex h-full">
                  <div className="absolute top-0 left-0 bg-primary text-primary-foreground font-heading font-bold text-lg px-3 py-2 rounded-br-xl z-10 shadow-lg">
                    #{i + 1}
                  </div>
                  <div className="relative w-24 h-full bg-muted">
                    <RestaurantImage entry={entry} />
                    <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors" />
                  </div>

                  <div className="flex-1 p-4 flex flex-col">
                    <h3 className="font-heading font-bold text-lg leading-tight text-foreground mb-1">
                      {entry.name}
                    </h3>
                    <div className="flex items-center text-muted-foreground text-xs font-medium mb-2 gap-2">
                      <span className="flex items-center gap-1">
                        <MapPin size={12} className="text-primary" />
                        {entry.location || "Unknown location"}
                      </span>
                      {displayCategory && displayCategory !== 'Restaurant' && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span>{displayCategory}</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-auto pt-2">
                      <div className="flex flex-wrap gap-1">
                        {(entry.tags || []).slice(0, 2).map(tagItem => (
                          <span key={tagItem} className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[10px] uppercase tracking-wider font-bold">
                            {tagItem}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <Button
            className="w-full h-11 rounded-xl text-base font-bold bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setLocation(tag ? `/leaderboard?tag=${encodeURIComponent(tag)}` : '/leaderboard')}
            data-testid={`button-see-more-${tag || 'overall'}`}
          >
            See all top restaurants
            <ArrowRight size={16} className="ml-1" />
          </Button>
        </div>
      ) : (
        <div className={cn(
          "flex overflow-x-auto px-6 pb-2 scrollbar-hide relative scroll-pl-6",
          featured ? "gap-3" : "gap-2.5"
        )}>
          {entries.filter(Boolean).map((entry, i) => {
            const handleCardClick = () => {
              const id = ensureRestaurantInStore(entry);
              setLocation(`/restaurant/${id}`);
            };
            return (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                className={cn(
                  "flex-shrink-0 cursor-pointer group touch-manipulation select-none",
                  featured
                    ? "w-[calc((100vw-3.5rem)/2.8)] max-w-[140px]"
                    : "w-[calc((100vw-3.5rem)/3.8)] max-w-[100px]",
                  i === entries.length - 1 && "mr-6"
                )}
                onClick={handleCardClick}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(); }}
                data-testid={`card-featured-${entry.id}`}
              >
                <div className={cn(
                  "relative w-full rounded-xl overflow-hidden bg-muted mb-1.5 pointer-events-none",
                  featured ? "aspect-[4/5]" : "aspect-square"
                )}>
                  <RestaurantImage entry={entry} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute top-1.5 left-1.5">
                    <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1 py-0.5 rounded-md leading-none">
                      #{i + 1}
                    </span>
                  </div>
                  <div className="absolute bottom-1.5 left-1.5 right-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="flex items-center gap-0.5 text-white text-sm font-bold">
                        {scoreIcon ?? <Trophy size={18} className="text-amber-400" />}
                        {entry.score}
                      </span>
                      {entry.isNew && (
                        <span className="inline-block text-[10px] font-bold text-emerald-400 bg-emerald-400/20 px-1.5 py-0.5 rounded leading-none" data-testid={`badge-new-${entry.id}`}>NEW</span>
                      )}
                      {!entry.isNew && entry.movement != null && entry.movement > 0 && (
                        <span className="inline-flex items-center text-xs font-bold text-emerald-400 gap-px leading-none" data-testid={`badge-up-${entry.id}`}>
                          <TrendingUp size={11} />
                          {entry.movement}
                        </span>
                      )}
                      {!entry.isNew && entry.movement != null && entry.movement < 0 && (
                        <span className="inline-flex items-center text-xs font-bold text-red-400 gap-px leading-none" data-testid={`badge-down-${entry.id}`}>
                          <TrendingDown size={11} />
                          {Math.abs(entry.movement)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="pointer-events-none">
                  <h3 className="font-bold text-xs leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                    {entry.name}
                  </h3>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type GenreBar = { tag: string; label: string; icon: typeof Pizza; color: string };

function prioritizeGenres(restaurants: { tags: string[] }[], useTasteFingerprint: boolean, allGenres: GenreBar[]): GenreBar[] {
  const overall = allGenres[0];
  const genreItems = allGenres.slice(1);

  const tagCounts = new Map<string, number>();
  restaurants.forEach((r, idx) => {
    const rankWeight = useTasteFingerprint
      ? Math.max(1, restaurants.length - idx)
      : 1;
    (r.tags || []).forEach(t => {
      const lower = t.toLowerCase();
      genreItems.forEach(g => {
        if (lower.includes(g.tag)) {
          tagCounts.set(g.tag, (tagCounts.get(g.tag) || 0) + rankWeight);
        }
      });
    });
  });

  const weighted = genreItems.map(g => ({
    ...g,
    weight: (tagCounts.get(g.tag) || 0) + 1 + Math.random() * 2,
  }));
  weighted.sort((a, b) => b.weight - a.weight);
  return [overall, ...weighted];
}

const BATCH_SIZE = 4;
const RADIUS_STEPS = [30, 50, 75, 100];
const PRIORITY_THRESHOLD = 4;

interface NearbyPlace {
  place_id: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  vicinity?: string;
  photos?: { photo_reference: string }[];
  photo_reference?: string;
  geometry?: { location: { lat: number; lng: number } };
}

export default function Home() {
  const { userRanking, restaurants, homeArea } = useStore();
  const [_, setLocation] = useLocation();
  const [genreData, setGenreData] = useState<Record<string, LeaderboardEntry[]>>({});
  const [loadingGenres, setLoadingGenres] = useState<Record<string, boolean>>({});
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allExhausted, setAllExhausted] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [areaMeta, setAreaMeta] = useState<{ totalRanked: number; uniqueUsers: number } | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);

  const areaLabel = homeArea?.label || "your area";

  const rankedRestaurants = useMemo(() => 
    userRanking.map(id => restaurants.find(r => r.id === id)).filter(Boolean) as typeof restaurants,
    [userRanking, restaurants]
  );

  const inAreaRankedCount = useMemo(() => {
    if (!homeArea?.lat || !homeArea?.lng) return 0;
    const RADIUS_KM = 30;
    const latDelta = RADIUS_KM / 111.32;
    const lngDelta = RADIUS_KM / (111.32 * Math.cos(homeArea.lat * Math.PI / 180));
    return rankedRestaurants.filter(r => {
      if (r.lat == null || r.lng == null) return false;
      return Math.abs(r.lat - homeArea.lat) <= latDelta && Math.abs(r.lng - homeArea.lng) <= lngDelta;
    }).length;
  }, [rankedRestaurants, homeArea?.lat, homeArea?.lng]);

  const activeBucket = useStore(s => s.activeBucket);
  const activeGenres = activeBucket === 'bar' ? BAR_GENRE_BARS : RESTAURANT_GENRE_BARS;

  const orderedGenres = useMemo(() => {
    return prioritizeGenres(rankedRestaurants, true, activeGenres);
  }, [rankedRestaurants, activeGenres]);

  const fetchLeaderboard = useCallback(async (tag: string) => {
    try {
      for (const radius of RADIUS_STEPS) {
        const params = new URLSearchParams();
        if (homeArea?.lat) params.set('lat', String(homeArea.lat));
        if (homeArea?.lng) params.set('lng', String(homeArea.lng));
        params.set('radius', String(radius));
        if (tag) params.set('tag', tag);
        params.set('limit', '10');
        params.set('bucket', activeBucket);

        const res = await fetch(`/api/leaderboard?${params}`);
        if (res.ok) {
          const data = await res.json();
          const results = data.results || [];
          if (!tag && data.areaMeta) {
            setAreaMeta(data.areaMeta);
          }
          if (results.length >= PRIORITY_THRESHOLD || radius === RADIUS_STEPS[RADIUS_STEPS.length - 1]) {
            return results;
          }
        }
      }
    } catch (e) {
      console.error(`Failed to fetch leaderboard for ${tag}:`, e);
    }
    return [];
  }, [homeArea?.lat, homeArea?.lng, activeBucket]);

  const loadNextBatch = useCallback(async () => {
    if (loadingMore || allExhausted) return;
    const start = loadedCount;
    const end = Math.min(start + BATCH_SIZE, orderedGenres.length);
    if (start >= orderedGenres.length) {
      setAllExhausted(true);
      return;
    }

    setLoadingMore(true);
    const batch = orderedGenres.slice(start, end);

    batch.forEach(g => {
      setLoadingGenres(prev => ({ ...prev, [g.tag]: true }));
    });

    const results = await Promise.all(
      batch.map(async g => ({ tag: g.tag, entries: await fetchLeaderboard(g.tag) }))
    );

    results.forEach(({ tag, entries }) => {
      setGenreData(prev => ({ ...prev, [tag]: entries }));
      setLoadingGenres(prev => ({ ...prev, [tag]: false }));
    });

    setLoadedCount(end);
    if (end >= orderedGenres.length) {
      setAllExhausted(true);
    }
    setLoadingMore(false);
  }, [loadedCount, loadingMore, allExhausted, orderedGenres, fetchLeaderboard]);

  const fetchNearby = useCallback(async () => {
    let lat = homeArea?.lat;
    let lng = homeArea?.lng;

    if (!lat || !lng) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 300000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {
        setNearbyError('location');
        return;
      }
    }

    setNearbyLoading(true);
    setNearbyError(null);
    try {
      const params = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
        radius: '5000',
      });
      const res = await fetch(`/api/places/nearby?${params}`);
      if (res.ok) {
        const data = await res.json();
        setNearbyPlaces((data.results || []).slice(0, 10));
      } else {
        const data = await res.json().catch(() => ({}));
        console.error("Nearby fetch error:", res.status, data);
        setNearbyError('api');
      }
    } catch (e) {
      console.error("Nearby network error:", e);
      setNearbyError('network');
    } finally {
      setNearbyLoading(false);
    }
  }, [homeArea?.lat, homeArea?.lng]);

  useEffect(() => {
    setGenreData({});
    setLoadingGenres({});
    setLoadedCount(0);
    setAllExhausted(false);
    setNearbyPlaces([]);
    setNearbyError(null);
    setAreaMeta(null);
    setShowAllCategories(false);
  }, [homeArea?.lat, homeArea?.lng, activeBucket]);

  useEffect(() => {
    if (loadedCount === 0 && orderedGenres.length > 0) {
      loadNextBatch();
    }
  }, [orderedGenres, loadedCount]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && !allExhausted) {
          loadNextBatch();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadNextBatch, loadingMore, allExhausted]);

  const visibleGenres = orderedGenres.slice(0, loadedCount);

  const sortedVisibleGenres = useMemo(() => {
    const overall = visibleGenres.filter(g => g.tag === '');
    const rest = visibleGenres.filter(g => g.tag !== '');
    const loaded = rest.filter(g => !(loadingGenres[g.tag] ?? true));
    const stillLoading = rest.filter(g => loadingGenres[g.tag] ?? true);
    const rich = loaded.filter(g => (genreData[g.tag] || []).length >= PRIORITY_THRESHOLD);
    const sparse = loaded.filter(g => {
      const entries = genreData[g.tag] || [];
      return entries.length > 0 && entries.length < PRIORITY_THRESHOLD;
    });
    return [...overall, ...rich, ...sparse, ...stillLoading];
  }, [visibleGenres, genreData, loadingGenres]);

  const randomizedSubGenres = useMemo(() => {
    const subGenres = sortedVisibleGenres.filter(g => g.tag !== '');
    const shuffled = [...subGenres];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [sortedVisibleGenres]);

  const visibleSubGenres = showAllCategories
    ? randomizedSubGenres
    : randomizedSubGenres.slice(0, 3);

  const overallLoaded = loadingGenres[''] === false;
  const overallEntries = genreData[''] || [];
  const areaHasNoRanks = overallLoaded && overallEntries.length === 0;
  const isLowData = areaMeta ? (areaMeta.totalRanked < 10 || areaMeta.uniqueUsers < 5) : false;

  useEffect(() => {
    if (areaHasNoRanks && nearbyPlaces.length === 0 && !nearbyLoading && nearbyError === null) {
      fetchNearby();
    }
  }, [areaHasNoRanks, nearbyPlaces.length, nearbyLoading, nearbyError, fetchNearby]);

  return (
    <Layout>
      <WeeklyRecapModal />
      <div className="pt-12 pb-6">
        <header className="flex justify-between items-end px-6">
          <div>
            <h1 className="text-4xl font-heading font-black text-foreground tracking-tighter uppercase">
              TAKE
            </h1>
            <p className="text-primary text-sm font-bold tracking-widest uppercase -mt-0.5" data-testid="text-tagline">
              what's yours?
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="rounded-full h-10 w-10 border-2" onClick={() => setLocation('/profile')} data-testid="button-share">
              <Share2 size={18} />
            </Button>
          </div>
        </header>

        <div className="px-6 mt-3">
          <BucketToggle />
        </div>

        {homeArea ? (
          <div className="flex items-center gap-1.5 px-6 mt-2 mb-4">
            <MapPin size={14} className="text-primary" />
            <span className="text-sm font-medium text-muted-foreground" data-testid="text-home-area-label">{areaLabel}</span>
            <button
              onClick={() => setLocation('/edit-profile')}
              className="text-xs font-semibold text-primary ml-1 hover:underline"
              data-testid="button-change-area"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="mx-6 mt-2 mb-4 p-4 bg-primary/5 border border-primary/20 rounded-xl">
            <p className="text-sm text-muted-foreground mb-2">Set your home area to see curated restaurant lists near you.</p>
            <Button size="sm" variant="outline" onClick={() => setLocation('/edit-profile')} data-testid="button-set-area-cta">
              <MapPin size={14} className="mr-1.5" />
              Set Home Area
            </Button>
          </div>
        )}

        {areaHasNoRanks ? (
          <>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-6 mb-5 p-5 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20"
              data-testid="hero-no-ranks"
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={20} className="text-primary" />
                <h2 className="text-lg font-heading font-bold text-foreground" data-testid="text-hero-title">
                  Be the first to shape TAKE in {areaLabel}.
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-1" data-testid="text-hero-subtitle">
                No rankings exist here yet. Start building your TAKE.
              </p>
              {inAreaRankedCount < 5 && (
                <div className="mb-3 mt-2" data-testid="mission-progress">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Target size={14} className="text-primary" />
                    <span className="text-xs font-semibold text-foreground">Rank 5 places to unlock the first leaderboard.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (inAreaRankedCount / 5) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-primary tabular-nums" data-testid="text-mission-count">{inAreaRankedCount}/5</span>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  className="flex-1 bg-foreground text-background hover:bg-foreground/90 h-11 rounded-xl font-bold shadow-lg shadow-foreground/20"
                  onClick={() => setLocation('/add?seed=1')}
                  data-testid="button-hero-start-ranking"
                >
                  <Plus className="mr-2" strokeWidth={3} size={18} />
                  Start Ranking
                </Button>
                <Button
                  variant="ghost"
                  className="text-sm font-semibold text-primary"
                  onClick={() => setLocation('/edit-profile')}
                  data-testid="button-hero-change-location"
                >
                  Change Location
                </Button>
              </div>
            </motion.div>

            <div className="mx-6 mb-5 p-4 rounded-xl bg-muted/50 border border-border" data-testid="card-your-take">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-heading font-bold">
                    <span className="font-light">YOUR</span> TAKE
                  </h3>
                  {userRanking.length > 0 ? (
                    <p className="text-xs text-muted-foreground mt-0.5">{userRanking.length} place{userRanking.length !== 1 ? 's' : ''} ranked</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">Your TAKE will create the first leaderboard here</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold rounded-lg border-2"
                  onClick={() => setLocation(userRanking.length > 0 ? '/my-list' : '/add')}
                  data-testid="button-your-take-action"
                >
                  {userRanking.length > 0 ? 'View My Take' : 'Rank your first place'}
                  <ArrowRight size={14} className="ml-1" />
                </Button>
              </div>
            </div>

            <div className="space-y-3 mt-2">
              <div className="flex items-center px-6 gap-2">
                <MapPin size={18} className="text-primary" />
                <h2 className="text-base font-heading font-bold" data-testid="text-popular-near-you">
                  Popular near you
                </h2>
                <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full" data-testid="chip-no-take-data-nearby">
                  No TAKE data yet
                </span>
              </div>

              {nearbyLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="animate-spin text-primary" size={20} />
                </div>
              ) : nearbyError === 'location' ? (
                <div className="px-6 py-3">
                  <div className="flex items-start gap-2">
                    <LocateFixed size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Enable location to see places near you, or set a home area.</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-8 text-xs rounded-lg" onClick={fetchNearby} data-testid="button-retry-nearby">
                          Retry
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs rounded-lg" onClick={() => setLocation('/edit-profile')} data-testid="button-set-area-nearby">
                          <MapPin size={12} className="mr-1" />
                          Set Area
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : nearbyError ? (
                <div className="px-6 py-3">
                  <p className="text-sm text-muted-foreground mb-2">Couldn't load nearby restaurants.</p>
                  <Button size="sm" variant="outline" className="h-8 text-xs rounded-lg" onClick={fetchNearby} data-testid="button-retry-nearby">
                    Retry
                  </Button>
                </div>
              ) : !nearbyLoading && nearbyPlaces.length === 0 ? (
                <div className="px-6 py-3">
                  <p className="text-sm text-muted-foreground">No nearby restaurants found for this area.</p>
                </div>
              ) : (
                <div className="flex gap-2.5 overflow-x-auto px-6 pb-2 scrollbar-hide relative scroll-pl-6">
                  {nearbyPlaces.map((place, i) => {
                    const ref = place.photos?.[0]?.photo_reference || place.photo_reference;
                    const photoUrl = ref
                      ? `/api/places/photo?ref=${encodeURIComponent(ref)}${place.place_id ? `&placeId=${encodeURIComponent(place.place_id)}` : ''}`
                      : null;
                    return (
                      <div
                        key={place.place_id}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "flex-shrink-0 w-[calc((100vw-3.5rem)/3.4)] max-w-[115px] cursor-pointer group touch-manipulation select-none",
                          i === nearbyPlaces.length - 1 && "mr-6"
                        )}
                        onClick={() => setLocation(`/add`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setLocation('/add'); }}
                        data-testid={`card-nearby-${place.place_id}`}
                      >
                        <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-muted mb-1.5 pointer-events-none">
                          {photoUrl ? (
                            <img src={photoUrl} alt={place.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-secondary">
                              <UtensilsCrossed size={32} className="text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                          {place.rating && (
                            <div className="absolute bottom-1.5 left-1.5 right-1.5">
                              <span className="flex items-center gap-0.5 text-white text-xs font-bold">
                                <Star size={12} className="text-amber-400 fill-amber-400" />
                                {place.rating}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="pointer-events-none">
                          <h3 className="font-bold text-[11px] leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                            {place.name}
                          </h3>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {visibleSubGenres.map(genre => {
              const entries = genreData[genre.tag] || [];
              const isLoading = loadingGenres[genre.tag] ?? true;
              if (!isLoading && entries.length === 0) return null;
              const Icon = genre.icon;
              return (
                <LeaderboardBar
                  key={genre.tag}
                  title={`Top ${genre.label} in ${areaLabel}`}
                  icon={<Icon size={18} className={genre.color} />}
                  entries={entries}
                  loading={isLoading}
                  noTakeData
                  tag={genre.tag}
                />
              );
            })}

            {!showAllCategories && randomizedSubGenres.length > 3 && (
              <div className="px-6">
                <Button
                  variant="outline"
                  className="w-full h-11 rounded-xl text-sm font-semibold"
                  onClick={() => setShowAllCategories(true)}
                  data-testid="button-show-more-categories"
                >
                  Show more categories
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="px-6 mb-4">
              <Button 
                className="w-full bg-foreground text-background hover:bg-foreground/90 h-14 rounded-xl text-lg font-bold shadow-lg shadow-foreground/20"
                onClick={() => setLocation('/add')}
                data-testid="button-rank-new"
              >
                <Plus className="mr-2" strokeWidth={3} />
                Rank New Place
              </Button>
            </div>

            {sortedVisibleGenres.slice(0, 1).map(genre => {
              const entries = genreData[genre.tag] || [];
              const isLoading = loadingGenres[genre.tag] ?? true;
              if (!isLoading && entries.length === 0) return null;
              const Icon = genre.icon;
              return (
                <LeaderboardBar
                  key={genre.tag}
                  title={`Top ${genre.label} in ${areaLabel}`}
                  icon={<Icon size={18} className={genre.color} />}
                  entries={entries}
                  loading={isLoading}
                  tag={genre.tag || undefined}
                  featured={genre.tag === ''}
                  lowDataChip={genre.tag === '' && isLowData}
                />
              );
            })}

            <div className="mx-6 my-4 p-4 rounded-xl bg-muted/50 border border-border" data-testid="card-your-take">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-heading font-bold">
                    <span className="font-light">YOUR</span> TAKE
                  </h3>
                  {userRanking.length > 0 ? (
                    <p className="text-xs text-muted-foreground mt-0.5">{userRanking.length} place{userRanking.length !== 1 ? 's' : ''} ranked</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">Start ranking to build the leaderboard</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold rounded-lg border-2"
                  onClick={() => setLocation(userRanking.length > 0 ? '/my-list' : '/add')}
                  data-testid="button-your-take-action"
                >
                  {userRanking.length > 0 ? 'View My Take' : 'Rank your first place'}
                  <ArrowRight size={14} className="ml-1" />
                </Button>
              </div>
            </div>

            {visibleSubGenres.map(genre => {
              const entries = genreData[genre.tag] || [];
              const isLoading = loadingGenres[genre.tag] ?? true;
              if (!isLoading && entries.length === 0) return null;
              const Icon = genre.icon;
              return (
                <LeaderboardBar
                  key={genre.tag}
                  title={`Top ${genre.label} in ${areaLabel}`}
                  icon={<Icon size={18} className={genre.color} />}
                  entries={entries}
                  loading={isLoading}
                  tag={genre.tag}
                />
              );
            })}

            {!showAllCategories && randomizedSubGenres.length > 3 && (
              <div className="px-6">
                <Button
                  variant="outline"
                  className="w-full h-11 rounded-xl text-sm font-semibold"
                  onClick={() => setShowAllCategories(true)}
                  data-testid="button-show-more-categories"
                >
                  Show more categories
                </Button>
              </div>
            )}
          </>
        )}

        <div ref={sentinelRef} className="flex justify-center py-4">
          {loadingMore && (
            <Loader2 className="animate-spin text-primary" size={20} />
          )}
          {allExhausted && loadedCount > 0 && (
            <p className="text-xs text-muted-foreground">You've seen all categories</p>
          )}
        </div>
      </div>
    </Layout>
  );
}
