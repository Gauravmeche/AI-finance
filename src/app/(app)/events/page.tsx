import { EventsTable } from "@/components/EventsTable";

export default function EventsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Lock-in Events</h1>
        <p className="text-[13px] text-muted">All tracked lock-in events with filters, sorting and export</p>
      </div>
      <EventsTable />
    </div>
  );
}
