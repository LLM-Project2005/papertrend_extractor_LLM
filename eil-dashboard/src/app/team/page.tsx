import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import TeamPage from "@/components/marketing/pages/TeamPage";
import { FeatureEnd } from "@/components/marketing/pages/shared";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Team",
  description: "The team behind Papertrend, at the Faculty of Arts, Chulalongkorn University.",
  alternates: {
    canonical: "/team",
  },
};

export default function TeamRoute() {
  return (
    <MarketingShell activeSlug="team">
      <TeamPage />
      <FeatureEnd
        title="See what we built."
        copy="Papertrend is in beta. Bring the papers you are reading and see the field they make up, all at once."
      />
    </MarketingShell>
  );
}
