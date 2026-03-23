import Layout from "@/components/Layout";
import { useStore } from "@/lib/store";
import { Filter, X, DollarSign, Trophy, Loader2, Users, TrendingUp, TrendingDown, Flame, Fish, Egg, Coffee, Wine, Sandwich, Star, UtensilsCrossed, Soup, Pizza, Beef } from "lucide-react";
import { ConfidenceBadge } from "@/components/ScoreExplanation";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { getDisplayCategoryLabel } from "@shared/displayCategory";
import { BucketToggle } from "@/components/BucketToggle";

const PRICE_LABELS = ['Free', '$', '$$', '$$$', '$$$$'];

interface LeaderboardEntry {
  id: string;
  name: string;
  image: string | null;
  category: string | null;
  location: string | null;
  priceLevel: string | null;
  googlePlaceId: string | null;
  tags: string[] | null;
  googleTypes: string[] | null;
  googlePrimaryType: string | null;
  lat?: number;
  lng?: number;
  score: number;
  appearances: number;
  avgRank: number;
  movement?: number | null;
  isNew?: boolean;
}

export default function Leaderboard() {
  const { homeArea, activeBucket } = useStore();
  const [_, setLocation] = useLocation();
  const [showFilters, setShowFilters] = useState(false);
  const initialTag = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tag');
  }, []);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTag ? [initialTag] : []);

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

  const CategoryScoreIcon = ({ tag, size = 10, className }: { tag: string | null; size?: number; className?: string }) => {
    const t = tag ?? "";
    if (!t) return <Trophy size={size} className={className ?? "text-amber-500"} />;
    const m = TAG_ICON_MAP[t];
    if (!m) return <Star size={size} className={className ?? "text-primary"} />;
    const I = m.Icon;
    return <I size={size} className={className ?? m.className} />;
  };

  const primaryTag = selectedTags[0] ?? null;

  const [selectedPriceLevels, setSelectedPriceLevels] = useState<number[]>([]);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagInput, setTagInput] = useState('');

  const areaLabel = homeArea?.label || "Chattanooga, TN";

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (homeArea?.lat) params.set('lat', String(homeArea.lat));
        if (homeArea?.lng) params.set('lng', String(homeArea.lng));
        params.set('radius', '50');
        params.set('limit', '100');
        params.set('bucket', activeBucket);
        if (selectedTags.length > 0) {
          params.set('tag', selectedTags[0]);
        }
        if (selectedPriceLevels.length > 0) {
          params.set('price', selectedPriceLevels.join(','));
        }
        
        const res = await fetch(`/api/leaderboard?${params}`);
        if (res.ok) {
          const data = await res.json();
          setEntries(data.results || []);
        }
      } catch (e) {
        console.error("Failed to fetch leaderboard:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [homeArea?.lat, homeArea?.lng, selectedTags, selectedPriceLevels, activeBucket]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [tag]
    );
  };

  const togglePrice = (level: number) => {
    setSelectedPriceLevels(prev =>
      prev.includes(level) ? prev.filter(p => p !== level) : [...prev, level]
    );
  };

  const activeFilterCount = (selectedTags.length > 0 ? 1 : 0) + (selectedPriceLevels.length > 0 ? 1 : 0);
  const showMovements = activeFilterCount === 0;

  const clearFilters = () => {
    setSelectedTags([]);
    setSelectedPriceLevels([]);
  };

  const quickTags = ['pizza', 'bbq', 'mexican', 'italian', 'asian', 'southern', 'seafood', 'burgers', 'breakfast', 'fine dining'];

  const handleCardClick = (entry: LeaderboardEntry) => {
    const { addNewRestaurant } = useStore.getState();
    const id = addNewRestaurant({
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
    });
    setLocation(`/restaurant/${id}`);
  };

  return (
    <Layout>
      <div className="relative">
        <div className="pt-12 pb-6 px-6 w-full relative">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-heading font-extrabold text-foreground" data-testid="text-city-name">
                    {areaLabel}
                </h1>
                <p className="text-sm font-medium text-muted-foreground flex items-center gap-1 mt-1">
                    <CategoryScoreIcon tag={primaryTag} size={12} /> Ranked by TAKE users
                </p>
                <div className="mt-2">
                  <BucketToggle />
                </div>
              </div>

              <Button 
                size="icon" 
                className="rounded-full bg-secondary shadow-sm text-foreground hover:bg-secondary/80 flex-shrink-0"
                onClick={() => setShowFilters(!showFilters)}
                data-testid="button-toggle-filters"
              >
                <Filter size={18} />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>
        </div>

        {showFilters && (
          <div className="absolute top-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-xl border-b border-border shadow-2xl animate-in slide-in-from-top-4 duration-300" data-testid="panel-filters">
            <div className="p-6 pt-8 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-heading font-bold">Filters</h2>
                <div className="flex items-center gap-2">
                  {activeFilterCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground text-xs" data-testid="button-clear-filters">
                      Clear All
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => setShowFilters(false)} className="rounded-full" data-testid="button-close-filters">
                    <X size={20} />
                  </Button>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="text-sm font-bold uppercase text-muted-foreground mb-3 tracking-wider">Cuisine / Tag</h3>
                <div className="flex flex-wrap gap-2">
                  {quickTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all capitalize ${
                        selectedTags.includes(tag)
                          ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                      data-testid={`chip-tag-${tag}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <h3 className="text-sm font-bold uppercase text-muted-foreground mb-3 tracking-wider">Price Range</h3>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map(level => (
                    <button
                      key={level}
                      onClick={() => togglePrice(level)}
                      className={`flex items-center gap-0.5 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                        selectedPriceLevels.includes(level)
                          ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                      data-testid={`button-price-${level}`}
                    >
                      {Array.from({ length: level }).map((_, i) => (
                        <DollarSign key={i} size={14} />
                      ))}
                    </button>
                  ))}
                </div>
              </div>

              <Button 
                className="w-full mt-4 h-12 text-base font-bold rounded-xl"
                onClick={() => setShowFilters(false)}
                data-testid="button-apply-filters"
              >
                Apply Filters
              </Button>
            </div>
          </div>
        )}

        <div className="px-6 pt-4 pb-8 bg-background min-h-[500px] relative">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold font-heading" data-testid="text-section-title">
                  Top Ranked
                  {activeFilterCount > 0 && selectedTags.length > 0 && (
                    <span className="text-primary capitalize ml-1">{selectedTags[0]}</span>
                  )}
                </h2>
                <span className="text-xs text-muted-foreground font-medium">{entries.length} places</span>
            </div>

            {activeFilterCount > 0 && (
              <div className="flex flex-wrap gap-2 mb-4" data-testid="active-filters-bar">
                {selectedTags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary font-bold px-2.5 py-1 rounded-full capitalize">
                    {t}
                    <X size={12} className="cursor-pointer hover:text-primary/70" onClick={() => toggleTag(t)} />
                  </span>
                ))}
                {selectedPriceLevels.map(p => (
                  <span key={p} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary font-bold px-2.5 py-1 rounded-full">
                    {PRICE_LABELS[p]}
                    <X size={12} className="cursor-pointer hover:text-primary/70" onClick={() => togglePrice(p)} />
                  </span>
                ))}
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="animate-spin text-primary" size={24} />
              </div>
            ) : (
              <div className="space-y-6">
                  {entries.map((entry, i) => {
                    if (entry.appearances < 2) return null;
                    return (
                      <div 
                        key={entry.id} 
                        className="flex items-center gap-4 group cursor-pointer" 
                        data-testid={`card-restaurant-${entry.id}`}
                        onClick={() => handleCardClick(entry)}
                      >
                          <div className="font-heading font-bold text-2xl text-muted-foreground/40 w-8 text-center group-hover:text-primary transition-colors">
                              {i + 1}
                          </div>
                          {entry.image ? (
                            <img src={entry.image && entry.image.includes('/api/places/photo') && entry.googlePlaceId && !entry.image.includes('placeId=') ? `${entry.image}&placeId=${encodeURIComponent(entry.googlePlaceId)}` : entry.image} className="w-16 h-16 rounded-xl object-cover shadow-sm" alt={entry.name} />
                          ) : (
                            <div className="w-16 h-16 rounded-xl bg-secondary flex items-center justify-center">
                              <Trophy size={20} className="text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-base truncate" data-testid={`text-name-${entry.id}`}>{entry.name}</h3>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                  <span className="flex items-center text-primary font-bold">
                                      <CategoryScoreIcon tag={primaryTag} size={10} className="mr-0.5" />
                                      {entry.score}
                                  </span>
                                  <ConfidenceBadge appearances={entry.appearances} />
                                  {showMovements && entry.isNew && (
                                    <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded-full leading-none" data-testid={`badge-new-${entry.id}`}>NEW</span>
                                  )}
                                  {showMovements && !entry.isNew && entry.movement != null && entry.movement > 0 && (
                                    <span className="flex items-center text-[10px] font-bold text-emerald-500" data-testid={`badge-up-${entry.id}`}>
                                      <TrendingUp size={10} className="mr-0.5" />
                                      {entry.movement}
                                    </span>
                                  )}
                                  {showMovements && !entry.isNew && entry.movement != null && entry.movement < 0 && (
                                    <span className="flex items-center text-[10px] font-bold text-red-500" data-testid={`badge-down-${entry.id}`}>
                                      <TrendingDown size={10} className="mr-0.5" />
                                      {Math.abs(entry.movement)}
                                    </span>
                                  )}
                                  {(() => {
                                    const displayCat = getDisplayCategoryLabel(entry.googleTypes || undefined, entry.googlePrimaryType || undefined, entry.category || undefined);
                                    return displayCat && displayCat !== 'Restaurant' ? (
                                      <>
                                        <span>·</span>
                                        <span>{displayCat}</span>
                                      </>
                                    ) : null;
                                  })()}
                                  {entry.priceLevel && (
                                    <>
                                      <span>·</span>
                                      <span className="text-muted-foreground/70">
                                        {PRICE_LABELS[Number(entry.priceLevel)] || '$$'}
                                      </span>
                                    </>
                                  )}
                              </div>
                          </div>
                          <div className="text-xs font-bold bg-secondary px-2 py-1 rounded-md text-secondary-foreground flex items-center gap-1" data-testid={`text-appearances-${entry.id}`}>
                              <Users size={10} />
                              {entry.appearances} {entry.appearances === 1 ? 'TAKE' : 'TAKES'}
                          </div>
                      </div>
                    );
                  })}

                  {entries.length === 0 && !loading && (
                    <div className="text-center py-16" data-testid="text-no-results">
                      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
                        <Trophy size={32} />
                      </div>
                      <p className="text-lg font-bold text-muted-foreground mb-2">No rankings yet</p>
                      <p className="text-sm text-muted-foreground/70 mb-4">
                        Be the first to rank {activeBucket === 'bar' ? 'bars' : 'restaurants'} in {areaLabel}!
                      </p>
                      <Button variant="outline" size="sm" onClick={() => setLocation('/add')} data-testid="button-start-ranking">
                        Start Ranking
                      </Button>
                    </div>
                  )}
              </div>
            )}
        </div>
      </div>
    </Layout>
  );
}
