import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useParams } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Users, Trophy, Target, TrendingUp, TrendingDown } from "lucide-react";
import { useStore } from "@/lib/store";

interface Region {
  regionKey: string;
  label: string;
  sharedCount: number;
}

interface CompareItem {
  placeId: string;
  name: string;
  image: string | null;
  rankA: number;
  rankB: number;
}

interface DisagreementItem extends CompareItem {
  diff: number;
}

interface Top10Item {
  placeId: string;
  name: string;
  image: string | null;
  rank: number;
}

interface CompareData {
  otherUser: { id: string; name: string; profileImageUrl?: string | null };
  tasteOverlap: number | null;
  sharedCount: number;
  top10Overlap: number;
  agreements: { sharedFavorites: CompareItem[]; closestRanks: CompareItem[] };
  disagreements: DisagreementItem[];
  sideBySideTop10: { me: Top10Item[]; them: Top10Item[] };
}

export default function Compare() {
  const { userId } = useParams<{ userId: string }>();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const activeBucket = useStore(s => s.activeBucket);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);

  const { data: regions, isLoading: regionsLoading } = useQuery<Region[]>({
    queryKey: [`/api/compare/${userId}/regions`, activeBucket],
    queryFn: async () => {
      const res = await fetch(`/api/compare/${userId}/regions?bucket=${activeBucket}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load regions");
      const data = await res.json();
      return data.regions || [];
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (regions && regions.length > 0 && !selectedRegion) {
      setSelectedRegion(regions[0].regionKey);
    }
  }, [regions, selectedRegion]);

  useEffect(() => {
    setSelectedRegion(null);
  }, [activeBucket]);

  const { data: compareData, isLoading: compareLoading } = useQuery<CompareData>({
    queryKey: [`/api/compare/${userId}`, selectedRegion, activeBucket],
    queryFn: async () => {
      const res = await fetch(`/api/compare/${userId}?regionKey=${selectedRegion}&bucket=${activeBucket}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load comparison");
      return res.json();
    },
    enabled: !!userId && !!selectedRegion,
  });

  const friendName = compareData?.otherUser?.name || "Friend";
  const friendAvatar = compareData?.otherUser?.profileImageUrl;

  const getOverlapColor = (val: number | null | undefined) => {
    if (val == null) return "from-gray-500/20 to-gray-600/20";
    if (val >= 70) return "from-emerald-500/20 to-emerald-600/20";
    if (val >= 40) return "from-amber-500/20 to-amber-600/20";
    return "from-red-500/20 to-red-600/20";
  };

  const getOverlapTextColor = (val: number | null | undefined) => {
    if (val == null) return "text-gray-500";
    if (val >= 70) return "text-emerald-600";
    if (val >= 40) return "text-amber-600";
    return "text-red-600";
  };

  if (regionsLoading) {
    return (
      <Layout>
        <div className="p-6 pt-4 pb-24 max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Skeleton className="w-10 h-10 rounded-full" />
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="flex gap-2 mb-6">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-6">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!regions || regions.length === 0) {
    return (
      <Layout>
        <div className="p-6 pt-4 pb-24 max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => window.history.back()}
              data-testid="button-back"
            >
              <ArrowLeft size={20} />
            </Button>
            <span className="font-heading font-bold text-lg">Compare</span>
          </div>
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users size={48} className="text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium" data-testid="text-empty-state">
              Not enough shared places to compare yet
            </p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Both of you need to rank more restaurants in the same area
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 pt-4 pb-24 max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => window.history.back()}
            data-testid="button-back"
          >
            <ArrowLeft size={20} />
          </Button>
          {friendAvatar ? (
            <img
              src={friendAvatar}
              alt={friendName}
              className="w-8 h-8 rounded-full object-cover"
              data-testid="img-friend-avatar"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold" data-testid="img-friend-avatar">
              {friendName.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="font-heading font-bold text-lg truncate" data-testid="text-friend-name">
            {compareLoading ? <Skeleton className="h-5 w-24 inline-block" /> : friendName}
          </h1>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide" data-testid="region-selector">
          {regions.map((r) => (
            <button
              key={r.regionKey}
              onClick={() => setSelectedRegion(r.regionKey)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                selectedRegion === r.regionKey
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
              data-testid={`button-region-${r.regionKey}`}
            >
              {r.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                selectedRegion === r.regionKey
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted-foreground/10 text-muted-foreground"
              }`}>
                {r.sharedCount}
              </span>
            </button>
          ))}
        </div>

        {compareLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
            </div>
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        ) : compareData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2" data-testid="metrics-section">
              <div className={`bg-gradient-to-br ${getOverlapColor(compareData.tasteOverlap)} bg-card rounded-2xl border border-border/50 shadow-sm p-3 text-center`} data-testid="metric-taste-match">
                <Target size={16} className={`mx-auto mb-1 ${getOverlapTextColor(compareData.tasteOverlap)}`} />
                <div className={`text-2xl font-bold ${getOverlapTextColor(compareData.tasteOverlap)}`}>
                  {compareData.tasteOverlap != null ? `${compareData.tasteOverlap}%` : "?"}
                </div>
                <div className="text-[10px] text-muted-foreground font-medium">
                  {compareData.tasteOverlap != null ? "Taste Match" : "Need 7+ shared"}
                </div>
              </div>
              <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/20 bg-card rounded-2xl border border-border/50 shadow-sm p-3 text-center" data-testid="metric-shared-places">
                <Users size={16} className="mx-auto mb-1 text-blue-600" />
                <div className="text-2xl font-bold text-blue-600">{compareData.sharedCount}</div>
                <div className="text-[10px] text-muted-foreground font-medium">Shared Places</div>
              </div>
              <div className={`bg-gradient-to-br ${getOverlapColor(compareData.top10Overlap)} bg-card rounded-2xl border border-border/50 shadow-sm p-3 text-center`} data-testid="metric-top10-match">
                <Trophy size={16} className={`mx-auto mb-1 ${getOverlapTextColor(compareData.top10Overlap)}`} />
                <div className={`text-2xl font-bold ${getOverlapTextColor(compareData.top10Overlap)}`}>{compareData.top10Overlap}</div>
                <div className="text-[10px] text-muted-foreground font-medium">Top 10 Match</div>
              </div>
            </div>

            {(compareData.agreements?.sharedFavorites?.length > 0 || compareData.agreements?.closestRanks?.length > 0) && (
              <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden" data-testid="section-agreements">
                <div className="p-3 border-b border-border/50">
                  <h3 className="font-heading font-bold flex items-center gap-2 text-sm">
                    <TrendingUp size={16} className="text-emerald-500" />
                    Biggest Agreements
                  </h3>
                </div>
                <div className="divide-y divide-border/30">
                  {compareData.agreements?.sharedFavorites?.length > 0 && (
                    <div className="p-3">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Shared Favorites</p>
                      <div className="space-y-2">
                        {compareData.agreements.sharedFavorites.map((item) => (
                          <button
                            key={item.placeId}
                            className="flex items-center gap-3 w-full text-left hover:bg-muted/50 rounded-xl p-1.5 -mx-1.5 transition-colors"
                            onClick={() => setLocation(`/restaurant/${item.placeId}`)}
                            data-testid={`item-favorite-${item.placeId}`}
                          >
                            {item.image ? (
                              <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-secondary flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{item.name}</p>
                              <div className="flex gap-2 mt-0.5">
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">You: #{item.rankA}</span>
                                <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">Them: #{item.rankB}</span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {compareData.agreements?.closestRanks?.length > 0 && (
                    <div className="p-3">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Closest Ranks</p>
                      <div className="space-y-2">
                        {compareData.agreements.closestRanks.map((item) => (
                          <button
                            key={item.placeId}
                            className="flex items-center gap-3 w-full text-left hover:bg-muted/50 rounded-xl p-1.5 -mx-1.5 transition-colors"
                            onClick={() => setLocation(`/restaurant/${item.placeId}`)}
                            data-testid={`item-closest-${item.placeId}`}
                          >
                            {item.image ? (
                              <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-secondary flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{item.name}</p>
                              <div className="flex gap-2 mt-0.5">
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">You: #{item.rankA}</span>
                                <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">Them: #{item.rankB}</span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {compareData.disagreements?.length > 0 && (
              <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden" data-testid="section-disagreements">
                <div className="p-3 border-b border-border/50">
                  <h3 className="font-heading font-bold flex items-center gap-2 text-sm">
                    <TrendingDown size={16} className="text-red-500" />
                    Biggest Disagreements
                  </h3>
                </div>
                <div className="p-3 space-y-2">
                  {compareData.disagreements.map((item) => (
                    <button
                      key={item.placeId}
                      className="flex items-center gap-3 w-full text-left hover:bg-muted/50 rounded-xl p-1.5 -mx-1.5 transition-colors"
                      onClick={() => setLocation(`/restaurant/${item.placeId}`)}
                      data-testid={`item-disagreement-${item.placeId}`}
                    >
                      {item.image ? (
                        <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-secondary flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <div className="flex gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${item.rankA < item.rankB ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
                            You: #{item.rankA}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${item.rankB < item.rankA ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
                            Them: #{item.rankB}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-red-500 bg-red-500/10 px-2 py-1 rounded-full flex-shrink-0" data-testid={`badge-diff-${item.placeId}`}>
                        {item.diff > 0 ? `+${item.diff}` : item.diff}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(compareData.sideBySideTop10?.me?.length > 0 || compareData.sideBySideTop10?.them?.length > 0) && (
              <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden" data-testid="section-side-by-side">
                <div className="p-3 border-b border-border/50">
                  <h3 className="font-heading font-bold flex items-center gap-2 text-sm">
                    <Trophy size={16} className="text-primary" />
                    Side by Side Top 10
                  </h3>
                </div>
                <div className="grid grid-cols-2 divide-x divide-border/30">
                  <div className="p-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">You</p>
                    <div className="space-y-1.5">
                      {compareData.sideBySideTop10?.me?.map((item) => (
                        <button
                          key={item.placeId}
                          className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded-lg p-1 -mx-1 transition-colors"
                          onClick={() => setLocation(`/restaurant/${item.placeId}`)}
                          data-testid={`item-my-top10-${item.placeId}`}
                        >
                          <span className="text-[10px] font-bold text-muted-foreground w-4 text-right flex-shrink-0">{item.rank}</span>
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="w-7 h-7 rounded-md object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-md bg-secondary flex-shrink-0" />
                          )}
                          <p className="text-[11px] font-medium truncate">{item.name}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 truncate">{friendName}</p>
                    <div className="space-y-1.5">
                      {compareData.sideBySideTop10?.them?.map((item) => (
                        <button
                          key={item.placeId}
                          className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded-lg p-1 -mx-1 transition-colors"
                          onClick={() => setLocation(`/restaurant/${item.placeId}`)}
                          data-testid={`item-their-top10-${item.placeId}`}
                        >
                          <span className="text-[10px] font-bold text-muted-foreground w-4 text-right flex-shrink-0">{item.rank}</span>
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="w-7 h-7 rounded-md object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-md bg-secondary flex-shrink-0" />
                          )}
                          <p className="text-[11px] font-medium truncate">{item.name}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
