import Layout from "@/components/Layout";
import { useStore, startServerRankingSession, type Restaurant } from "@/lib/store";
import { MapPin, Loader2, Trophy, X, RefreshCw, Search as SearchIcon, Plus, Pizza, UtensilsCrossed, Flame, Beef, Fish, Coffee, Sandwich, Soup, Egg, Wine, Star } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { ConfidenceBadge, ScoreExplanationPopover } from "@/components/ScoreExplanation";
import { getDisplayCategoryLabel } from "@shared/displayCategory";

interface SearchEntry {
  id: string;
  name: string;
  image: string | null;
  category: string | null;
  location: string | null;
  priceLevel: string | null;
  googlePlaceId: string | null;
  tags: string[] | null;
  score: number | null;
  appearances: number;
  lat: number | null;
  lng: number | null;
  googleRating: number | null;
  googleReviews: number | null;
  hasTakeScore: boolean;
  googleTypes?: string[] | null;
  googlePrimaryType?: string | null;
}

const PRICE_LABELS = ['Free', '$', '$$', '$$$', '$$$$'];

const QUICK_TAGS = [
  { label: 'Pizza', value: 'pizza' },
  { label: 'BBQ', value: 'bbq' },
  { label: 'Mexican', value: 'mexican' },
  { label: 'Italian', value: 'italian' },
  { label: 'Asian', value: 'asian' },
  { label: 'Bars', value: 'bar' },
  { label: 'Seafood', value: 'seafood' },
  { label: 'Burgers', value: 'burgers' },
  { label: 'Breakfast', value: 'breakfast' },
  { label: 'Southern', value: 'southern' },
];

const TAG_GOOGLE_TYPES: Record<string, string[]> = {
  pizza: ['pizza_restaurant', 'pizza_delivery'],
  burgers: ['hamburger_restaurant'],
  mexican: ['mexican_restaurant'],
  seafood: ['seafood_restaurant'],
  bbq: ['barbecue_restaurant'],
  italian: ['italian_restaurant'],
  asian: ['chinese_restaurant', 'japanese_restaurant', 'korean_restaurant', 'thai_restaurant', 'vietnamese_restaurant', 'asian_restaurant', 'ramen_restaurant', 'sushi_restaurant'],
  breakfast: ['breakfast_restaurant', 'brunch_restaurant'],
  coffee: ['cafe', 'coffee_shop'],
  southern: ['american_restaurant'],
  bar: ['bar', 'wine_bar', 'cocktail_bar', 'pub', 'sports_bar', 'beer_hall', 'beer_garden', 'night_club'],
  sandwich: ['sandwich_shop'],
  sushi: ['sushi_restaurant'],
  indian: ['indian_restaurant'],
  greek: ['greek_restaurant'],
  mediterranean: ['mediterranean_restaurant', 'lebanese_restaurant', 'middle_eastern_restaurant'],
  steakhouse: ['steak_house'],
  vegan: ['vegan_restaurant', 'vegetarian_restaurant'],
};

function placeMatchesTag(tag: string, placeTypes: string[]): boolean {
  const mappedTypes = TAG_GOOGLE_TYPES[tag];
  if (!mappedTypes) return false;
  for (const t of mappedTypes) {
    if (placeTypes.includes(t)) return true;
  }
  return false;
}

function ensureSearchEntryInStore(entry: SearchEntry): string {
  const { addNewRestaurant } = useStore.getState();
  const newRestaurant: Restaurant = {
    id: entry.id,
    name: entry.name,
    image: entry.image || '',
    tags: entry.tags || [],
    location: entry.location || '',
    category: entry.category || '',
    rating: entry.hasTakeScore && entry.score != null ? entry.score : 0,
    votes: entry.appearances,
    priceLevel: entry.priceLevel ? parseInt(entry.priceLevel) : 0,
    googlePlaceId: entry.googlePlaceId || undefined,
    lat: entry.lat || undefined,
    lng: entry.lng || undefined,
    googleTypes: entry.googleTypes || undefined,
    googlePrimaryType: entry.googlePrimaryType || undefined,
  };
  return addNewRestaurant(newRestaurant);
}

interface AreaSuggestion {
  place_id: string;
  description: string;
}

