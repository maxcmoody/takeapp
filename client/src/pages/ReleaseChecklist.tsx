import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Play, AlertTriangle, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import * as Sentry from "@sentry/react";
import { cn } from "@/lib/utils";

type CheckStatus = "idle" | "running" | "pass" | "fail";

interface CheckResult {
  status: CheckStatus;
  detail?: string;
}

export default function ReleaseChecklist() {
  const [_, setLocation] = useLocation();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckResult>>({
    backend: { status: "idle" },
    sentry_fe: { status: "idle" },
    sentry_be: { status: "idle" },
    analytics: { status: "idle" },
    places: { status: "idle" },
    reports: { status: "idle" },
    export: { status: "idle" },
    deletion: { status: "idle" },
  });

  useEffect(() => {
    fetch("/api/admin/check", { credentials: "include" })
      .then(r => r.json())
      .then(d => setIsAdmin(d.isAdmin === true))
      .catch(() => setIsAdmin(false));
  }, []);

  const updateCheck = (key: string, result: CheckResult) =>
    setChecks(prev => ({ ...prev, [key]: result }));

  const runBackend = async () => {
    updateCheck("backend", { status: "running" });
    try {
      const [healthRes, versionRes, meRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/version"),
        fetch("/api/me", { credentials: "include" }),
      ]);
      const health = await healthRes.json();
      const version = await versionRes.json();
      const me = await meRes.json();
      if (health.ok && version.version && me.id) {
        updateCheck("backend", { status: "pass", detail: `v${version.version} | user=${me.id}` });
      } else {
        updateCheck("backend", { status: "fail", detail: "One or more endpoints returned unexpected data" });
      }
    } catch (err: any) {
      updateCheck("backend", { status: "fail", detail: err.message });
    }
  };

  const runSentryFE = async () => {
    updateCheck("sentry_fe", { status: "running" });
    try {
      Sentry.captureMessage("Release check: frontend test");
      updateCheck("sentry_fe", { status: "pass", detail: "Message sent to Sentry (check dashboard)" });
    } catch (err: any) {
      updateCheck("sentry_fe", { status: "fail", detail: err.message });
    }
  };

  const runSentryBE = async () => {
    updateCheck("sentry_be", { status: "running" });
    try {
      const r = await fetch("/api/sentry-test", { credentials: "include" });
      if (r.ok) {
        updateCheck("sentry_be", { status: "pass", detail: "Backend Sentry test fired" });
      } else {
        updateCheck("sentry_be", { status: "fail", detail: `Status ${r.status}` });
      }
    } catch (err: any) {
      updateCheck("sentry_be", { status: "fail", detail: err.message });
    }
  };

  const runAnalytics = async () => {
    updateCheck("analytics", { status: "running" });
    try {
      const r = await fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ event: "release_check", properties: { source: "release_checklist" } }),
      });
      if (r.ok) {
        updateCheck("analytics", { status: "pass", detail: "Event logged" });
      } else {
        updateCheck("analytics", { status: "fail", detail: `Status ${r.status}` });
      }
    } catch (err: any) {
      updateCheck("analytics", { status: "fail", detail: err.message });
    }
  };

  const runPlaces = async () => {
    updateCheck("places", { status: "running" });
    try {
      const r = await fetch("/api/health/places");
      const data = await r.json();
      if (data.ok) {
        updateCheck("places", { status: "pass", detail: `OK — ${data.resultCount} results` });
      } else {
        updateCheck("places", { status: "fail", detail: data.error || data.status || "Unknown error" });
      }
    } catch (err: any) {
      updateCheck("places", { status: "fail", detail: err.message });
    }
  };

  const runReports = async () => {
    updateCheck("reports", { status: "running" });
    try {
      const r = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ placeId: "__release_check__", reason: "Other", message: "Release check test report" }),
      });
      if (r.ok) {
        updateCheck("reports", { status: "pass", detail: "Test report created (resolve in Admin)" });
      } else {
        const d = await r.json().catch(() => ({}));
        updateCheck("reports", { status: "fail", detail: d.error || `Status ${r.status}` });
      }
    } catch (err: any) {
      updateCheck("reports", { status: "fail", detail: err.message });
    }
  };

  const runExport = async () => {
    updateCheck("export", { status: "running" });
    try {
      const r = await fetch("/api/export", { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        updateCheck("export", { status: "pass", detail: `Export OK — ${data.myTake?.length || 0} ranked items` });
      } else {
        updateCheck("export", { status: "fail", detail: `Status ${r.status}` });
      }
    } catch (err: any) {
      updateCheck("export", { status: "fail", detail: err.message });
    }
  };

  const runAll = () => {
    runBackend();
    runSentryFE();
    runSentryBE();
    runAnalytics();
    runPlaces();
    runReports();
    runExport();
    updateCheck("deletion", { status: "pass", detail: "Manual check — see Admin > Deletions" });
  };

  const statusIcon = (s: CheckStatus) => {
    switch (s) {
      case "idle": return <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />;
      case "running": return <Loader2 size={20} className="animate-spin text-primary" />;
      case "pass": return <CheckCircle2 size={20} className="text-green-500" />;
      case "fail": return <XCircle size={20} className="text-red-500" />;
    }
  };

  if (isAdmin === null) return <Layout><div className="p-6 pt-12 flex justify-center"><Loader2 className="animate-spin" /></div></Layout>;
  if (isAdmin === false) return (
    <Layout>
      <div className="p-6 pt-12 pb-24 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <AlertTriangle size={28} className="text-muted-foreground" />
        </div>
        <h1 className="text-xl font-heading font-bold mb-2" data-testid="text-no-access">Access Denied</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs">This page is only available to administrators.</p>
        <button onClick={() => setLocation("/profile")} className="flex items-center gap-2 text-primary font-semibold text-sm" data-testid="button-back-to-profile">
          <ArrowLeft size={16} /> Back to Profile
        </button>
      </div>
    </Layout>
  );

  const checkItems: { key: string; label: string; description: string; action?: () => void }[] = [
    { key: "backend", label: "Backend Alive", description: "/api/health + /api/version + /api/me", action: runBackend },
    { key: "sentry_fe", label: "Sentry (Frontend)", description: "Fire test message to Sentry", action: runSentryFE },
    { key: "sentry_be", label: "Sentry (Backend)", description: "Trigger /api/sentry-test", action: runSentryBE },
    { key: "analytics", label: "Analytics", description: "Fire release_check event", action: runAnalytics },
    { key: "places", label: "Places API", description: "Health check against Google Places", action: runPlaces },
    { key: "reports", label: "Reports", description: "Create test report (resolve in Admin)", action: runReports },
    { key: "export", label: "Data Export", description: "Call /api/export and verify", action: runExport },
    { key: "deletion", label: "Deletion Flow", description: "Manual — check Admin > Deletions" },
  ];

  const passCount = Object.values(checks).filter(c => c.status === "pass").length;
  const failCount = Object.values(checks).filter(c => c.status === "fail").length;

  return (
    <Layout>
      <div className="p-6 pt-12 pb-24 max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setLocation("/profile")} className="p-1" data-testid="button-back">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-heading font-bold" data-testid="text-title">Release Checklist</h1>
            <p className="text-xs text-muted-foreground">Pre-deploy QA harness</p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm">
            {passCount > 0 && <span className="text-green-600 font-semibold">{passCount} passed</span>}
            {failCount > 0 && <span className="text-red-500 font-semibold">{failCount} failed</span>}
            {passCount === 0 && failCount === 0 && <span className="text-muted-foreground">No checks run yet</span>}
          </div>
          <Button size="sm" onClick={runAll} data-testid="button-run-all">
            <Play size={14} className="mr-1.5" /> Run All
          </Button>
        </div>

        <div className="space-y-2">
          {checkItems.map(item => {
            const check = checks[item.key];
            return (
              <div
                key={item.key}
                className={cn(
                  "bg-card border rounded-xl p-4 flex items-start gap-3",
                  check.status === "fail" && "border-red-300 dark:border-red-800/50",
                  check.status === "pass" && "border-green-300 dark:border-green-800/50",
                )}
                data-testid={`check-card-${item.key}`}
              >
                <div className="mt-0.5">{statusIcon(check.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                  {check.detail && (
                    <div className={cn(
                      "text-xs mt-1 font-mono break-all",
                      check.status === "fail" ? "text-red-500" : "text-muted-foreground"
                    )}>
                      {check.detail}
                    </div>
                  )}
                </div>
                {item.action && check.status !== "running" && (
                  <Button size="sm" variant="ghost" className="shrink-0" onClick={item.action} data-testid={`button-run-${item.key}`}>
                    <Play size={14} />
                  </Button>
                )}
                {item.key === "deletion" && (
                  <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setLocation("/admin")} data-testid="button-goto-admin">
                    <ExternalLink size={14} />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
