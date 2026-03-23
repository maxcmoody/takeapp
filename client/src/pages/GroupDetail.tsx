import Layout from "@/components/Layout";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, Copy, Loader2, LogOut, Trophy, Share2, Sparkles, UserPlus } from "lucide-react";
import { ConfidenceBadge } from "@/components/ScoreExplanation";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { getDisplayCategoryLabel } from "@shared/displayCategory";

const TAG_CHIPS = [
  { label: "Pizza", value: "pizza" },
  { label: "Burgers", value: "burgers" },
  { label: "Mexican", value: "mexican" },
  { label: "Seafood", value: "seafood" },
  { label: "BBQ", value: "bbq" },
  { label: "Italian", value: "italian" },
  { label: "Asian", value: "asian" },
  { label: "Breakfast", value: "breakfast" },
  { label: "Coffee", value: "coffee" },
];

interface GroupMember {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
}

interface GroupData {
  id: string;
  name: string;
  joinCode: string;
  createdByUserId: string;
  createdAt: string;
  members: GroupMember[];
}

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
  score: number;
  appearances: number;
  avgRank: number;
}

export default function GroupDetail() {
  const { id } = useParams();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const { data: group, isLoading: groupLoading, error: groupError } = useQuery<GroupData>({
    queryKey: ["/api/groups", id],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load group");
      return res.json();
    },
    enabled: isAuthenticated && !!id,
  });

  const leaderboardParams = new URLSearchParams();
  leaderboardParams.set("limit", "50");
  if (selectedTag) leaderboardParams.set("tag", selectedTag);

  const { data: leaderboardData, isLoading: lbLoading } = useQuery<{ results: LeaderboardEntry[] }>({
    queryKey: ["/api/groups", id, "leaderboard", selectedTag],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${id}/leaderboard?${leaderboardParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leaderboard");
      return res.json();
    },
    enabled: isAuthenticated && !!id,
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/groups/${id}/leave`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Left the group" });
      setLocation("/groups");
    },
    onError: () => {
      toast({ title: "Failed to leave group", variant: "destructive" });
    },
  });

  const entries = leaderboardData?.results ?? [];

  const handleCopyCode = () => {
    if (group?.joinCode) {
      navigator.clipboard.writeText(group.joinCode);
      toast({ title: "Join code copied!" });
    }
  };

  const handleShareInvite = async () => {
    if (!group) return;
    const shareText = `Join my group "${group.name}" on TAKE! Use code: ${group.joinCode}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${group.name} on TAKE`,
          text: shareText,
        });
      } catch (e) {
        navigator.clipboard.writeText(shareText);
        toast({ title: "Invite copied to clipboard!" });
      }
    } else {
      navigator.clipboard.writeText(shareText);
      toast({ title: "Invite copied to clipboard!" });
    }
  };

  if (groupLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </Layout>
    );
  }

  if (groupError || !group) {
    return (
      <Layout>
        <div className="p-6 pt-12 text-center">
          <h2 className="text-xl font-bold mb-2">Group not found</h2>
          <Button variant="link" onClick={() => setLocation("/groups")}>Back to Groups</Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="relative">
        <div className="bg-background sticky top-0 z-10 border-b border-border/50 backdrop-blur-md bg-background/90">
          <div className="p-4 flex items-center gap-3">
            <Button size="icon" variant="ghost" className="rounded-full -ml-2" onClick={() => setLocation("/groups")} data-testid="button-back">
              <ArrowLeft size={20} />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="font-heading font-bold text-lg leading-tight truncate" data-testid="text-group-name">{group.name}</h1>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users size={10} />
                <span>{group.members.length} {group.members.length === 1 ? 'member' : 'members'}</span>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs gap-1"
              onClick={() => leaveMutation.mutate()}
              disabled={leaveMutation.isPending}
              data-testid="button-leave-group"
            >
              <LogOut size={14} />
              Leave
            </Button>
          </div>
        </div>

        <div className="p-4 pb-24 space-y-5">
          <div className="bg-secondary/30 p-4 rounded-xl border border-border/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Invite Friends</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleCopyCode} data-testid="button-copy-code">
                  <Copy size={12} />
                  Copy
                </Button>
                <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleShareInvite} data-testid="button-share-invite">
                  <Share2 size={12} />
                  Share
                </Button>
              </div>
            </div>
            <div className="text-2xl font-mono font-bold tracking-[0.3em] text-center py-2" data-testid="text-join-code">
              {group.joinCode}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-1">Share this code so friends can join your group</p>
          </div>

          <div>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Members</h3>
            <div className="flex flex-wrap gap-2">
              {group.members.map(m => (
                <div
                  key={m.userId}
                  className="flex items-center gap-1.5 bg-secondary/50 px-3 py-1.5 rounded-full text-sm"
                  data-testid={`badge-member-${m.userId}`}
                >
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                    {(m.displayName || '?')[0].toUpperCase()}
                  </div>
                  <span className="font-medium">{m.displayName || 'User'}</span>
                  {m.role === 'owner' && (
                    <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-bold">Owner</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-heading font-bold text-lg mb-3 flex items-center gap-2">
              <Trophy size={18} className="text-primary" />
              Group Rankings
            </h3>

            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1 scrollbar-none">
              <button
                onClick={() => setSelectedTag(null)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  selectedTag === null
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                }`}
                data-testid="chip-tag-all"
              >
                All
              </button>
              {TAG_CHIPS.map(tag => (
                <button
                  key={tag.value}
                  onClick={() => setSelectedTag(selectedTag === tag.value ? null : tag.value)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                    selectedTag === tag.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                  }`}
                  data-testid={`chip-tag-${tag.value}`}
                >
                  {tag.label}
                </button>
              ))}
            </div>

            {group.members.length < 2 && (
              <div className="mb-4 p-5 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 text-center">
                <Sparkles size={28} className="mx-auto text-primary mb-2" />
                <h3 className="font-heading font-bold text-base mb-1">Invite friends to build your group TAKE</h3>
                <p className="text-sm text-muted-foreground mb-3">Share the code below so friends can join and combine rankings.</p>
                <Button size="sm" className="gap-1.5" onClick={handleShareInvite} data-testid="button-hero-share">
                  <UserPlus size={14} />
                  Share Invite
                </Button>
              </div>
            )}

            {lbLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-primary" size={20} />
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                <p className="font-medium">No rankings yet{selectedTag ? ` for ${selectedTag}` : ''}</p>
                <p className="text-xs mt-1">{group.members.length < 2 ? 'Invite friends and start ranking!' : 'Members need to rank restaurants first!'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((entry, index) => {
                  const takeScore = entry.score;
                  const displayCategory = getDisplayCategoryLabel(entry.googleTypes, entry.googlePrimaryType, entry.category);

                  return (
                    <div
                      key={entry.id}
                      className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                      onClick={() => setLocation(`/restaurant/${entry.id}`)}
                      data-testid={`card-leaderboard-${entry.id}`}
                    >
                      <div className="flex items-center gap-3 p-3">
                        <div className="flex-shrink-0 w-8 text-center">
                          {index < 3 ? (
                            <span className="text-lg">
                              {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                            </span>
                          ) : (
                            <span className="text-sm font-bold text-muted-foreground">#{index + 1}</span>
                          )}
                        </div>

                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-secondary flex-shrink-0">
                          {entry.image ? (
                            <img
                              src={entry.image.startsWith('http') ? `/api/places/photo?ref=${encodeURIComponent(entry.image)}&maxWidth=100` : (entry.image.includes('/api/places/photo') && entry.googlePlaceId && !entry.image.includes('placeId=') ? `${entry.image}${entry.image.includes('?') ? '&' : '?'}placeId=${encodeURIComponent(entry.googlePlaceId)}` : entry.image)}
                              alt={entry.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-lg">
                              🍽️
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-sm truncate" data-testid={`text-restaurant-name-${entry.id}`}>{entry.name}</h4>
                          <p className="text-xs text-muted-foreground truncate">{displayCategory}</p>
                        </div>

                        <div className="flex-shrink-0 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-lg font-extrabold text-primary" data-testid={`text-score-${entry.id}`}>{takeScore}</span>
                            <ConfidenceBadge appearances={entry.appearances} />
                          </div>
                          <div className="text-[10px] text-muted-foreground font-medium" data-testid={`text-appearances-${entry.id}`}>In {entry.appearances} {entry.appearances === 1 ? 'TAKE' : 'TAKES'}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