interface RestaurantSuggestion {
  place_id: string;
  name: string;
  description: string;
}

export default function Search() {
  const { homeArea, userRanking, startBatchRanking } = useStore();
  const { isAuthenticated } = useAuth();
  const sessionTokenRef = useRef(crypto.randomUUID());
  const [_, setLocation] = useLocation();
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({
    lat: homeArea?.lat || 35.0456,
    lng: homeArea?.lng || -85.3097,
  });
  const [fetchedBounds, setFetchedBounds] = useState<{
    north: number; south: number; east: number; west: number;
  } | null>(null);

  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const TAG_ICON_MAP: Record<string, { Icon: any; className: string }> = {
    pizza: { Icon: Pizza, className: "text-orange-500" },
    burgers: { Icon: Beef, className: "text-amber-600" },
    mexican: { Icon: Flame, className: "text-red-500" },
    seafood: { Icon: Fish, className: "text-cyan-500" },
    bbq: { Icon: Flame, className: "text-orange-600" },
    italian: { Icon: UtensilsCrossed, className: "text-green-600" },
    asian: { Icon: Soup, className: "text-rose-500" },
    breakfast: { Icon: Egg, className: "text-yellow-500" },
    coffee: { Icon: Coffee, className: "text-amber-700" },
    southern: { Icon: UtensilsCrossed, className: "text-amber-500" },
    bar: { Icon: Wine, className: "text-purple-500" },
    sandwich: { Icon: Sandwich, className: "text-lime-600" },
    "": { Icon: Star, className: "text-primary" },
  };

  const CategoryScoreIcon = ({ tag, size = 10 }: { tag: string | null; size?: number }) => {
    const t = tag ?? "";
    if (!t) return <Trophy size={size} className="text-amber-500" />;
    const m = TAG_ICON_MAP[t];
    if (!m) return <Star size={size} className="text-primary" />;
    const I = m.Icon;
    return <I size={size} className={m.className} />;
  };

  const [selectedPrices, setSelectedPrices] = useState<number[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapApiLoaded, setMapApiLoaded] = useState(false);
  const [showUpdateButton, setShowUpdateButton] = useState(false);
  const initialLoadDone = useRef(false);
  const fetchedBoundsRef = useRef<{ north: number; south: number; east: number; west: number } | null>(null);

  const [areaQuery, setAreaQuery] = useState('');
  const [areaSuggestions, setAreaSuggestions] = useState<AreaSuggestion[]>([]);
  const [restaurantSuggestions, setRestaurantSuggestions] = useState<RestaurantSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const areaDebounce = useRef<NodeJS.Timeout | null>(null);
  const areaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).google?.maps) {
      setMapApiLoaded(true);
      return;
    }

    const apiKey = (window as any).__GOOGLE_MAPS_KEY__;
    if (!apiKey) {
      fetch('/api/maps-key')
        .then(res => res.json())
        .then(data => {
          if (data.key) {
            loadGoogleMapsScript(data.key);
          }
        })
        .catch(() => {});
      return;
    }
    loadGoogleMapsScript(apiKey);
  }, []);

  const loadGoogleMapsScript = (apiKey: string) => {
    if (document.querySelector('script[src*="maps.googleapis.com"]')) {
      if ((window as any).google?.maps) {
        setMapApiLoaded(true);
      }
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker,places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => setMapApiLoaded(true);
    document.head.appendChild(script);
  };

  useEffect(() => {
    if (!mapApiLoaded || !mapRef.current || googleMapRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: mapCenter,
      zoom: 13,
      mapId: 'take-search-map',
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    });

    googleMapRef.current = map;

    const handleMapIdle = () => {
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        fetchForCurrentBounds(map);
        return;
      }
      const bounds = map.getBounds();
      if (!bounds) return;
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const current = { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() };
      const prev = fetchedBoundsRef.current;
      if (prev) {
        const threshold = 0.001;
        const moved = Math.abs(current.north - prev.north) > threshold ||
                      Math.abs(current.south - prev.south) > threshold ||
                      Math.abs(current.east - prev.east) > threshold ||
                      Math.abs(current.west - prev.west) > threshold;
        if (moved) setShowUpdateButton(true);
      }
    };

    map.addListener('idle', handleMapIdle);
    map.addListener('tilesloaded', () => {
      setMapReady(true);
    });
  }, [mapApiLoaded]);

  const fetchForCurrentBounds = useCallback(async (map?: google.maps.Map) => {
    const m = map || googleMapRef.current;
    if (!m) return;
    const bounds = m.getBounds();
    if (!bounds) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const currentBounds = {
      north: ne.lat(),
      south: sw.lat(),
      east: ne.lng(),
      west: sw.lng(),
    };

    setShowUpdateButton(false);
    setLoading(true);
    setPlacesError(null);
    try {
      const centerLat = (currentBounds.north + currentBounds.south) / 2;
      const centerLng = (currentBounds.east + currentBounds.west) / 2;
      const latDiff = Math.abs(currentBounds.north - currentBounds.south);
      const lngDiff = Math.abs(currentBounds.east - currentBounds.west);
      const latRadiusKm = (latDiff / 2) * 111;
      const lngRadiusKm = (lngDiff / 2) * 111 * Math.cos((centerLat * Math.PI) / 180);
      const radiusKm = Math.max(latRadiusKm, lngRadiusKm, 0.5);
      const radiusMeters = Math.min(Math.round(radiusKm * 1000), 50000);

      const placesParams = new URLSearchParams();
      placesParams.set('lat', String(centerLat));
      placesParams.set('lng', String(centerLng));
      placesParams.set('radius', String(radiusMeters));
      placesParams.set('viewport', 'true');

      const leaderboardParams = new URLSearchParams();
      leaderboardParams.set('lat', String(centerLat));
      leaderboardParams.set('lng', String(centerLng));
      leaderboardParams.set('radius', String(Math.max(radiusKm, 1)));
      leaderboardParams.set('limit', '100');
      leaderboardParams.set('bucket', useStore.getState().activeBucket);
      if (selectedTag) {
        placesParams.set('keyword', selectedTag);
        leaderboardParams.set('tag', selectedTag);
      }
      if (selectedPrices.length > 0) {
        leaderboardParams.set('price', selectedPrices.join(','));
      }

      const [placesRes, leaderboardRes] = await Promise.allSettled([
        fetch(`/api/places/nearby?${placesParams}`),
        fetch(`/api/leaderboard?${leaderboardParams}`),
      ]);

      const placesData = placesRes.status === 'fulfilled' && placesRes.value.ok
        ? await placesRes.value.json() : { results: [] };
      const leaderboardData = leaderboardRes.status === 'fulfilled' && leaderboardRes.value.ok
        ? await leaderboardRes.value.json() : { results: [] };

      const takeScoreMap = new Map<string, { score: number; appearances: number; id: string }>();
      for (const lb of leaderboardData.results || []) {
        if (lb.googlePlaceId) {
          takeScoreMap.set(lb.googlePlaceId, { score: lb.score, appearances: lb.appearances, id: lb.id });
        }
      }

      const merged: SearchEntry[] = [];
      const seenPlaceIds = new Set<string>();

      for (const place of (placesData.results || [])) {
        const placeId = place.place_id;
        const takeData = takeScoreMap.get(placeId);
        const priceLevel = place.price_level != null ? String(place.price_level) : null;

        if (selectedPrices.length > 0 && priceLevel && !selectedPrices.includes(Number(priceLevel))) {
          continue;
        }

        const types = place.types || [];

        if (selectedTag && !placeMatchesTag(selectedTag, types)) {
          continue;
        }

        seenPlaceIds.add(placeId);
        const photoRef = place.photo_reference;
        const imageUrl = photoRef ? `/api/places/photo?ref=${photoRef}${place.place_id ? `&placeId=${encodeURIComponent(place.place_id)}` : ''}` : null;
        const category = types.find((t: string) => !['restaurant', 'food', 'point_of_interest', 'establishment'].includes(t)) || null;

        merged.push({
          id: takeData?.id || placeId,
          name: place.name,
          image: imageUrl,
          category,
          location: place.vicinity || null,
          priceLevel,
          googlePlaceId: placeId,
          tags: types,
          score: takeData?.score ?? null,
          appearances: takeData?.appearances ?? 0,
          lat: place.lat ?? null,
          lng: place.lng ?? null,
          googleRating: place.rating ?? null,
          googleReviews: place.user_ratings_total ?? null,
          hasTakeScore: !!takeData,
          googleTypes: types,
          googlePrimaryType: types?.[0] || null,
        });
      }

      for (const lb of (leaderboardData.results || [])) {
        if (lb.googlePlaceId && seenPlaceIds.has(lb.googlePlaceId)) continue;
        merged.push({
          id: lb.id,
          name: lb.name,
          image: lb.image,
          category: lb.category,
          location: lb.location,
          priceLevel: lb.priceLevel,
          googlePlaceId: lb.googlePlaceId,
          tags: lb.tags,
          score: lb.score,
          appearances: lb.appearances,
          lat: lb.lat,
          lng: lb.lng,
          googleRating: null,
          googleReviews: null,
          hasTakeScore: true,
          googleTypes: lb.googleTypes,
          googlePrimaryType: lb.googlePrimaryType,
        });
      }

      merged.sort((a, b) => {
        if (a.hasTakeScore && !b.hasTakeScore) return -1;
        if (!a.hasTakeScore && b.hasTakeScore) return 1;
        if (a.hasTakeScore && b.hasTakeScore) return (b.score ?? 0) - (a.score ?? 0);
        return (b.googleRating ?? 0) - (a.googleRating ?? 0);
      });

      setEntries(merged);
    } catch (e) {
      console.error("Failed to fetch search results:", e);
      setPlacesError("Couldn't load places. Retry");
    } finally {
      setLoading(false);
    }
    setFetchedBounds(currentBounds);
    fetchedBoundsRef.current = currentBounds;
  }, [selectedTag, selectedPrices]);

  useEffect(() => {
    if (initialLoadDone.current) {
      fetchForCurrentBounds();
    }
  }, [selectedTag, selectedPrices]);

  useEffect(() => {
    if (!googleMapRef.current || !mapApiLoaded) return;

    markersRef.current.forEach(m => m.map = null);
    markersRef.current = [];

    if (!(google.maps.marker?.AdvancedMarkerElement)) return;

    const ranked = entries.filter(e => e.hasTakeScore);
    const unranked = entries.filter(e => !e.hasTakeScore);

    unranked.forEach((entry) => {
      if (!entry.lat || !entry.lng) return;

      const pinEl = document.createElement('div');
      pinEl.style.cssText = `width:22px;height:22px;background:#9ca3af;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2);cursor:pointer;`;
      pinEl.innerHTML = '&#9679;';

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: googleMapRef.current!,
        position: { lat: entry.lat, lng: entry.lng },
        content: pinEl,
        title: entry.name,
        zIndex: 1,
      });

      marker.addListener('click', () => { handleCardClick(entry); });
      markersRef.current.push(marker);
    });

    ranked.forEach((entry, i) => {
      if (!entry.lat || !entry.lng) return;

      const pinEl = document.createElement('div');
      pinEl.style.cssText = `width:28px;height:28px;background:hsl(var(--primary));border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:11px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;`;
      pinEl.textContent = String(i + 1);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: googleMapRef.current!,
        position: { lat: entry.lat, lng: entry.lng },
        content: pinEl,
        title: entry.name,
        zIndex: 10,
      });

      marker.addListener('click', () => { handleCardClick(entry); });
      markersRef.current.push(marker);
    });
  }, [entries, mapApiLoaded]);

  const handleCardClick = async (entry: SearchEntry) => {
    const id = ensureSearchEntryInStore(entry);

    if (!entry.hasTakeScore && entry.googlePlaceId) {
      try {
        await fetch('/api/restaurants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: entry.name,
            googlePlaceId: entry.googlePlaceId,
            image: entry.image || null,
            tags: entry.tags || null,
            location: entry.location || null,
            category: entry.category || null,
            lat: entry.lat || null,
            lng: entry.lng || null,
            priceLevel: entry.priceLevel || null,
          }),
        });
      } catch {}
    }

    setLocation(`/restaurant/${id}`);
  };

  const toggleTag = (tag: string) => {
    setSelectedTag(prev => prev === tag ? null : tag);
  };

  const togglePrice = (level: number) => {
    setSelectedPrices(prev =>
      prev.includes(level) ? prev.filter(p => p !== level) : [...prev, level]
    );
  };

  useEffect(() => {
    if (areaQuery.trim().length < 3) {
      setAreaSuggestions([]);
      setRestaurantSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (areaDebounce.current) clearTimeout(areaDebounce.current);
    areaDebounce.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      const mapLat = googleMapRef.current?.getCenter()?.lat() ?? mapCenter.lat;
      const mapLng = googleMapRef.current?.getCenter()?.lng() ?? mapCenter.lng;
      try {
        const [areaRes, restaurantRes] = await Promise.all([
          fetch(`/api/places/area-autocomplete?input=${encodeURIComponent(areaQuery)}`),
          fetch(`/api/places/autocomplete?input=${encodeURIComponent(areaQuery)}&lat=${mapLat}&lng=${mapLng}&sessiontoken=${sessionTokenRef.current}`),
        ]);
        const [areaData, restaurantData] = await Promise.all([areaRes.json(), restaurantRes.json()]);
        if (areaData.predictions) {
          setAreaSuggestions(areaData.predictions.map((p: any) => ({
            place_id: p.place_id,
            description: p.description,
          })));
        }
        if (restaurantData.predictions) {
          setRestaurantSuggestions(restaurantData.predictions.map((p: any) => ({
            place_id: p.place_id,
            name: p.structured_formatting?.main_text || p.description.split(',')[0],
            description: p.structured_formatting?.secondary_text || p.description,
          })));
        }
        const hasResults = (areaData.predictions?.length > 0) || (restaurantData.predictions?.length > 0);
        setShowSuggestions(hasResults);
      } catch {
        setAreaSuggestions([]);
        setRestaurantSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 300);
  }, [areaQuery]);

  const handleRestaurantSelect = (suggestion: RestaurantSuggestion) => {
    setAreaQuery('');
    setShowSuggestions(false);
    setAreaSuggestions([]);
    setRestaurantSuggestions([]);
    sessionTokenRef.current = crypto.randomUUID();
    setLocation(`/restaurant/${suggestion.place_id}`);
  };

  const handleAreaSelect = async (suggestion: AreaSuggestion) => {
    setAreaQuery(suggestion.description);
    setShowSuggestions(false);
    setAreaSuggestions([]);
    setRestaurantSuggestions([]);

    try {
      const res = await fetch(`/api/places/details?place_id=${suggestion.place_id}&sessiontoken=${sessionTokenRef.current}`);
      const data = await res.json();
      const loc = data.result?.geometry?.location;
      if (loc && googleMapRef.current) {
        googleMapRef.current.panTo({ lat: loc.lat, lng: loc.lng });
        googleMapRef.current.setZoom(13);
      }
    } catch {}
    sessionTokenRef.current = crypto.randomUUID();
  };

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-5rem)]">
        <div className="px-4 pt-3 pb-2 border-b border-border/50 relative">
          <div className="relative">
            <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={areaInputRef}
              type="text"
              value={areaQuery}
              onChange={e => setAreaQuery(e.target.value)}
              onFocus={() => (areaSuggestions.length > 0 || restaurantSuggestions.length > 0) && setShowSuggestions(true)}
              placeholder="Search restaurants or areas..."
              className="w-full pl-9 pr-8 py-2 bg-secondary rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-testid="input-area-search"
            />
            {areaQuery && (
              <button
                onClick={() => { setAreaQuery(''); setShowSuggestions(false); setAreaSuggestions([]); setRestaurantSuggestions([]); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                data-testid="button-clear-area"
              >
                <X size={16} />
              </button>
            )}
          </div>
          {showSuggestions && (restaurantSuggestions.length > 0 || areaSuggestions.length > 0) && (
            <div className="absolute left-4 right-4 top-full mt-1 bg-background border border-border rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
              {restaurantSuggestions.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Restaurants
                  </div>
                  {restaurantSuggestions.map(s => (
                    <button
                      key={s.place_id}
                      onClick={() => handleRestaurantSelect(s)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary transition-colors flex items-center gap-2"
                      data-testid={`suggestion-restaurant-${s.place_id}`}
                    >
                      <UtensilsCrossed size={14} className="text-primary flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{s.description}</div>
                      </div>
                    </button>
                  ))}
                </>
              )}
              {areaSuggestions.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Areas
                  </div>
                  {areaSuggestions.map(s => (
                    <button
                      key={s.place_id}
                      onClick={() => handleAreaSelect(s)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary transition-colors flex items-center gap-2"
                      data-testid={`suggestion-area-${s.place_id}`}
                    >
                      <MapPin size={14} className="text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{s.description}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div className="relative flex-shrink-0">
          <div 
            ref={mapRef} 
            className="w-full h-56 bg-secondary"
            data-testid="map-container"
          >
            {!mapApiLoaded && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <MapPin className="mx-auto mb-2 text-primary" size={32} />
                  <p className="text-sm text-muted-foreground">Loading map...</p>
                </div>
              </div>
            )}
          </div>
          {showUpdateButton && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
              <button
                onClick={() => fetchForCurrentBounds()}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold shadow-lg shadow-primary/30 hover:bg-primary/90 transition-all active:scale-95"
                data-testid="button-update-results"
              >
                <RefreshCw size={14} />
                Update results in this area
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto bg-background" onClick={() => setShowSuggestions(false)}>
          <div className="px-4 py-3 border-b border-border/50">
            <p className="text-[10px] text-muted-foreground/60 mb-1.5 tracking-wide">Categories based on Google business info</p>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {QUICK_TAGS.map(tag => (
                <button
                  key={tag.value}
                  onClick={() => toggleTag(tag.value)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    selectedTag === tag.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                  data-testid={`chip-tag-${tag.value}`}
                >
                  {tag.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              {[1, 2, 3, 4].map(level => (
                <button
                  key={level}
                  onClick={() => togglePrice(level)}
                  className={`flex items-center gap-0.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all ${
                    selectedPrices.includes(level)
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                  data-testid={`button-price-${level}`}
                >
                  {'$'.repeat(level)}
                </button>
              ))}
              {(selectedTag || selectedPrices.length > 0) && (
                <button
                  onClick={() => { setSelectedTag(null); setSelectedPrices([]); }}
                  className="px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-clear-filters"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {placesError && !loading && (
            <div className="mx-4 mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center justify-between" data-testid="text-places-error">
              <span className="text-sm text-destructive">{placesError}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fetchForCurrentBounds()} data-testid="button-retry-places">
                Retry
              </Button>
            </div>
          )}
          <div className="px-4 py-3">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin text-primary" size={20} />
              </div>
            ) : entries.length === 0 && !placesError ? (
              <div className="text-center py-8" data-testid="text-no-results">
                <MapPin size={24} className="mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No restaurants found in this area.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Try zooming out or removing filters.</p>
              </div>
            ) : (() => {
              const rankedEntries = entries.filter(e => e.hasTakeScore);
              const unrankedEntries = entries.filter(e => !e.hasTakeScore);
              return (
              <>
                {rankedEntries.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5" data-testid="text-ranked-heading">
                        <CategoryScoreIcon tag={selectedTag} size={14} />
                        TAKE Ranked
                      </h2>
                      <span className="text-xs text-muted-foreground">{rankedEntries.length} places</span>
                    </div>
                    <div className="space-y-3">
                      {rankedEntries.map((entry, i) => (
                        <div
                          key={entry.googlePlaceId || entry.id}
                          className="flex items-center gap-3 cursor-pointer group"
                          onClick={() => handleCardClick(entry)}
                          data-testid={`card-search-${entry.googlePlaceId || entry.id}`}
                        >
                          <div className="font-heading font-bold text-lg text-muted-foreground/40 w-6 text-center group-hover:text-primary transition-colors">
                            {i + 1}
                          </div>
                          {entry.image ? (
                            <img src={entry.image && entry.image.includes('/api/places/photo') && entry.googlePlaceId && !entry.image.includes('placeId=') ? `${entry.image}${entry.image.includes('?') ? '&' : '?'}placeId=${encodeURIComponent(entry.googlePlaceId)}` : entry.image} className="w-12 h-12 rounded-lg object-cover" alt={entry.name} loading="lazy" />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center">
                              <MapPin size={16} className="text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <h3 className="font-bold text-sm truncate group-hover:text-primary transition-colors">{entry.name}</h3>
                              {entry.score != null && (
                                <ScoreExplanationPopover
                                  score={entry.score}
                                  appearances={entry.appearances}
                                  neighbors={rankedEntries.filter(e => e.id !== entry.id).map(e => ({ name: e.name, score: e.score! }))}
                                />
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              {entry.score != null && (
                                <span className="flex items-center text-primary font-bold">
                                  <span className="mr-0.5"><CategoryScoreIcon tag={selectedTag} size={12} /></span>
                                  {entry.score}
                                </span>
                              )}
                              <ConfidenceBadge appearances={entry.appearances} />
                              {(() => { const label = getDisplayCategoryLabel(entry.googleTypes, entry.googlePrimaryType, entry.category); return label && label !== 'Restaurant' ? (<><span>·</span><span>{label}</span></>) : null; })()}
                              {entry.priceLevel && (
                                <>
                                  <span>·</span>
                                  <span>{PRICE_LABELS[Number(entry.priceLevel)] || '$$'}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="text-xs font-bold bg-primary/10 text-primary px-2 py-1 rounded-md flex items-center gap-1">
                              <CategoryScoreIcon tag={selectedTag} size={10} />
                              {entry.score != null ? entry.score : 'Ranked'}
                            </div>
                            {entry.appearances > 0 && (
                              <span className="text-[9px] text-muted-foreground" data-testid={`text-appearances-${entry.googlePlaceId || entry.id}`}>
                                In {entry.appearances} {entry.appearances === 1 ? 'TAKE' : 'TAKES'}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {unrankedEntries.length > 0 && (
                  <div>
                    {rankedEntries.length > 0 && (
                      <div className="border-t border-border/50 my-3" />
                    )}
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground" data-testid="text-unranked-heading">
                        More places nearby
                      </h2>
                      <span className="text-xs text-muted-foreground">{unrankedEntries.length} places</span>
                    </div>
                    <div className="space-y-3">
                      {unrankedEntries.map((entry) => (
                        <div
                          key={entry.googlePlaceId || entry.id}
                          className="flex items-center gap-3 cursor-pointer group"
                          onClick={() => handleCardClick(entry)}
                          data-testid={`card-search-${entry.googlePlaceId || entry.id}`}
                        >
                          <div className="w-6 flex-shrink-0" />
                          {entry.image ? (
                            <img src={entry.image && entry.image.includes('/api/places/photo') && entry.googlePlaceId && !entry.image.includes('placeId=') ? `${entry.image}${entry.image.includes('?') ? '&' : '?'}placeId=${encodeURIComponent(entry.googlePlaceId)}` : entry.image} className="w-12 h-12 rounded-lg object-cover" alt={entry.name} loading="lazy" />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center">
                              <MapPin size={16} className="text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-sm truncate group-hover:text-primary transition-colors">{entry.name}</h3>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              {entry.googleRating ? (
                                <span className="flex items-center font-semibold">
                                  <span className="text-amber-500 mr-0.5">★</span>
                                  {entry.googleRating}
                                </span>
                              ) : null}
                              {(() => { const label = getDisplayCategoryLabel(entry.googleTypes, entry.googlePrimaryType, entry.category); return label && label !== 'Restaurant' ? (<><span>·</span><span>{label}</span></>) : null; })()}
                              {entry.priceLevel && (
                                <>
                                  <span>·</span>
                                  <span>{PRICE_LABELS[Number(entry.priceLevel)] || '$$'}</span>
                                </>
                              )}
                              {entry.location && (
                                <>
                                  <span>·</span>
                                  <span className="truncate max-w-[120px]">{entry.location}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            className="text-xs font-bold bg-foreground text-background px-3 py-1.5 rounded-full whitespace-nowrap hover:bg-foreground/90 transition-colors flex items-center gap-1"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!isAuthenticated) {
                                window.location.href = '/api/login';
                                return;
                              }
                              const id = ensureSearchEntryInStore(entry);
                              const result = await startServerRankingSession([id]);
                              if (result === 'completed') {
                                setLocation('/my-list');
                              } else if (result === 'matchup') {
                                setLocation('/matchup');
                              }
                            }}
                            data-testid={`button-rank-${entry.googlePlaceId || entry.id}`}
                          >
                            <Plus size={12} />
                            Rank
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
              );
            })()}
          </div>
        </div>
      </div>
    </Layout>
  );
}
