import { useStore, startServerRankingSession } from "@/lib/store";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, MapPin, Trophy, Trash2, ExternalLink, ShoppingBag, RefreshCw, Phone, Globe, Clock, DollarSign, Plus, Loader2, Info, UtensilsCrossed, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Shield, Sparkles, Users, Flag } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { getDisplayCategoryLabel } from "@shared/displayCategory";
import { getConfidenceTier, ConfidenceBadge } from "@/components/ScoreExplanation";
import type { Restaurant } from "@/lib/store";

function DetailHeroImage({ restaurant }: { restaurant: Restaurant }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    if (restaurant.image) {
      // Only append placeId if not already present in the stored URL
      if (restaurant.googlePlaceId && !restaurant.image.includes('placeId=')) {
        const sep = restaurant.image.includes('?') ? '&' : '?';
        setSrc(`${restaurant.image}${sep}placeId=${encodeURIComponent(restaurant.googlePlaceId)}`);
      } else {
        setSrc(restaurant.image);
      }
    }
  }, [restaurant.image, restaurant.googlePlaceId]);

  const handleError = () => {
    setFailed(true);
  };

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={restaurant.name}
        className="w-full h-full object-cover"
        onError={handleError}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-secondary">
      <UtensilsCrossed size={48} className="text-muted-foreground/30" />
    </div>
  );
}

interface PlaceDetails {
  formatted_address?: string;
  formatted_phone_number?: string;
  website?: string;
  url?: string;
  opening_hours?: {
    open_now?: boolean;
    weekday_text?: string[];
  };
  editorial_summary?: {
    overview?: string;
  };
  types?: string[];
  photos?: { photo_reference: string }[];
}

