import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, MapPin, Check, Camera, AlertTriangle, User, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

const PRESET_AREAS = [
  { label: "Chattanooga, TN", lat: 35.0456, lng: -85.3097 },
  { label: "Nashville, TN", lat: 36.1627, lng: -86.7816 },
  { label: "Atlanta, GA", lat: 33.7490, lng: -84.3880 },
  { label: "Knoxville, TN", lat: 35.9606, lng: -83.9207 },
  { label: "Birmingham, AL", lat: 33.5207, lng: -86.8025 },
  { label: "Memphis, TN", lat: 35.1495, lng: -90.0490 },
  { label: "Charlotte, NC", lat: 35.2271, lng: -80.8431 },
  { label: "New York, NY", lat: 40.7128, lng: -74.0060 },
  { label: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
  { label: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
];

export default function EditProfile() {
  const { homeArea, setHomeArea, resetRanking, userRanking } = useStore();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [_, setLocation] = useLocation();
  const [customArea, setCustomArea] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ description: string; place_id: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameInitialized, setNameInitialized] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user && !nameInitialized) {
      setEditFirstName(user.firstName || "");
      setEditLastName(user.lastName || "");
      setNameInitialized(true);
    }
  }, [user, nameInitialized]);

  const nameChanged = isAuthenticated && user && (
    (editFirstName.trim() !== (user.firstName || "")) ||
    (editLastName.trim() !== (user.lastName || ""))
  );

  const handleSaveName = async () => {
    if (!nameChanged || savingName) return;
    setSavingName(true);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ firstName: editFirstName.trim(), lastName: editLastName.trim() }),
      });
      if (!res.ok) throw new Error("Failed to save");
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Name updated", description: "Your display name has been saved." });
    } catch {
      toast({ title: "Error", description: "Could not save your name. Please try again.", variant: "destructive" });
    } finally {
      setSavingName(false);
    }
  };

  const fetchSuggestions = useCallback(async (input: string) => {
    if (input.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    try {
      const res = await fetch(`/api/places/area-autocomplete?input=${encodeURIComponent(input.trim())}`);
      const data = await res.json();
      if (data.predictions?.length > 0) {
        setSuggestions(data.predictions.map((p: any) => ({ description: p.description, place_id: p.place_id })));
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  const handleCustomAreaInput = (value: string) => {
    setCustomArea(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  const handleSelectSuggestion = async (suggestion: { description: string; place_id: string }) => {
    setCustomArea(suggestion.description);
    setShowSuggestions(false);
    setSuggestions([]);
    try {
      const detailRes = await fetch(`/api/places/details?place_id=${suggestion.place_id}`);
      const detailData = await detailRes.json();
      if (detailData.result?.geometry?.location) {
        const { lat, lng } = detailData.result.geometry.location;
        setHomeArea({ label: suggestion.description, lat, lng });
        setCustomArea("");
        toast({ title: "Home area updated", description: `Set to ${suggestion.description}` });
        return;
      }
    } catch (e) {
      console.error("Geocode failed:", e);
    }
    setHomeArea({ label: suggestion.description, lat: homeArea?.lat || 35.0456, lng: homeArea?.lng || -85.3097 });
    setCustomArea("");
    toast({ title: "Home area updated", description: `Set to ${suggestion.description} (approximate location)` });
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayName = isAuthenticated && user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Foodie Fanatic'
    : 'Foodie Fanatic';

  const profileImage = isAuthenticated && user?.profileImageUrl;

  const handleSelectPreset = (preset: typeof PRESET_AREAS[0]) => {
    setHomeArea(preset);
    toast({ title: "Home area updated", description: `Set to ${preset.label}` });
  };

  const handleCustomArea = async () => {
    if (!customArea.trim()) return;
    try {
      const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(customArea.trim())}`);
      const data = await res.json();
      if (data.predictions?.length > 0) {
        const placeId = data.predictions[0].place_id;
        const detailRes = await fetch(`/api/places/details?place_id=${placeId}`);
        const detailData = await detailRes.json();
        if (detailData.result?.geometry?.location) {
          const { lat, lng } = detailData.result.geometry.location;
          setHomeArea({ label: customArea.trim(), lat, lng });
          setCustomArea("");
          toast({ title: "Home area updated", description: `Set to ${customArea.trim()}` });
          return;
        }
      }
    } catch (e) {
      console.error("Geocode failed:", e);
    }
    setHomeArea({ label: customArea.trim(), lat: homeArea?.lat || 35.0456, lng: homeArea?.lng || -85.3097 });
    setCustomArea("");
    toast({ title: "Home area updated", description: `Set to ${customArea.trim()} (approximate location)` });
  };

  return (
    <Layout>
      <div className="p-6 pt-12 pb-24">
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => setLocation('/profile')}
            className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors"
            data-testid="button-back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-heading font-bold" data-testid="text-edit-profile-heading">Edit Profile</h1>
        </div>

        <div className="flex flex-col items-center mb-8">
          <div className="relative">
            {profileImage ? (
              <img 
                src={profileImage} 
                alt={displayName}
                className="w-24 h-24 rounded-full object-cover border-4 border-background shadow-xl"
              />
            ) : (
              <div className="w-24 h-24 bg-secondary rounded-full flex items-center justify-center text-4xl border-4 border-background shadow-xl">
                  {isAuthenticated ? displayName.charAt(0).toUpperCase() : '😎'}
              </div>
            )}
            <button
              className="absolute bottom-0 right-0 w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground shadow-lg border-2 border-background"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-change-photo"
            >
              <Camera size={14} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                toast({ title: "Profile pictures", description: "Sign in to change your profile picture via your account settings" });
              }}
              data-testid="input-profile-photo"
            />
          </div>
          <h2 className="text-lg font-bold mt-3" data-testid="text-display-name">{displayName}</h2>
        </div>

        {isAuthenticated && (
          <div className="bg-card rounded-2xl border border-border/50 shadow-sm mb-6 overflow-visible">
            <div className="p-4 border-b border-border/50 rounded-t-2xl">
              <h3 className="font-heading font-bold flex items-center gap-2">
                <User size={18} className="text-primary" />
                Display Name
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                This is how your friends will see you in rankings and comparisons.
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">First name</label>
                <Input
                  placeholder="First name"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  className="h-10 rounded-lg"
                  maxLength={100}
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Last name</label>
                <Input
                  placeholder="Last name"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  className="h-10 rounded-lg"
                  maxLength={100}
                  data-testid="input-last-name"
                />
              </div>
              {nameChanged && (
                <Button
                  className="w-full h-10 rounded-lg font-bold"
                  onClick={handleSaveName}
                  disabled={savingName}
                  data-testid="button-save-name"
                >
                  {savingName ? <><Loader2 size={16} className="animate-spin mr-2" /> Saving...</> : "Save Name"}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="bg-card rounded-2xl border border-border/50 shadow-sm mb-6 overflow-visible">
            <div className="p-4 border-b border-border/50 rounded-t-2xl">
                <h3 className="font-heading font-bold flex items-center gap-2">
                    <MapPin size={18} className="text-primary" />
                    Home Area
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  This determines which restaurants appear on your Home feed and leaderboards.
                </p>
            </div>
            
            <div className="p-4 space-y-4">
              {homeArea && (
                <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-xl border border-primary/20">
                  <MapPin size={16} className="text-primary flex-shrink-0" />
                  <span className="font-medium text-sm" data-testid="text-current-area">{homeArea.label}</span>
                  <Check size={16} className="text-primary ml-auto flex-shrink-0" />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Quick select</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_AREAS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => handleSelectPreset(preset)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border",
                        homeArea?.label === preset.label
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary border-border hover:bg-secondary/80"
                      )}
                      data-testid={`button-preset-${preset.label}`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2" ref={suggestionsRef}>
                <label className="text-sm font-medium text-muted-foreground">Custom location</label>
                <div className="relative">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type a city name..."
                      value={customArea}
                      onChange={(e) => handleCustomAreaInput(e.target.value)}
                      onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomArea()}
                      className="flex-1 h-10 rounded-lg"
                      data-testid="input-custom-area"
                    />
                    <Button size="sm" className="h-10 px-3" onClick={handleCustomArea} disabled={!customArea.trim()} data-testid="button-set-custom-area">
                      <Check size={16} />
                    </Button>
                  </div>
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                      {suggestions.map((s, i) => (
                        <button
                          key={s.place_id}
                          onClick={() => handleSelectSuggestion(s)}
                          className={cn(
                            "w-full text-left px-3 py-2.5 text-sm hover:bg-primary/10 transition-colors flex items-center gap-2",
                            i > 0 && "border-t border-border/50"
                          )}
                          data-testid={`suggestion-${i}`}
                        >
                          <MapPin size={14} className="text-muted-foreground flex-shrink-0" />
                          <span>{s.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {loadingSuggestions && customArea.trim().length >= 2 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-50 p-3 text-center text-xs text-muted-foreground">
                      Searching...
                    </div>
                  )}
                </div>
              </div>
            </div>
        </div>

        {isAuthenticated && userRanking.length > 0 && (
          <div className="bg-card rounded-2xl border border-destructive/20 overflow-hidden shadow-sm mb-6">
            <div className="p-4">
              <h3 className="font-heading font-bold flex items-center gap-2 text-destructive">
                <AlertTriangle size={18} />
                Danger Zone
              </h3>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                This will permanently delete all your rankings.
              </p>
              <Button
                variant="outline"
                className="w-full h-10 border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => setShowResetConfirm(true)}
                data-testid="button-reset-rankings"
              >
                Reset My Rankings
              </Button>
            </div>
          </div>
        )}

        {showResetConfirm && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setShowResetConfirm(false)}>
            <div className="bg-background rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-heading font-bold mb-2">Are you sure you want to reset rankings?</h3>
              <p className="text-sm text-muted-foreground mb-6">
                This will permanently remove all {userRanking.length} ranked restaurants from your list. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowResetConfirm(false)}
                  data-testid="button-cancel-reset"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    resetRanking();
                    setShowResetConfirm(false);
                    toast({ title: "Rankings reset", description: "All your rankings have been cleared." });
                  }}
                  data-testid="button-confirm-reset"
                >
                  Reset All
                </Button>
              </div>
            </div>
          </div>
        )}

        <Button
          className="w-full h-12 rounded-xl text-base font-bold"
          onClick={() => setLocation('/profile')}
          data-testid="button-done"
        >
          Done
        </Button>
      </div>
    </Layout>
  );
}
