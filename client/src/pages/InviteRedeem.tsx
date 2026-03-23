import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useParams } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus, Check, AlertCircle } from "lucide-react";

interface Inviter {
  id: string;
  name: string;
  profileImageUrl?: string | null;
}

export default function InviteRedeem() {
  const { code } = useParams<{ code: string }>();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [inviter, setInviter] = useState<Inviter | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (authLoading || !code) return;

    if (!isAuthenticated) return;

    const pending = sessionStorage.getItem("pendingInviteCode");
    if (pending && pending === code) {
      sessionStorage.removeItem("pendingInviteCode");
    }

    if (status !== "idle") return;

    setStatus("loading");
    fetch("/api/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setStatus("error");
          setErrorMessage(data.message || data.error || "Failed to redeem invite");
          return;
        }
        setInviter(data.inviter);
        setStatus("success");
      })
      .catch(() => {
        setStatus("error");
        setErrorMessage("Something went wrong. Please try again.");
      });
  }, [authLoading, isAuthenticated, code, status]);

  const handleSignIn = () => {
    if (code) {
      sessionStorage.setItem("pendingInviteCode", code);
    }
    window.location.href = "/api/login";
  };

  return (
    <Layout>
      <div className="p-6 pt-16 pb-24 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-full max-w-md">
          {authLoading ? (
            <div className="bg-card rounded-2xl border border-border/50 p-8 shadow-sm text-center animate-pulse">
              <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-4" />
              <div className="h-4 bg-muted rounded w-3/4 mx-auto mb-2" />
              <div className="h-3 bg-muted rounded w-1/2 mx-auto" />
            </div>
          ) : !isAuthenticated ? (
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="p-6 text-center">
                <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <UserPlus size={28} className="text-primary" />
                </div>
                <h2 className="text-xl font-heading font-bold mb-2" data-testid="text-invite-title">
                  You've Been Invited!
                </h2>
                <p className="text-sm text-muted-foreground mb-6" data-testid="text-invite-description">
                  Sign in to accept this invite and start comparing your food taste with friends.
                </p>
                <Button
                  className="w-full h-12 font-semibold rounded-xl text-base"
                  onClick={handleSignIn}
                  data-testid="button-sign-in"
                >
                  <UserPlus size={18} className="mr-2" />
                  Sign In to Accept
                </Button>
              </div>
            </div>
          ) : status === "loading" ? (
            <div className="bg-card rounded-2xl border border-border/50 p-8 shadow-sm text-center animate-pulse">
              <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-4" />
              <div className="h-4 bg-muted rounded w-3/4 mx-auto mb-2" />
              <div className="h-3 bg-muted rounded w-1/2 mx-auto" />
            </div>
          ) : status === "success" && inviter ? (
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="p-6 text-center">
                <div className="relative mx-auto mb-4 w-20 h-20">
                  {inviter.profileImageUrl ? (
                    <img
                      src={inviter.profileImageUrl}
                      alt={inviter.name}
                      className="w-20 h-20 rounded-full object-cover border-4 border-primary/20"
                      data-testid="img-inviter-avatar"
                    />
                  ) : (
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-2xl font-bold text-primary border-4 border-primary/20" data-testid="img-inviter-avatar">
                      {inviter.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute -bottom-1 -right-1 bg-green-500 w-7 h-7 rounded-full flex items-center justify-center border-2 border-background">
                    <Check size={14} className="text-white" />
                  </div>
                </div>
                <h2 className="text-xl font-heading font-bold mb-1" data-testid="text-success-title">
                  You're now following {inviter.name}!
                </h2>
                <p className="text-sm text-muted-foreground mb-6" data-testid="text-success-description">
                  See how your food taste compares with theirs.
                </p>
                <Button
                  className="w-full h-12 font-semibold rounded-xl text-base"
                  onClick={() => setLocation(`/compare/${inviter.id}`)}
                  data-testid="button-compare-taste"
                >
                  Compare Taste
                </Button>
              </div>
            </div>
          ) : status === "error" ? (
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="p-6 text-center">
                <div className="bg-destructive/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle size={28} className="text-destructive" />
                </div>
                <h2 className="text-xl font-heading font-bold mb-2" data-testid="text-error-title">
                  Invite Error
                </h2>
                <p className="text-sm text-muted-foreground mb-6" data-testid="text-error-message">
                  {errorMessage}
                </p>
                <Button
                  variant="outline"
                  className="w-full h-12 font-semibold rounded-xl text-base"
                  onClick={() => setLocation("/")}
                  data-testid="button-go-home"
                >
                  Go Home
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}