export default function RestaurantDetail() {
  const [match, params] = useRoute("/restaurant/:id");
  const { isAuthenticated } = useAuth();
  const { restaurants, userRanking, removeFromRanking, rerankRestaurant, startBatchRanking, addNewRestaurant } = useStore();
  const [_, setLocation] = useLocation();
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);
  const [placeDetails, setPlaceDetails] = useState<PlaceDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingRestaurant, setLoadingRestaurant] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [showHours, setShowHours] = useState(false);
  const [takeScore, setTakeScore] = useState<{ score: number; appearances: number; movement?: number | null; isNew?: boolean } | null>(null);
  const [showScoreTooltip, setShowScoreTooltip] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const { toast } = useToast();

  const restaurant = restaurants.find(r => r.id === params?.id || r.googlePlaceId === params?.id);
  const restaurantId = restaurant?.id || params?.id || "";
  const rankIndex = userRanking.indexOf(restaurantId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;

  useEffect(() => {
    if (restaurant || !params?.id) return;
    setLoadingRestaurant(true);
    fetch(`/api/restaurants/${params.id}`)
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(data => {
        addNewRestaurant({
          id: data.id,
          name: data.name,
          image: data.image || '',
          tags: data.tags || [],
          location: data.location || '',
          category: data.category || '',
          rating: data.rating || 0,
          votes: data.votes || 0,
          priceLevel: data.priceLevel ? parseInt(data.priceLevel) : 0,
          googlePlaceId: data.googlePlaceId || undefined,
          lat: data.lat,
          lng: data.lng,
          googleTypes: data.googleTypes || undefined,
          googlePrimaryType: data.googlePrimaryType || undefined,
        });
      })
      .catch(async () => {
        try {
          const detailRes = await fetch(`/api/places/details?place_id=${params.id}`);
          const detailData = await detailRes.json();
          const result = detailData.result;
          if (result) {
            const photoRef = result.photos?.[0]?.photo_reference;
            const imageUrl = photoRef ? `/api/places/photo?ref=${encodeURIComponent(photoRef)}&placeId=${encodeURIComponent(params.id!)}` : '';
            addNewRestaurant({
              id: params.id!,
              name: result.name || 'Unknown',
              image: imageUrl,
              tags: result.types || [],
              location: result.formatted_address || result.vicinity || '',
              category: '',
              rating: result.rating || 0,
              votes: result.user_ratings_total || 0,
              priceLevel: result.price_level || 0,
              googlePlaceId: params.id,
              lat: result.geometry?.location?.lat,
              lng: result.geometry?.location?.lng,
              googleTypes: result.types || undefined,
              googlePrimaryType: undefined,
            });
          } else {
            setNotFound(true);
          }
        } catch {
          setNotFound(true);
        }
      })
      .finally(() => setLoadingRestaurant(false));
  }, [params?.id, restaurant]);

  useEffect(() => {
    if (!restaurant?.googlePlaceId) return;
    setLoadingDetails(true);
    fetch(`/api/places/details?place_id=${restaurant.googlePlaceId}`)
      .then(res => res.json())
      .then(data => {
        if (data.result) setPlaceDetails(data.result);
      })
      .catch(() => {})
      .finally(() => setLoadingDetails(false));
  }, [restaurant?.googlePlaceId]);

  useEffect(() => {
    if (!restaurant) return;
    const placeId = restaurant.googlePlaceId || restaurant.id;
    const lat = restaurant.lat;
    const lng = restaurant.lng;
    if (!lat || !lng) return;
    const bucket = useStore.getState().activeBucket;
    fetch(`/api/leaderboard?lat=${lat}&lng=${lng}&radius=100&limit=200&bucket=${bucket}`)
      .then(res => res.json())
      .then(data => {
        const match = (data.results || []).find((r: any) => r.googlePlaceId === placeId || r.id === restaurant.id);
        if (match) {
          setTakeScore({ score: match.score, appearances: match.appearances, movement: match.movement, isNew: match.isNew });
        }
      })
      .catch(() => {});
  }, [restaurant?.id, restaurant?.googlePlaceId, restaurant?.lat, restaurant?.lng]);

  if (loadingRestaurant) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  if (!restaurant || notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Restaurant not found</h2>
          <Button variant="outline" onClick={() => setLocation('/')}>Go back</Button>
        </div>
      </div>
    );
  }

  const handleRemove = () => {
    removeFromRanking(restaurant.id);
    toast({
      title: "Removed from ranking",
      description: `${restaurant.name} has been removed from your list.`,
    });
    setLocation('/my-list');
  };

  const handleRerank = () => {
    rerankRestaurant(restaurant.id);
    setLocation('/matchup');
  };

  const priceLevelLabel = (level: number) => {
    if (!level) return '$';
    return '$'.repeat(level);
  };

  const handleOrder = () => {
    toast({
      title: "Order Placed!",
      description: `Your TAKEout from ${restaurant.name} is on the way.`,
    });
  };

  const address = placeDetails?.formatted_address || restaurant.location;
  const phone = placeDetails?.formatted_phone_number;
  const website = placeDetails?.website;
  const mapsUrl = placeDetails?.url || (restaurant.googlePlaceId ? `https://www.google.com/maps/place/?q=place_id:${restaurant.googlePlaceId}` : null);
  const hours = placeDetails?.opening_hours;
  const description = placeDetails?.editorial_summary?.overview;
  // Extract the photo ref used for the hero image so we can exclude it from thumbnails
  const heroRef = (() => {
    try {
      const url = new URL(restaurant.image, window.location.origin);
      return url.searchParams.get('ref') || '';
    } catch { return ''; }
  })();
  // Deduplicate photos and exclude the one already shown as the hero image
  const extraPhotos = (placeDetails?.photos || [])
    .filter((photo, idx, arr) =>
      photo.photo_reference !== heroRef &&
      arr.findIndex(p => p.photo_reference === photo.photo_reference) === idx
    )
    .slice(0, 3);

  const displayTypes = (placeDetails?.types || [])
    .filter(t => !['restaurant', 'food', 'point_of_interest', 'establishment', 'political', 'geocode'].includes(t))
    .slice(0, 4)
    .map(t => t.replace(/_/g, ' '));

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto">
      <div className="relative">
        <div className="h-64 relative overflow-hidden">
          <DetailHeroImage restaurant={restaurant} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          <button 
            onClick={() => window.history.length > 1 ? window.history.back() : setLocation('/')}
            className="absolute top-4 left-4 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/60 transition-colors z-10"
            data-testid="button-back"
          >
            <ArrowLeft size={20} />
          </button>

          {rank && (
            <div className="absolute top-4 right-4 bg-primary text-primary-foreground font-heading px-4 py-2 rounded-xl shadow-lg z-10 text-center leading-tight">
              <div className="text-[10px] font-bold tracking-wide uppercase opacity-90">your</div>
              <div className="font-black text-2xl">#{rank}</div>
            </div>
          )}

          <div className="absolute bottom-0 left-0 right-0 p-6 text-white z-10">
            <h1 className="text-3xl font-heading font-black leading-tight mb-1" data-testid="text-restaurant-name">
              {restaurant.name}
            </h1>
            {address && (
              <div className="flex items-center gap-2 text-white/80 text-sm">
                <MapPin size={14} />
                <span>{address}</span>
              </div>
            )}
          </div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 space-y-5"
        >
          {rank ? (
            <Button 
              className="w-full h-11 text-sm font-bold rounded-xl"
              variant="outline"
              onClick={handleRerank}
              data-testid="button-rerank"
            >
              <RefreshCw size={16} className="mr-2" />
              Place Again (Re-rank)
            </Button>
          ) : (
            <Button 
              className="w-full h-12 text-base font-bold rounded-xl bg-foreground text-background hover:bg-foreground/90 shadow-lg"
              onClick={async () => {
                if (!isAuthenticated) {
                  window.location.href = '/api/login';
                  return;
                }
                const result = await startServerRankingSession([restaurant.id]);
                if (result === 'completed') {
                  setLocation('/my-list');
                } else if (result === 'matchup') {
                  setLocation('/matchup');
                }
              }}
              data-testid="button-rank-this"
            >
              <Plus size={18} className="mr-2" />
              Rank This Place
            </Button>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            {takeScore && (
              <div className="relative">
                <button
                  onClick={() => setShowScoreTooltip(!showScoreTooltip)}
                  className="flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 rounded-lg cursor-pointer hover:bg-primary/15 transition-colors"
                  data-testid="button-take-score"
                >
                  <Trophy size={18} className="text-amber-500" fill="currentColor" />
                  <span className="font-bold text-lg">{takeScore.score}</span>
                  <ConfidenceBadge appearances={takeScore.appearances} />
                </button>
                {showScoreTooltip && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowScoreTooltip(false)} />
                    <div className="absolute top-full left-0 mt-2 z-50 w-56 bg-popover border border-border rounded-xl shadow-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Trophy size={12} className="text-amber-500" fill="currentColor" />
                        <span className="font-bold text-sm">TAKE Score</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        A score from 60–99 based on how users rank this restaurant against others. Higher means it wins more head-to-head matchups.
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1.5">Based on {takeScore.appearances} user ranking{takeScore.appearances !== 1 ? 's' : ''}</p>
                      <div className="absolute left-6 -top-1 w-2 h-2 bg-popover border-l border-t border-border rotate-45" />
                    </div>
                  </>
                )}
              </div>
            )}
            {restaurant.priceLevel > 0 && (
              <div className="flex items-center gap-1 bg-green-50 text-green-600 px-3 py-1.5 rounded-lg font-bold">
                <DollarSign size={14} />
                {priceLevelLabel(restaurant.priceLevel)}
              </div>
            )}
            {(() => { const label = getDisplayCategoryLabel(restaurant.googleTypes, restaurant.googlePrimaryType, restaurant.category); return label && label !== 'Restaurant' ? (<div className="bg-secondary text-secondary-foreground px-3 py-1.5 rounded-lg text-sm font-semibold">{label}</div>) : null; })()}
          </div>

          {takeScore && (
            <div className="border border-border/50 rounded-xl overflow-hidden" data-testid="section-why-ranked">
              <button
                onClick={() => setShowExplainer(!showExplainer)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary/30 transition-colors"
                data-testid="button-why-ranked"
              >
                <span className="flex items-center gap-2">
                  <Info size={14} className="text-muted-foreground" />
                  Why is this ranked?
                </span>
                {showExplainer ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
              </button>
              {showExplainer && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                  <div className="flex items-center gap-3" data-testid="text-explainer-appearances">
                    <Users size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      Appears in <span className="font-bold text-foreground">{takeScore.appearances}</span> {takeScore.appearances === 1 ? 'TAKE' : 'TAKES'}
                    </span>
                  </div>
                  {(() => {
                    const tier = getConfidenceTier(takeScore.appearances);
                    const tierConfig = { new: { label: 'Low', color: 'text-blue-500', Icon: Sparkles }, growing: { label: 'Medium', color: 'text-amber-500', Icon: TrendingUp }, proven: { label: 'High', color: 'text-emerald-500', Icon: Shield } };
                    const cfg = tierConfig[tier];
                    return (
                      <div className="flex items-center gap-3" data-testid="text-explainer-confidence">
                        <cfg.Icon size={14} className={`${cfg.color} flex-shrink-0`} />
                        <span className="text-sm text-muted-foreground">
                          Confidence: <span className={`font-bold ${cfg.color}`}>{cfg.label}</span>
                        </span>
                      </div>
                    );
                  })()}
                  {(takeScore.isNew || (takeScore.movement != null && takeScore.movement !== 0)) && (
                    <div className="flex items-center gap-3" data-testid="text-explainer-movement">
                      {takeScore.isNew ? (
                        <>
                          <Sparkles size={14} className="text-blue-500 flex-shrink-0" />
                          <span className="text-sm font-bold text-blue-500">NEW</span>
                        </>
                      ) : takeScore.movement != null && takeScore.movement > 0 ? (
                        <>
                          <TrendingUp size={14} className="text-emerald-500 flex-shrink-0" />
                          <span className="text-sm text-muted-foreground">
                            Moved up <span className="font-bold text-emerald-500">{takeScore.movement}</span> {takeScore.movement === 1 ? 'spot' : 'spots'}
                          </span>
                        </>
                      ) : (
                        <>
                          <TrendingDown size={14} className="text-red-500 flex-shrink-0" />
                          <span className="text-sm text-muted-foreground">
                            Moved down <span className="font-bold text-red-500">{Math.abs(takeScore.movement!)}</span> {Math.abs(takeScore.movement!) === 1 ? 'spot' : 'spots'}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground/60 leading-relaxed pt-1">
                    TAKE scores (60–99) reflect how users rank this place in head-to-head matchups. More appearances = higher confidence.
                  </p>
                </div>
              )}
            </div>
          )}

          {displayTypes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {displayTypes.map(type => (
                <span key={type} className="px-3 py-1 bg-secondary text-secondary-foreground rounded-full text-xs font-bold capitalize">
                  {type}
                </span>
              ))}
            </div>
          )}

          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-description">
              {description}
            </p>
          )}

          {extraPhotos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {extraPhotos.map((photo, i) => (
                <img
                  key={i}
                  src={`/api/places/photo?ref=${encodeURIComponent(photo.photo_reference)}&placeId=${encodeURIComponent(restaurant.googlePlaceId || '')}&photoIndex=${i + 1}`}
                  alt={`${restaurant.name} photo ${i + 2}`}
                  className="h-24 w-24 rounded-lg object-cover flex-shrink-0"
                  loading="lazy"
                />
              ))}
            </div>
          )}

          <div className="space-y-2">
            {phone && (
              <a href={`tel:${phone}`} className="flex items-center gap-3 py-2 text-sm text-foreground hover:text-primary transition-colors" data-testid="link-phone">
                <Phone size={16} className="text-muted-foreground" />
                <span>{phone}</span>
              </a>
            )}
            {website && (
              <a href={website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-2 text-sm text-foreground hover:text-primary transition-colors truncate" data-testid="link-website">
                <Globe size={16} className="text-muted-foreground" />
                <span className="truncate">{website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
              </a>
            )}
            {hours && (
              <div>
                <button
                  onClick={() => setShowHours(!showHours)}
                  className="flex items-center gap-3 py-2 text-sm text-foreground hover:text-primary transition-colors w-full"
                  data-testid="button-toggle-hours"
                >
                  <Clock size={16} className="text-muted-foreground" />
                  <span className="flex-1 text-left">
                    {hours.open_now != null ? (hours.open_now ? 'Open now' : 'Closed') : 'Hours'}
                  </span>
                  <span className="text-xs text-muted-foreground">{showHours ? 'Hide' : 'Show'}</span>
                </button>
                {showHours && hours.weekday_text && (
                  <div className="ml-9 space-y-1 pb-2">
                    {hours.weekday_text.map((line, i) => (
                      <p key={i} className="text-xs text-muted-foreground">{line}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {restaurant.tags.length > 0 && !displayTypes.length && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {restaurant.tags.map(tag => (
                  <span key={tag} className="px-3 py-1 bg-secondary text-secondary-foreground rounded-full text-xs font-bold uppercase tracking-wider">
                    {tag.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          <Button 
            className="w-full h-12 text-base font-bold rounded-xl bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
            variant="ghost"
            onClick={handleOrder}
            data-testid="button-order"
          >
            <ShoppingBag size={18} className="mr-2" />
            Order <span className="font-heading font-black uppercase tracking-tighter ml-1">TAKE</span>out
          </Button>

          {mapsUrl && (
            <Button 
              variant="outline" 
              className="w-full h-12 rounded-xl text-sm"
              onClick={() => window.open(mapsUrl, '_blank')}
              data-testid="button-view-maps"
            >
              <ExternalLink size={16} className="mr-2" />
              View on Google Maps
            </Button>
          )}

          {rank && (
            <div className="pt-4 border-t border-border">
              {!showConfirmRemove ? (
                <Button 
                  variant="ghost" 
                  className="w-full h-12 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowConfirmRemove(true)}
                  data-testid="button-remove"
                >
                  <Trash2 size={16} className="mr-2" />
                  Remove from Ranking
                </Button>
              ) : (
                <div className="space-y-2 animate-in slide-in-from-bottom-2">
                  <p className="text-sm text-center text-muted-foreground">
                    Remove <strong>{restaurant.name}</strong> from your ranking?
                  </p>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 h-10 rounded-xl"
                      onClick={() => setShowConfirmRemove(false)}
                      data-testid="button-cancel-remove"
                    >
                      Cancel
                    </Button>
                    <Button 
                      variant="destructive" 
                      className="flex-1 h-10 rounded-xl"
                      onClick={handleRemove}
                      data-testid="button-confirm-remove"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-4 border-t border-border">
            {!showReportForm ? (
              <Button
                variant="ghost"
                className="w-full h-10 rounded-xl text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowReportForm(true)}
                data-testid="button-report"
              >
                <Flag size={14} className="mr-2" />
                Report an issue with this place
              </Button>
            ) : (
              <div className="space-y-3 animate-in slide-in-from-bottom-2 bg-muted/30 rounded-xl p-4">
                <p className="text-sm font-medium">Report this place</p>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                  data-testid="select-report-reason"
                >
                  <option value="">Select a reason...</option>
                  <option value="Closed">Permanently closed</option>
                  <option value="Wrong info">Wrong information</option>
                  <option value="Duplicate">Duplicate listing</option>
                  <option value="Offensive">Offensive content</option>
                  <option value="Other">Other</option>
                </select>
                <textarea
                  value={reportMessage}
                  onChange={(e) => setReportMessage(e.target.value)}
                  placeholder="Additional details (optional)"
                  className="w-full h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                  maxLength={500}
                  data-testid="input-report-message"
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 rounded-lg" onClick={() => { setShowReportForm(false); setReportReason(""); setReportMessage(""); }} data-testid="button-cancel-report">Cancel</Button>
                  <Button
                    size="sm"
                    className="flex-1 rounded-lg"
                    disabled={!reportReason || reportSubmitting}
                    onClick={async () => {
                      setReportSubmitting(true);
                      try {
                        const placeId = restaurant.googlePlaceId || restaurant.id;
                        const r = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ placeId, reason: reportReason, message: reportMessage || undefined }) });
                        if (r.ok) {
                          toast({ title: "Report submitted", description: "Thanks for helping keep TAKE accurate" });
                          setShowReportForm(false);
                          setReportReason("");
                          setReportMessage("");
                        } else {
                          const d = await r.json().catch(() => ({}));
                          toast({ title: d.error === "Unauthorized" ? "Sign in to report" : "Failed to submit", variant: "destructive" });
                        }
                      } catch {
                        toast({ title: "Failed to submit report", variant: "destructive" });
                      } finally {
                        setReportSubmitting(false);
                      }
                    }}
                    data-testid="button-submit-report"
                  >
                    {reportSubmitting ? "Submitting..." : "Submit Report"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
