import { EventsTable } from "@/components/EventsTable";

export default function ReviewPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Needs Review</h1>
        <p className="text-[13px] text-muted">
          Date discrepancies, low-confidence extractions and unavailable sources. Open an IPO to review evidence and
          submit an override.
        </p>
      </div>
      <EventsTable presetNeedsReview />
    </div>
  );
}
