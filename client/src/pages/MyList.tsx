import { useStore, type Restaurant } from "@/lib/store";
import Layout from "@/components/Layout";
import RestaurantCard from "@/components/RestaurantCard";
import { Plus, Trophy, Instagram, LogIn, UtensilsCrossed, ChevronDown, ChevronUp, Share2, TrendingUp, TrendingDown, UserPlus, Link2, Copy } from "lucide-react";

import { getGenreIcon } from "@/lib/genreIcons";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "wouter";
import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import * as htmlToImage from "html-to-image";
import { useAuth } from "@/hooks/use-auth";
import { useClerk } from "@clerk/clerk-react";
import { CUISINE_LABELS } from "@shared/tagInference";
import { BucketToggle } from "@/components/BucketToggle";
import { useToast } from "@/hooks/use-toast";

function resolveImageSrc(image: string | undefined, googlePlaceId?: string): string {
  if (!image) return '';
  if (image.includes('/api/places/photo') && googlePlaceId && !image.includes('placeId=')) {
    const sep = image.includes('?') ? '&' : '?';
    return `${image}${sep}placeId=${encodeURIComponent(googlePlaceId)}`;
  }
  return image;
}

function matchesGenre(restaurant: Restaurant, tag: string): boolean {
  const tags = (restaurant.tags || []).map(t => t.toLowerCase());
  const category = (restaurant.category || '').toLowerCase();
  const label = (CUISINE_LABELS[tag] || '').toLowerCase();
  return tags.includes(tag) || category === label || category.toLowerCase() === tag;
}

