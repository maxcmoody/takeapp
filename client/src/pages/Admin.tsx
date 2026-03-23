import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Flag, Trash2, Check, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

type Report = { id: string; userId: string; placeId: string; reason: string; message: string | null; status: string; createdAt: string };
type DeletionReq = { id: string; userId: string; message: string | null; status: string; createdAt: string };

export default function Admin() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState<"reports" | "deletions">("reports");
  const [reports, setReports] = useState<Report[]>([]);
  const [deletions, setDeletions] = useState<DeletionReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/admin/check", { credentials: "include" })
      .then(r => r.json())
      .then(d => { setIsAdmin(d.isAdmin === true); })
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    if (isAdmin !== true) return;
    setLoading(true);
    if (tab === "reports") {
      fetch("/api/admin/reports", { credentials: "include" })
        .then(r => r.json())
        .then(d => setReports(d.reports || []))
        .finally(() => setLoading(false));
    } else {
      fetch("/api/admin/deletion-requests", { credentials: "include" })
        .then(r => r.json())
        .then(d => setDeletions(d.requests || []))
        .finally(() => setLoading(false));
    }
  }, [tab, isAdmin]);

  const resolveReport = async (id: string) => {
    await fetch(`/api/admin/reports/${id}/resolve`, { method: "POST", credentials: "include" });
    setReports(prev => prev.filter(r => r.id !== id));
    toast({ title: "Report resolved" });
  };

  const resolveDeletion = async (id: string) => {
    await fetch(`/api/admin/deletion-requests/${id}/resolve`, { method: "POST", credentials: "include" });
    setDeletions(prev => prev.filter(r => r.id !== id));
    toast({ title: "Deletion request resolved" });
  };

  const completeDeletion = async (id: string) => {
    if (!confirm("This will anonymize the user's personal data (email, name, photo) while preserving their rankings in aggregates. Continue?")) return;
    const r = await fetch(`/api/admin/deletion-requests/${id}/complete`, { method: "POST", credentials: "include" });
    if (r.ok) {
      setDeletions(prev => prev.filter(d => d.id !== id));
      toast({ title: "Deletion completed", description: "User data has been anonymized" });
    } else {
      toast({ title: "Failed to complete deletion", variant: "destructive" });
    }
  };

  if (isAdmin === null) return <Layout><div className="p-6 pt-12 flex justify-center"><Loader2 className="animate-spin" /></div></Layout>;
  if (isAdmin === false) return (
    <Layout>
      <div className="p-6 pt-12 pb-24 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Flag size={28} className="text-muted-foreground" />
        </div>
        <h1 className="text-xl font-heading font-bold mb-2" data-testid="text-no-access">You don't have access</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs">This page is only available to app administrators. If you think this is a mistake, contact the admin.</p>
        <button onClick={() => setLocation("/profile")} className="flex items-center gap-2 text-primary font-semibold text-sm" data-testid="button-back-to-profile">
          <ArrowLeft size={16} /> Back to Profile
        </button>
      </div>
    </Layout>
  );

  return (
    <Layout>
      <div className="p-6 pt-12 pb-24">
        <button onClick={() => setLocation("/profile")} className="flex items-center gap-2 text-muted-foreground mb-6" data-testid="button-back">
          <ArrowLeft size={18} /> Back
        </button>
        <h1 className="text-2xl font-heading font-bold mb-4" data-testid="text-admin-title">Admin</h1>

        <div className="flex gap-2 mb-6">
          <Button variant={tab === "reports" ? "default" : "outline"} size="sm" onClick={() => setTab("reports")} className="rounded-full" data-testid="button-tab-reports">
            <Flag size={14} className="mr-1.5" /> Reports
          </Button>
          <Button variant={tab === "deletions" ? "default" : "outline"} size="sm" onClick={() => setTab("deletions")} className="rounded-full" data-testid="button-tab-deletions">
            <Trash2 size={14} className="mr-1.5" /> Deletion Requests
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : tab === "reports" ? (
          reports.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No open reports</p>
          ) : (
            <div className="space-y-3">
              {reports.map(r => (
                <div key={r.id} className="bg-card border border-border rounded-xl p-4" data-testid={`card-report-${r.id}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">{r.reason}</span>
                      <p className="text-xs text-muted-foreground mt-1">Place: {r.placeId}</p>
                      <p className="text-xs text-muted-foreground">User: {r.userId}</p>
                    </div>
                    <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => resolveReport(r.id)} data-testid={`button-resolve-report-${r.id}`}>
                      <Check size={14} className="mr-1" /> Resolve
                    </Button>
                  </div>
                  {r.message && <p className="text-sm text-foreground mt-2 bg-muted/50 p-2 rounded-lg">{r.message}</p>}
                  <p className="text-[10px] text-muted-foreground/50 mt-2">{new Date(r.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )
        ) : (
          deletions.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No open deletion requests</p>
          ) : (
            <div className="space-y-3">
              {deletions.map(d => (
                <div key={d.id} className="bg-card border border-border rounded-xl p-4" data-testid={`card-deletion-${d.id}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-xs text-muted-foreground">User: {d.userId}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" className="rounded-lg h-8" onClick={() => completeDeletion(d.id)} data-testid={`button-complete-deletion-${d.id}`}>
                        <Trash2 size={14} className="mr-1" /> Complete Deletion
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => resolveDeletion(d.id)} data-testid={`button-resolve-deletion-${d.id}`}>
                        <Check size={14} className="mr-1" /> Dismiss
                      </Button>
                    </div>
                  </div>
                  {d.message && <p className="text-sm text-foreground mt-2 bg-muted/50 p-2 rounded-lg">{d.message}</p>}
                  <p className="text-[10px] text-muted-foreground/50 mt-2">{new Date(d.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </Layout>
  );
}
