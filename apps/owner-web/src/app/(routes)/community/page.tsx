import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-16 — Community & CSR.
 *
 * Minutes archive (village + district), CSR delivery dashboard
 * (commitments vs delivery), grievance map. Sentiment trends feed
 * directly into the Risk-agent scan on the cockpit.
 */
export default function CommunityPage() {
  return (
    <>
      <ScreenHeader slug="community" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Minutes archive">
          Searchable village + district meeting minutes with extracted
          commitments and assigned owners.
        </PlaceholderCard>
        <PlaceholderCard title="CSR delivery dashboard">
          Per-commitment progress: pledged vs delivered, photos, beneficiary
          fingerprints / signatures.
        </PlaceholderCard>
        <PlaceholderCard title="Grievance map">
          Geo-tagged grievance pins, ageing, resolution status. Sentiment
          aggregate per ward.
        </PlaceholderCard>
      </div>
    </>
  );
}