function CollageGrid({ items, categoryLabel }: { items: (Restaurant | null)[]; categoryLabel?: string }) {
  return (
    <div className="w-full aspect-square bg-background rounded-xl overflow-hidden shadow-lg border border-border flex flex-col relative">
      <div className="absolute top-0 left-0 right-0 bg-background/90 backdrop-blur-sm px-3 py-2 z-20 border-b border-border/50 flex justify-between items-center">
        <h2 className="text-sm font-heading font-black tracking-tighter uppercase leading-none">
          <span className="font-light">MY</span>{categoryLabel ? ` ${categoryLabel}` : ''} TAKE <span className="text-primary text-[10px] font-bold tracking-widest ml-1">what's yours?</span>
        </h2>
      </div>
      <div className="grid grid-cols-3 grid-rows-3 h-full w-full">
        {items.map((item, i) => (
          <div key={i} className="relative border-[0.5px] border-white/20 overflow-hidden group bg-muted">
            {item ? (
              <>
                <img
                  src={resolveImageSrc(item.image, item.googlePlaceId)}
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                  alt={item.name}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-80" />
                <div className="absolute bottom-0 left-0 right-0 p-1.5 text-white">
                  <div className="text-[8px] font-bold bg-primary w-4 h-4 rounded-full flex items-center justify-center mb-0.5 text-primary-foreground">
                    {i + 1}
                  </div>
                  <p className="text-[10px] font-bold leading-tight line-clamp-2">{item.name}</p>
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-secondary/50 text-muted-foreground/30">
                <div className="text-2xl font-black opacity-20">{i + 1}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenreSection({ title, restaurants, setLocation, categoryLabel, genreTag }: { title: string; restaurants: Restaurant[]; setLocation: (path: string) => void; categoryLabel?: string; genreTag?: string }) {
  const collageRef = useRef<HTMLDivElement>(null);
  const [showShare, setShowShare] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const top9 = restaurants.slice(0, 9);
  const paddedTop9 = [...top9, ...Array(9 - top9.length).fill(null)].slice(0, 9);

  const handleShare = async () => {
    if (!collageRef.current) return;
    setIsGenerating(true);
    try {
      const dataUrl = await htmlToImage.toPng(collageRef.current, {
        quality: 0.95,
        backgroundColor: '#fff',
        pixelRatio: 2,
      });
      const filename = categoryLabel
        ? `my-take-${categoryLabel.toLowerCase().replace(/\s+/g, '-')}.png`
        : 'my-take-top-9.png';
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();

      if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: categoryLabel ? `My Top ${categoryLabel} on TAKE` : 'My Top 9 on TAKE',
            text: categoryLabel
              ? `Check out my top ${categoryLabel} on TAKE! what's yours?`
              : `Check out my top ranked ${useStore.getState().activeBucket === 'bar' ? 'bars' : 'restaurants'} on TAKE! what's yours?`
          });
        }
      }
    } catch (error) {
      console.error('Error generating image:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-6">
        {(() => {
          const config = genreTag ? getGenreIcon(genreTag) : { icon: Trophy, color: 'text-amber-500' };
          const Icon = config.icon;
          return <Icon size={16} className={config.color} />;
        })()}
        <h2 className="text-base font-heading font-bold">{title}</h2>
        <span className="text-xs text-muted-foreground">{restaurants.length}</span>
        <button
          onClick={() => setShowShare(!showShare)}
          className="ml-auto text-[11px] font-semibold text-muted-foreground hover:text-primary transition-colors border border-border rounded-full px-3 py-1 flex items-center gap-1"
          data-testid={`button-share-section-${categoryLabel || 'top'}`}
        >
          <Share2 size={11} />
          share your TAKE
        </button>
      </div>
      <div className="flex gap-2.5 overflow-x-auto px-6 pb-2 scrollbar-hide snap-x snap-mandatory scroll-pl-6">
        {restaurants.map((restaurant, i) => (
          <motion.div
            key={restaurant.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`flex-shrink-0 w-[calc((100vw-3.5rem)/3.4)] max-w-[115px] snap-start cursor-pointer group ${i === restaurants.length - 1 ? 'mr-6' : ''}`}
            onClick={() => setLocation(`/restaurant/${restaurant.id}`)}
            data-testid={`card-genre-${restaurant.id}`}
          >
            <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-muted mb-1.5">
              {restaurant.image ? (
                <img
                  src={resolveImageSrc(restaurant.image, restaurant.googlePlaceId)}
                  alt={restaurant.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-secondary">
                  <UtensilsCrossed size={32} className="text-muted-foreground/30" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute top-1.5 left-1.5">
                <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1 py-0.5 rounded-md leading-none">
                  #{i + 1}
                </span>
              </div>
            </div>
            <h3 className="font-bold text-[11px] leading-tight line-clamp-2 group-hover:text-primary transition-colors">
              {restaurant.name}
            </h3>
          </motion.div>
        ))}
      </div>
      <AnimatePresence>
        {showShare && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden px-6"
          >
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm">
              <div className="p-4 bg-muted/30 flex flex-col items-center gap-3">
                <div ref={collageRef}>
                  <CollageGrid items={paddedTop9} categoryLabel={categoryLabel} />
                </div>
                <Button
                  onClick={handleShare}
                  disabled={isGenerating}
                  size="sm"
                  className="w-full shadow-sm"
                  data-testid={`button-download-${categoryLabel || 'top'}`}
                >
                  {isGenerating ? 'Generating...' : (
                    <>
                      <Instagram size={16} className="mr-2" />
                      Share to Story
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Save or share to Instagram, Twitter, etc.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface HotTake {
  restaurant: Restaurant;
  userRank: number;
  globalRank: number;
  globalScore: number;
  diff: number;
  direction: 'higher' | 'lower';
}

function HotTakesSection({ hotTakes, setLocation }: { hotTakes: HotTake[]; setLocation: (path: string) => void }) {
  const [showShare, setShowShare] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const collageRef = useRef<HTMLDivElement>(null);

  if (hotTakes.length === 0) return null;

  const handleShare = async () => {
    if (!collageRef.current) return;
    setIsGenerating(true);
    try {
      const dataUrl = await htmlToImage.toPng(collageRef.current, {
        quality: 0.95,
        backgroundColor: '#fff',
        pixelRatio: 2,
      });
      const filename = 'my-hot-takes.png';
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();

      if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'My Hot TAKEs',
            text: 'Check out my hottest takes on TAKE! what\'s yours?',
          });
        }
      }
    } catch (error) {
      console.error('Error generating image:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-6">
        <span className="text-base leading-none">🌶️</span>
        <h2 className="text-base font-heading font-bold">Hot TAKEs</h2>
        <span className="text-xs text-muted-foreground">{hotTakes.length}</span>
        <button
          onClick={() => setShowShare(!showShare)}
          className="ml-auto text-[11px] font-semibold text-muted-foreground hover:text-primary transition-colors border border-border rounded-full px-3 py-1 flex items-center gap-1"
          data-testid="button-share-section-hot-takes"
        >
          <Share2 size={11} />
          share your TAKE
        </button>
      </div>
      <div className="flex gap-2.5 overflow-x-auto px-6 pb-2 scrollbar-hide snap-x snap-mandatory scroll-pl-6">
        {hotTakes.map((ht, i) => (
          <motion.div
            key={ht.restaurant.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`flex-shrink-0 w-[calc((100vw-3.5rem)/3.4)] max-w-[115px] snap-start cursor-pointer group ${i === hotTakes.length - 1 ? 'mr-6' : ''}`}
            onClick={() => setLocation(`/restaurant/${ht.restaurant.id}`)}
            data-testid={`card-hot-take-${ht.restaurant.id}`}
          >
            <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-muted mb-1.5">
              {ht.restaurant.image ? (
                <img
                  src={resolveImageSrc(ht.restaurant.image, ht.restaurant.googlePlaceId)}
                  alt={ht.restaurant.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-secondary">
                  <UtensilsCrossed size={32} className="text-muted-foreground/30" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute top-1.5 left-1.5">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md leading-none flex items-center gap-0.5 ${
                  ht.direction === 'higher'
                    ? 'bg-emerald-500/90 text-white'
                    : 'bg-red-500/90 text-white'
                }`}>
                  {ht.direction === 'higher' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {Math.abs(ht.diff)}
                </span>
              </div>
              <div className="absolute bottom-1.5 left-1.5 right-1.5">
                <div className="flex items-center justify-between text-[10px] text-white/90 font-semibold">
                  <span>#{ht.userRank}</span>
                  <span className="text-white/60">#{ht.globalRank}</span>
                </div>
              </div>
            </div>
            <h3 className="font-bold text-[11px] leading-tight line-clamp-2 group-hover:text-primary transition-colors">
              {ht.restaurant.name}
            </h3>
            <p className={`text-[10px] font-semibold mt-0.5 ${
              ht.direction === 'higher' ? 'text-emerald-500' : 'text-red-500'
            }`}>
              {ht.direction === 'higher' ? 'You rank higher' : 'You rank lower'}
            </p>
          </motion.div>
        ))}
      </div>
      <AnimatePresence>
        {showShare && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden px-6"
          >
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm">
              <div className="p-4 bg-muted/30 flex flex-col items-center gap-3">
                <div ref={collageRef}>
                  <div className="w-full aspect-square bg-background rounded-xl overflow-hidden shadow-lg border border-border flex flex-col relative">
                    <div className="absolute top-0 left-0 right-0 bg-background/90 backdrop-blur-sm px-3 py-2 z-20 border-b border-border/50 flex items-center gap-1.5">
                      <span className="text-sm leading-none">🌶️</span>
                      <h2 className="text-sm font-heading font-black tracking-tighter uppercase leading-none">
                        <span className="font-light">MY</span> HOT TAKEs <span className="text-primary text-[10px] font-bold tracking-widest ml-1">what's yours?</span>
                      </h2>
                    </div>
                    <div className="grid grid-cols-3 grid-rows-3 h-full w-full">
                      {[...hotTakes.slice(0, 9), ...Array(Math.max(0, 9 - hotTakes.length)).fill(null)].slice(0, 9).map((ht: HotTake | null, i: number) => (
                        <div key={i} className="relative border-[0.5px] border-white/20 overflow-hidden bg-muted">
                          {ht ? (
                            <>
                              {ht.restaurant.image ? (
                                <img
                                  src={resolveImageSrc(ht.restaurant.image, ht.restaurant.googlePlaceId)}
                                  className="w-full h-full object-cover"
                                  crossOrigin="anonymous"
                                  alt={ht.restaurant.name}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-secondary">
                                  <UtensilsCrossed size={24} className="text-muted-foreground/30" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                              <div className="absolute top-0 left-0 right-0 p-1 pt-8">
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded leading-none flex items-center gap-0.5 w-fit ${
                                  ht.direction === 'higher'
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-red-500 text-white'
                                }`}>
                                  {ht.direction === 'higher' ? '▲' : '▼'}
                                  {Math.abs(ht.diff)}
                                </span>
                              </div>
                              <div className="absolute bottom-0 left-0 right-0 p-1.5 text-white">
                                <p className="text-[8px] font-bold leading-tight line-clamp-2 mb-0.5">{ht.restaurant.name}</p>
                                <div className="flex items-center gap-1 text-[7px] font-semibold">
                                  <span className="text-white/90">You #{ht.userRank}</span>
                                  <span className="text-white/50">·</span>
                                  <span className="text-white/60">Area #{ht.globalRank}</span>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-secondary/50 text-muted-foreground/30">
                              <span className="text-lg font-black opacity-20">🌶️</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <Button
                  onClick={handleShare}
                  disabled={isGenerating}
                  size="sm"
                  className="w-full shadow-sm"
                  data-testid="button-download-hot-takes"
                >
                  {isGenerating ? 'Generating...' : (
                    <>
                      <Instagram size={16} className="mr-2" />
                      Share to Story
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Save or share to Instagram, Twitter, etc.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MyList() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { openSignIn } = useClerk();
  const { userRanking, restaurants, serverDataLoaded, rankingMovements, homeArea } = useStore();
  const [_, setLocation] = useLocation();
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [randomCategoryIdx] = useState(() =>
    Math.floor(Math.random() * 100)
  );

  const activeBucket = useStore(s => s.activeBucket);
  const { toast } = useToast();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const handleCreateInvite = async () => {
    setInviteLoading(true);
    try {
      const r = await fetch("/api/invites", { method: "POST", credentials: "include" });
      const data = await r.json();
      setInviteUrl(data.url);
    } catch {
      toast({ title: "Failed to create invite link", variant: "destructive" });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvite = () => {
    if (inviteUrl) {
      navigator.clipboard?.writeText(inviteUrl);
      toast({ title: "Invite link copied!" });
    }
  };

  const handleShareInvite = async () => {
    if (inviteUrl && navigator.share) {
      try {
        await navigator.share({ title: "Join me on TAKE!", text: "Compare our restaurant rankings!", url: inviteUrl });
      } catch {
        handleCopyInvite();
      }
    } else {
      handleCopyInvite();
    }
  };

  const rankedRestaurants = useMemo(() =>
    userRanking
      .map(id => restaurants.find(r => r.id === id))
      .filter(Boolean) as typeof restaurants,
    [userRanking, restaurants]
  );

  const [leaderboardData, setLeaderboardData] = useState<{ id: string; score: number }[]>([]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (homeArea?.lat) params.set('lat', String(homeArea.lat));
      if (homeArea?.lng) params.set('lng', String(homeArea.lng));
      params.set('radius', '50');
      params.set('limit', '100');
      params.set('bucket', activeBucket);
      const res = await fetch(`/api/leaderboard?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLeaderboardData(data.results || []);
      }
    } catch (e) {
      console.error('Failed to fetch leaderboard for hot takes:', e);
    }
  }, [homeArea?.lat, homeArea?.lng, activeBucket]);

  useEffect(() => {
    if (isAuthenticated && serverDataLoaded && rankedRestaurants.length > 0) {
      fetchLeaderboard();
    }
  }, [isAuthenticated, serverDataLoaded, rankedRestaurants.length, fetchLeaderboard]);

  const hotTakes = useMemo(() => {
    if (leaderboardData.length === 0 || rankedRestaurants.length < 3) return [];

    const globalRankMap = new Map<string, number>();
    leaderboardData.forEach((entry, idx) => {
      globalRankMap.set(entry.id, idx + 1);
    });

    const takes: HotTake[] = [];
    rankedRestaurants.forEach((r, idx) => {
      const userRank = idx + 1;
      const globalRank = globalRankMap.get(r.id);
      if (globalRank === undefined) return;

      const diff = globalRank - userRank;
      const absDiff = Math.abs(diff);
      if (absDiff >= 3) {
        takes.push({
          restaurant: r,
          userRank,
          globalRank,
          globalScore: leaderboardData.find(e => e.id === r.id)?.score || 0,
          diff,
          direction: diff > 0 ? 'higher' : 'lower',
        });
      }
    });

    takes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    return takes.slice(0, 10);
  }, [rankedRestaurants, leaderboardData]);

  const genreSections = useMemo(() => {
    const sections: { tag: string; label: string; restaurants: Restaurant[] }[] = [];
    for (const [tag, label] of Object.entries(CUISINE_LABELS)) {
      const matching = rankedRestaurants.filter(r => matchesGenre(r, tag));
      if (matching.length >= 1) {
        sections.push({ tag, label, restaurants: matching });
      }
    }
    return sections;
  }, [rankedRestaurants]);

  const randomCategory = useMemo(() => {
    if (genreSections.length === 0) return null;
    return genreSections[randomCategoryIdx % genreSections.length];
  }, [genreSections, randomCategoryIdx]);

  const remainingCategories = useMemo(() => {
    if (!randomCategory) return genreSections;
    return genreSections.filter(s => s.tag !== randomCategory.tag);
  }, [genreSections, randomCategory]);

  if (!authLoading && !isAuthenticated) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <LogIn size={48} className="text-muted-foreground mb-4" />
          <h2 className="text-xl font-heading font-bold mb-2">Log in to see your TAKE</h2>
          <p className="text-muted-foreground mb-6 max-w-xs">Sign in to view and manage your personal restaurant rankings.</p>
          <Button onClick={() => openSignIn()} className="rounded-full px-8" data-testid="button-login-mylist">
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
      <div className="pt-12 pb-6 space-y-6">
        <header className="px-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-heading font-black text-foreground tracking-tighter uppercase leading-none" data-testid="text-my-list-heading">
                <span className="font-light">MY</span> TAKE
              </h1>
              <p className="text-muted-foreground text-sm font-medium mt-1">
                Your personal ranking
              </p>
            </div>
            <BucketToggle />
          </div>
        </header>

        <div className="px-6 space-y-3">
          <Button 
            className="w-full bg-foreground text-background hover:bg-foreground/90 h-12 rounded-xl text-base font-bold shadow-lg shadow-foreground/20"
            onClick={() => setLocation('/add')}
            data-testid="button-rank-new"
          >
            <Plus className="mr-2" strokeWidth={3} />
            Rank New Place
          </Button>

          {isAuthenticated && (
            <div className="flex items-center gap-2">
              {!inviteUrl ? (
                <Button
                  variant="outline"
                  className="w-full h-10 rounded-xl text-sm font-semibold border-border/60"
                  onClick={handleCreateInvite}
                  disabled={inviteLoading}
                  data-testid="button-mylist-invite"
                >
                  <UserPlus size={16} className="mr-2" />
                  {inviteLoading ? "Creating..." : "Invite Friends to Compare"}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="flex-1 h-10 rounded-xl text-sm font-semibold border-border/60"
                    onClick={handleCopyInvite}
                    data-testid="button-mylist-copy-invite"
                  >
                    <Copy size={14} className="mr-1.5" /> Copy Link
                  </Button>
                  <Button
                    className="flex-1 h-10 rounded-xl text-sm font-semibold"
                    onClick={handleShareInvite}
                    data-testid="button-mylist-share-invite"
                  >
                    <Share2 size={14} className="mr-1.5" /> Share
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {rankedRestaurants.length > 0 ? (
          <div className="space-y-6">
            <GenreSection
              title={activeBucket === 'bar' ? "Your top bars" : "Your top restaurants"}
              restaurants={rankedRestaurants.slice(0, 10)}
              setLocation={setLocation}
            />

            {hotTakes.length > 0 && (
              <HotTakesSection hotTakes={hotTakes} setLocation={setLocation} />
            )}

            {randomCategory && (
              <GenreSection
                title={`Your top ${randomCategory.label}`}
                restaurants={randomCategory.restaurants.slice(0, 10)}
                setLocation={setLocation}
                categoryLabel={randomCategory.label}
                genreTag={randomCategory.tag}
              />
            )}

            {remainingCategories.length > 0 && (
              <div className="px-6">
                <Button
                  variant="outline"
                  className="w-full h-11 rounded-xl text-sm font-semibold border-2"
                  onClick={() => setShowMoreCategories(!showMoreCategories)}
                  data-testid="button-more-categories"
                >
                  {showMoreCategories ? (
                    <>
                      <ChevronUp size={16} className="mr-2" />
                      Hide Categories
                    </>
                  ) : (
                    <>
                      <ChevronDown size={16} className="mr-2" />
                      More Categories ({remainingCategories.length})
                    </>
                  )}
                </Button>
              </div>
            )}

            <AnimatePresence>
              {showMoreCategories && remainingCategories.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="space-y-6 overflow-hidden"
                >
                  {remainingCategories.map(section => (
                    <motion.div
                      key={section.tag}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <GenreSection
                        title={`Your top ${section.label}`}
                        restaurants={section.restaurants.slice(0, 10)}
                        setLocation={setLocation}
                        categoryLabel={section.label}
                        genreTag={section.tag}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="px-6">
              <div className="flex items-center gap-2 mb-3">
                <Trophy size={18} className="text-amber-500" />
                <span className="text-sm font-bold text-muted-foreground">All {rankedRestaurants.length} ranked</span>
              </div>
              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {rankedRestaurants.map((restaurant, index) => (
                    <RestaurantCard 
                      key={restaurant!.id} 
                      restaurant={restaurant!} 
                      rank={index + 1}
                      compact
                      movement={rankingMovements[restaurant!.id] ?? null}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-6 text-center py-12 px-6 bg-secondary/30 rounded-3xl border-2 border-dashed border-border">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
              <Trophy size={32} />
            </div>
            <h3 className="text-xl font-bold mb-2" data-testid="text-empty-state">No rankings yet</h3>
            <p className="text-muted-foreground mb-6 text-sm">
              Start adding restaurants to build your personal ranking.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
