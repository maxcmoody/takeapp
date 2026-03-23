import Layout from "@/components/Layout";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function Privacy() {
  const [_, setLocation] = useLocation();
  return (
    <Layout>
      <div className="p-6 pt-12 pb-24 max-w-prose mx-auto">
        <button onClick={() => setLocation("/profile")} className="flex items-center gap-2 text-muted-foreground mb-6" data-testid="button-back">
          <ArrowLeft size={18} /> Back
        </button>
        <h1 className="text-2xl font-heading font-bold mb-4" data-testid="text-privacy-title">Privacy Policy</h1>
        <div className="prose prose-sm text-muted-foreground space-y-4 text-sm leading-relaxed">
          <p><strong>Effective Date:</strong> February 2026</p>
          <h2 className="text-base font-semibold text-foreground mt-6">What We Collect</h2>
          <p>When you sign in, we store your user ID and display name provided by your authentication provider. We do not collect or store passwords directly.</p>
          <p>When you use TAKE, we store your restaurant rankings, group memberships, and interactions (such as head-to-head matchup votes) to provide the service.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">How We Use Your Data</h2>
          <p>Your data is used to power your personal rankings, contribute to community leaderboards, and enable group features. We aggregate ranking data anonymously for leaderboard scores.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Third-Party Services</h2>
          <p>We use Google Places API to provide restaurant search and details. We use Sentry for error tracking (no personal data is sent). We use Replit Auth for authentication.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Data Export</h2>
          <p>You can export all of your data at any time from the Profile page. The export includes your rankings, group memberships, and comparison history in a machine-readable JSON format.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Data Retention & Deletion</h2>
          <p>You can request deletion of your account through the Profile page. We will process deletion requests within 30 days. When your account is deleted, your personal information (email, name, and profile photo) is permanently removed or anonymized. Your restaurant rankings and comparison data are preserved in anonymized form to maintain the accuracy of community leaderboards and aggregated scores, but they can no longer be linked back to you.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Contact</h2>
          <p>For privacy questions, use the contact option in your Profile or email the app administrator.</p>
        </div>
      </div>
    </Layout>
  );
}
