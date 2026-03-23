import Layout from "@/components/Layout";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function Terms() {
  const [_, setLocation] = useLocation();
  return (
    <Layout>
      <div className="p-6 pt-12 pb-24 max-w-prose mx-auto">
        <button onClick={() => setLocation("/profile")} className="flex items-center gap-2 text-muted-foreground mb-6" data-testid="button-back">
          <ArrowLeft size={18} /> Back
        </button>
        <h1 className="text-2xl font-heading font-bold mb-4" data-testid="text-terms-title">Terms of Service</h1>
        <div className="prose prose-sm text-muted-foreground space-y-4 text-sm leading-relaxed">
          <p><strong>Effective Date:</strong> February 2026</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Acceptance</h2>
          <p>By using TAKE, you agree to these terms. If you do not agree, please do not use the service.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Service Description</h2>
          <p>TAKE is a community-driven restaurant ranking platform. Users rank restaurants through head-to-head comparisons and contribute to community leaderboards.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">User Conduct</h2>
          <p>You agree not to submit false, misleading, or offensive content. Abuse of the reporting system or other features may result in account restrictions.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Content</h2>
          <p>Restaurant information is sourced from Google Places and user submissions. We do not guarantee the accuracy of restaurant details, hours, or availability.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Limitation of Liability</h2>
          <p>TAKE is provided "as is" without warranties. We are not liable for any damages arising from your use of the service.</p>
          <h2 className="text-base font-semibold text-foreground mt-6">Changes</h2>
          <p>We may update these terms at any time. Continued use after changes constitutes acceptance of the updated terms.</p>
        </div>
      </div>
    </Layout>
  );
}
