import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { User, LogOut, LogIn, Heart, MapPin, Share2, Instagram, SlidersHorizontal, Users, ChevronRight, Mail, Edit2, Shield, FileText, Lock, Trash2, AlertTriangle, Download, Clock, CheckCircle2, UserPlus, Link2, Copy, Eye } from "lucide-react";
import { useStore } from "@/lib/store";
import { useRef, useState, useEffect } from "react";
import * as htmlToImage from "html-to-image";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useClerk } from "@clerk/clerk-react";
import { useLocation } from "wouter";
import { trackEvent } from "@/lib/analytics";
import * as Sentry from "@sentry/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function Profile() {
  const { userRanking, restaurants, homeArea, chainBias, setChainBias } = useStore();
  // homeArea used for display only; editing moved to EditProfile page
  const collageRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();
  const { user, isLoading: authLoading, isAuthenticated, logout } = useAuth();
  const { openSignIn } = useClerk();
  const [_, setLocation] = useLocation();

  const [appVersion, setAppVersion] = useState<string>("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [deletionRequest, setDeletionRequest] = useState<{ status: string; createdAt: string; resolvedAt?: string | null } | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const queryClient = useQueryClient();

  const { data: followsData } = useQuery<{ following: any[]; followers: any[] }>({
    queryKey: ["/api/follows"],
    queryFn: async () => {
      const r = await fetch("/api/follows", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: isAuthenticated,
    staleTime: 10000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    fetch("/api/version").then(r => r.json()).then(d => setAppVersion(d.version || "")).catch(() => {});
    if (isAuthenticated) {
      fetch("/api/admin/check", { credentials: "include" }).then(r => r.json()).then(d => setIsAdminUser(d.isAdmin === true)).catch(() => {});
      fetch("/api/account-deletion-request/mine", { credentials: "include" })
        .then(r => r.json())
        .then(d => { if (d.request) setDeletionRequest(d.request); })
        .catch(() => {});
    }
  }, [isAuthenticated]);

  const handleCreateInvite = async () => {
    setInviteLoading(true);
    try {
      const r = await fetch("/api/invites", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      const data = await r.json();
      setInviteUrl(data.url);
      trackEvent({ event: "invite_created" });
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
      } catch {}
    } else {
      handleCopyInvite();
    }
  };

  const handleUnfollow = async (userId: string) => {
    try {
      await fetch(`/api/follows/${userId}`, { method: "DELETE", credentials: "include" });
      queryClient.invalidateQueries({ queryKey: ["/api/follows"] });
      toast({ title: "Unfollowed" });
    } catch {
      toast({ title: "Failed to unfollow", variant: "destructive" });
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const r = await fetch("/api/export", { credentials: "include" });
      if (!r.ok) throw new Error("Export failed");
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().split("T")[0];
      a.download = `take-export-${date}.json`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      trackEvent({ event: "data_export" });
      toast({ title: "Export downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const rankedRestaurants = userRanking
    .map(id => restaurants.find(r => r.id === id))
    .filter(Boolean) as typeof restaurants;
  
  const top9 = rankedRestaurants.slice(0, 9);
  const paddedTop9 = [...top9, ...Array(9 - top9.length).fill(null)].slice(0, 9);

  const handleDownload = async () => {
    if (!collageRef.current) return;
    
    setIsGenerating(true);
    try {
      const dataUrl = await htmlToImage.toPng(collageRef.current, {
        quality: 0.95,
        backgroundColor: '#fff',
        pixelRatio: 2,
      });
      
      const link = document.createElement('a');
      link.download = 'my-take-top-9.png';
      link.href = dataUrl;
      link.click();
      trackEvent({ event: "share_top9" });

      if (navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'my-take.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'My Top 9 Restaurants on TAKE',
                text: 'Check out my top ranked restaurants on TAKE! what\'s yours?'
            });
        }
      }
    } catch (error) {
      console.error('oops, something went wrong!', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const displayName = isAuthenticated && user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Foodie Fanatic'
    : 'Foodie Fanatic';

  const profileImage = isAuthenticated && user?.profileImageUrl;

  return (
    <Layout>
      <div className="p-6 pt-12 pb-24">
        <div className="flex flex-col items-center mb-6">
            {profileImage ? (
              <img 
                src={profileImage} 
                alt={displayName}
                className="w-24 h-24 rounded-full object-cover mb-4 border-4 border-background shadow-xl"
              />
            ) : (
              <div className="w-24 h-24 bg-secondary rounded-full flex items-center justify-center text-4xl mb-4 border-4 border-background shadow-xl">
                  {isAuthenticated ? displayName.charAt(0).toUpperCase() : '😎'}
              </div>
            )}
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-heading font-bold" data-testid="text-username">{displayName}</h1>
              {isAdminUser && (
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full" data-testid="badge-admin">Admin</span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">{homeArea?.label || "Set your home area"}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 rounded-full"
              onClick={() => setLocation('/edit-profile')}
              data-testid="button-edit-profile"
            >
              <Edit2 size={14} className="mr-1.5" />
              Edit Profile
            </Button>
        </div>

        {!isAuthenticated && (
          <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm mb-6">
            <div className="p-4 border-b border-border/50">
              <h3 className="font-heading font-bold flex items-center gap-2">
                <LogIn size={18} className="text-primary" />
                Sign In
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Sign in to save your rankings across devices</p>
            </div>
            <div className="p-4 space-y-2">
              <Button
                className="w-full h-11 font-semibold rounded-xl"
                onClick={() => { openSignIn(); }}
                data-testid="button-sign-in"
              >
                <Mail size={16} className="mr-2" />
                Sign in with Email or Google
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                Supports Google, GitHub, email, and more
              </p>
            </div>
          </div>
        )}

        <Button 
          variant="outline" 
          className="w-full justify-start h-12 text-base font-medium mb-3" 
          onClick={() => setLocation('/groups')}
          data-testid="button-groups"
        >
            <Users className="mr-3" size={18} />
            Groups
            <ChevronRight size={16} className="ml-auto text-muted-foreground" />
        </Button>

        {isAuthenticated && (
          <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm mb-6">
            <div className="p-4 border-b border-border/50 flex items-center justify-between">
              <h3 className="font-heading font-bold flex items-center gap-2">
                <UserPlus size={18} className="text-primary" />
                Friends
              </h3>
              {!inviteUrl ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full text-xs h-8"
                  onClick={handleCreateInvite}
                  disabled={inviteLoading}
                  data-testid="button-create-invite"
                >
                  <Link2 size={14} className="mr-1" />
                  {inviteLoading ? "Creating..." : "Invite"}
                </Button>
              ) : (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="rounded-full text-xs h-8" onClick={handleCopyInvite} data-testid="button-copy-invite">
                    <Copy size={14} className="mr-1" /> Copy
                  </Button>
                  <Button size="sm" className="rounded-full text-xs h-8" onClick={handleShareInvite} data-testid="button-share-invite">
                    <Share2 size={14} className="mr-1" /> Share
                  </Button>
                </div>
              )}
            </div>

            {inviteUrl && (
              <div className="px-4 py-2 bg-primary/5 border-b border-border/50">
                <p className="text-[11px] text-muted-foreground truncate font-mono" data-testid="text-invite-url">{inviteUrl}</p>
              </div>
            )}

            {followsData && (followsData.following.length > 0 || followsData.followers.length > 0) ? (
              <div className="divide-y divide-border/30">
                {followsData.following.length > 0 && (
                  <div className="p-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                      <Eye size={12} /> Following ({followsData.following.length})
                    </p>
                    <div className="space-y-2">
                      {followsData.following.map((u: any) => (
                        <div key={u.id} className="flex items-center gap-3" data-testid={`row-following-${u.id}`}>
                          {u.profileImageUrl ? (
                            <img src={u.profileImageUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">
                              {(u.firstName || '?').charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm font-medium flex-1">{[u.firstName, u.lastName].filter(Boolean).join(' ') || 'User'}</span>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs rounded-full px-3"
                            onClick={() => setLocation(`/compare/${u.id}`)}
                            data-testid={`button-compare-${u.id}`}
                          >
                            Compare
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground px-2"
                            onClick={() => handleUnfollow(u.id)}
                            data-testid={`button-unfollow-${u.id}`}
                          >
                            Unfollow
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {followsData.followers.length > 0 && (
                  <div className="p-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Followers ({followsData.followers.length})</p>
                    <div className="space-y-2">
                      {followsData.followers.map((u: any) => (
                        <div key={u.id} className="flex items-center gap-3" data-testid={`row-follower-${u.id}`}>
                          {u.profileImageUrl ? (
                            <img src={u.profileImageUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">
                              {(u.firstName || '?').charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm font-medium flex-1">{[u.firstName, u.lastName].filter(Boolean).join(' ') || 'User'}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs rounded-full px-3"
                            onClick={() => setLocation(`/compare/${u.id}`)}
                            data-testid={`button-compare-follower-${u.id}`}
                          >
                            Compare
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-sm text-muted-foreground">Share your invite link to connect with friends and compare taste!</p>
              </div>
            )}
          </div>
        )}

        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm mb-6">
            <div className="p-4 border-b border-border/50">
                <h3 className="font-heading font-bold flex items-center gap-2">
                    <Share2 size={18} className="text-primary" />
                    Share Your Top 9
                </h3>
            </div>
            
            <div className="p-4 bg-muted/30 flex flex-col items-center gap-4">
                <div 
                    ref={collageRef}
                    className="w-full aspect-square bg-background rounded-xl overflow-hidden shadow-lg border border-border flex flex-col relative"
                >
                    <div className="absolute top-0 left-0 right-0 bg-background/90 backdrop-blur-sm px-3 py-2 z-20 border-b border-border/50 flex justify-between items-center">
                        <h2 className="text-sm font-heading font-black tracking-tighter uppercase leading-none">
                          <span className="font-light">MY</span> TAKE <span className="text-primary text-[10px] font-bold tracking-widest ml-1">what's yours?</span>
                        </h2>
                    </div>

                    <div className="grid grid-cols-3 grid-rows-3 h-full w-full">
                        {paddedTop9.map((item, i) => (
                            <div key={i} className="relative border-[0.5px] border-white/20 overflow-hidden group bg-muted">
                                {item ? (
                                    <>
                                        <img 
                                            src={item.image} 
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

                <Button onClick={handleDownload} disabled={isGenerating} className="w-full shadow-lg shadow-primary/20">
                    {isGenerating ? 'Generating...' : (
                        <>
                            <Instagram size={18} className="mr-2" />
                            Share to Story
                        </>
                    )}
                </Button>
                <p className="text-xs text-muted-foreground text-center px-4">
                    Generates an image you can save or share to Instagram, Twitter, etc.
                </p>
            </div>
        </div>

        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm mb-6">
            <div className="p-4 border-b border-border/50">
                <h3 className="font-heading font-bold flex items-center gap-2">
                    <SlidersHorizontal size={18} className="text-primary" />
                    Discovery Preferences
                </h3>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">Show fewer chain restaurants</label>
                <div className="flex gap-2">
                  {([
                    { value: 'off' as const, label: 'Off' },
                    { value: 'auto' as const, label: 'Default' },
                    { value: 'strong' as const, label: 'Strong' },
                  ]).map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setChainBias(option.value);
                        toast({ title: "Preference updated", description: `Chain filter set to ${option.label}` });
                      }}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border",
                        chainBias === option.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary border-border hover:bg-secondary/80"
                      )}
                      data-testid={`button-chain-bias-${option.value}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  As you rank more places, we gradually show fewer obvious chains. Set to "Strong" for more local spots, or "Off" to see everything.
                </p>
              </div>
            </div>
        </div>

        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm mb-6">
            <div className="p-4 border-b border-border/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-lg text-primary">
                        <Heart size={20} />
                    </div>
                    <span className="font-medium">Ranked Places</span>
                </div>
                <span className="font-bold text-lg" data-testid="text-ranked-count">{userRanking.length}</span>
            </div>
            <div className="p-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-500/10 p-2 rounded-lg text-blue-500">
                        <MapPin size={20} />
                    </div>
                    <span className="font-medium">Home Area</span>
                </div>
                <span className="font-medium text-sm text-muted-foreground">{homeArea?.label || "Not set"}</span>
            </div>
        </div>

        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm mb-6">
          <Button variant="ghost" className="w-full justify-start h-12 text-sm font-medium border-b border-border/30 rounded-none" onClick={() => setLocation("/privacy")} data-testid="button-privacy">
            <Lock className="mr-3" size={16} /> Privacy Policy <ChevronRight size={14} className="ml-auto text-muted-foreground" />
          </Button>
          <Button variant="ghost" className="w-full justify-start h-12 text-sm font-medium border-b border-border/30 rounded-none" onClick={() => setLocation("/terms")} data-testid="button-terms">
            <FileText className="mr-3" size={16} /> Terms of Service <ChevronRight size={14} className="ml-auto text-muted-foreground" />
          </Button>
          {isAdminUser && (
            <>
              <Button variant="ghost" className="w-full justify-start h-12 text-sm font-medium border-b border-border/30 rounded-none" onClick={() => setLocation("/admin")} data-testid="button-admin">
                <Shield className="mr-3" size={16} /> Admin <ChevronRight size={14} className="ml-auto text-muted-foreground" />
              </Button>
              <Button variant="ghost" className="w-full justify-start h-12 text-sm font-medium rounded-none" onClick={() => setLocation("/release")} data-testid="button-release-checklist">
                <CheckCircle2 className="mr-3" size={16} /> Release Checklist <ChevronRight size={14} className="ml-auto text-muted-foreground" />
              </Button>
            </>
          )}
        </div>

        {isAuthenticated && (
          <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm mb-6">
            <Button
              variant="ghost"
              className="w-full justify-start h-12 text-sm font-medium rounded-none"
              onClick={handleExport}
              disabled={exportLoading}
              data-testid="button-export-data"
            >
              <Download className="mr-3" size={16} /> {exportLoading ? "Exporting..." : "Export My Data"} <ChevronRight size={14} className="ml-auto text-muted-foreground" />
            </Button>
          </div>
        )}

        <div className="space-y-2">
            {isAuthenticated ? (
              <>
                {deletionRequest?.status === "open" ? (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30 rounded-xl p-4 space-y-1" data-testid="text-deletion-pending">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-amber-600" />
                      <span className="text-sm font-medium text-amber-800 dark:text-amber-400">Deletion Requested (Pending)</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">Submitted {new Date(deletionRequest.createdAt).toLocaleDateString()}</p>
                  </div>
                ) : deletionRequest?.status === "completed" ? (
                  <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/30 rounded-xl p-4 space-y-1" data-testid="text-deletion-completed">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-green-600" />
                      <span className="text-sm font-medium text-green-800 dark:text-green-400">Deletion Completed</span>
                    </div>
                    {deletionRequest.resolvedAt && <p className="text-xs text-muted-foreground pl-6">Completed {new Date(deletionRequest.resolvedAt).toLocaleDateString()}</p>}
                  </div>
                ) : !showDeleteConfirm ? (
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-12 text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setShowDeleteConfirm(true)}
                    data-testid="button-request-deletion"
                  >
                    <Trash2 className="mr-3" size={16} />
                    Request Data Deletion
                  </Button>
                ) : (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="text-destructive mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-muted-foreground">This will submit a request to delete your personal data. Your aggregated rankings will be preserved anonymously.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 rounded-lg" onClick={() => setShowDeleteConfirm(false)} data-testid="button-cancel-deletion">Cancel</Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex-1 rounded-lg"
                        disabled={deleteSubmitting}
                        onClick={async () => {
                          setDeleteSubmitting(true);
                          try {
                            const r = await fetch("/api/account-deletion-request", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
                            if (r.ok) {
                              const data = await r.json();
                              setDeletionRequest(data);
                              toast({ title: "Request submitted", description: "Your data deletion request has been received" });
                              setShowDeleteConfirm(false);
                            } else {
                              toast({ title: "Failed to submit request", variant: "destructive" });
                            }
                          } catch {
                            toast({ title: "Failed to submit request", variant: "destructive" });
                          } finally {
                            setDeleteSubmitting(false);
                          }
                        }}
                        data-testid="button-confirm-deletion"
                      >
                        {deleteSubmitting ? "Submitting..." : "Confirm Deletion Request"}
                      </Button>
                    </div>
                  </div>
                )}
                <Button 
                  variant="ghost" 
                  className="w-full justify-start h-12 text-base font-medium text-destructive hover:text-destructive hover:bg-destructive/10" 
                  onClick={() => logout()}
                  data-testid="button-sign-out"
                >
                    <LogOut className="mr-3" size={18} />
                    Sign Out
                </Button>
              </>
            ) : (
              <Button 
                variant="ghost" 
                className="w-full justify-start h-12 text-base font-medium text-primary hover:text-primary hover:bg-primary/10"
                onClick={() => { openSignIn(); }}
                data-testid="button-sign-in-bottom"
              >
                  <LogIn className="mr-3" size={18} />
                  Sign In
              </Button>
            )}
        </div>

        {appVersion && (
          <p
            className="text-[10px] text-muted-foreground/40 text-center mt-6 cursor-pointer select-all"
            onClick={() => { navigator.clipboard?.writeText(appVersion); toast({ title: "Copied version" }); }}
            data-testid="text-app-version"
          >
            {appVersion}
          </p>
        )}

        {Sentry.getClient() && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 text-[10px] text-muted-foreground/50 h-7"
            onClick={async () => {
              Sentry.captureMessage("TAKE frontend test");
              try {
                const r = await fetch("/api/sentry-test", { credentials: "include" });
                if (r.ok) {
                  toast({ title: "Sentry test sent", description: "Events sent to both client and server" });
                } else {
                  toast({ title: "Frontend sent", description: "Backend test failed (auth required)", variant: "destructive" });
                }
              } catch {
                toast({ title: "Frontend sent", description: "Backend test failed", variant: "destructive" });
              }
            }}
            data-testid="button-sentry-test"
          >
            Send Sentry Test
          </Button>
        )}
      </div>
    </Layout>
  );
}
