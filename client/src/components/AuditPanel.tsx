import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  Search,
  ShieldCheck,
} from "lucide-react";
import type {
  AuditEventType,
  AuditLogEntry,
  AuditSeverity,
} from "@shared/audit/contracts.js";
import { AuditEventType as AET } from "@shared/audit/contracts.js";

import { AnomalyAlertPanel } from "@/components/AnomalyAlertPanel";
import { AuditChainVerifier } from "@/components/AuditChainVerifier";
import { AuditTimeline } from "@/components/AuditTimeline";
import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import { useAuditStore } from "@/lib/audit-store";

const TABS = [
  { id: "events" as const, label: "Events", icon: List },
  { id: "timeline" as const, label: "Timeline", icon: Clock },
  { id: "verify" as const, label: "Verify", icon: ShieldCheck },
  { id: "anomalies" as const, label: "Anomalies", icon: AlertTriangle },
];

const EVENT_TYPE_OPTIONS: AuditEventType[] = Object.values(AET);
const SEVERITY_OPTIONS: AuditSeverity[] = ["INFO", "WARNING", "CRITICAL"];

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function EventDetail({
  entry,
  onBack,
}: {
  entry: AuditLogEntry;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3 p-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700"
      >
        <ChevronLeft className="size-3" />
        Back to list
      </button>

      <div className="rounded-xl border border-stone-200 bg-white p-3 text-xs">
        <h4 className="mb-2 text-sm font-semibold text-stone-800">
          Entry #{entry.sequenceNumber}
        </h4>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-stone-600">
          <div>
            <span className="font-medium">Entry ID:</span> {entry.entryId}
          </div>
          <div>
            <span className="font-medium">Event ID:</span> {entry.eventId}
          </div>
          <div>
            <span className="font-medium">Type:</span> {entry.event.eventType}
          </div>
          <div>
            <span className="font-medium">Result:</span> {entry.event.result}
          </div>
          <div>
            <span className="font-medium">Actor:</span>{" "}
            {entry.event.actor.name ?? entry.event.actor.id} (
            {entry.event.actor.type})
          </div>
          <div>
            <span className="font-medium">Resource:</span>{" "}
            {entry.event.resource.name ?? entry.event.resource.id} (
            {entry.event.resource.type})
          </div>
          <div>
            <span className="font-medium">Action:</span> {entry.event.action}
          </div>
          <div>
            <span className="font-medium">Timestamp:</span>{" "}
            {formatTime(entry.timestamp.system)}
          </div>
        </div>

        <div className="mt-3 border-t border-stone-100 pt-2">
          <p className="mb-1 font-medium text-stone-700">Hash chain</p>
          <div className="space-y-0.5 font-mono text-[10px] text-stone-500">
            <div>Previous: {entry.previousHash || "-"}</div>
            <div>Current: {entry.currentHash}</div>
            <div>Nonce: {entry.nonce}</div>
            <div>Signature: {entry.signature.slice(0, 40)}...</div>
          </div>
        </div>

        {entry.event.context ? (
          <div className="mt-3 border-t border-stone-100 pt-2">
            <p className="mb-1 font-medium text-stone-700">Context</p>
            <pre className="overflow-x-auto rounded-lg bg-stone-50 p-2 text-[10px] text-stone-500">
              {JSON.stringify(entry.event.context, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EventsTab() {
  const entries = useAuditStore(state => state.entries);
  const total = useAuditStore(state => state.total);
  const page = useAuditStore(state => state.page);
  const filters = useAuditStore(state => state.filters);
  const selectedEntry = useAuditStore(state => state.selectedEntry);
  const loadingEvents = useAuditStore(state => state.loadingEvents);
  const hasLoadedEvents = useAuditStore(state => state.hasLoadedEvents);
  const eventsError = useAuditStore(state => state.eventsError);
  const setFilters = useAuditStore(state => state.setFilters);
  const setPage = useAuditStore(state => state.setPage);
  const selectEntry = useAuditStore(state => state.selectEntry);
  const fetchEvents = useAuditStore(state => state.fetchEvents);

  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents, filters, page]);

  const handleSearch = () => {
    const keyword = searchInput.trim();
    setPage({ pageNum: 1 });
    setFilters({ keyword: keyword || undefined });
  };

  const totalPages = Math.max(1, Math.ceil(total / page.pageSize));

  if (selectedEntry) {
    return (
      <EventDetail entry={selectedEntry} onBack={() => selectEntry(null)} />
    );
  }

  return (
    <div className="space-y-3 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={(filters.eventType as string) ?? ""}
          onChange={event =>
            setFilters({
              eventType: event.target.value
                ? (event.target.value as AuditEventType)
                : undefined,
            })
          }
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-600"
        >
          <option value="">All types</option>
          {EVENT_TYPE_OPTIONS.map(eventType => (
            <option key={eventType} value={eventType}>
              {eventType.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <select
          value={filters.severity ?? ""}
          onChange={event =>
            setFilters({
              severity: event.target.value
                ? (event.target.value as AuditSeverity)
                : undefined,
            })
          }
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-600"
        >
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map(severity => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <input
            type="text"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") handleSearch();
            }}
            placeholder="Search events"
            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-600 placeholder:text-stone-300"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="rounded-lg bg-stone-100 p-1.5 text-stone-500 transition-colors hover:bg-stone-200"
          >
            <Search className="size-3.5" />
          </button>
        </div>
      </div>

      {eventsError && entries.length > 0 ? (
        <RetryInlineNotice
          title="Audit refresh failed"
          description={eventsError.message}
          actionLabel="Retry"
          onRetry={() => void fetchEvents()}
        />
      ) : null}

      {loadingEvents && !hasLoadedEvents ? (
        <EmptyHintBlock
          tone="info"
          icon={<List className="size-5" />}
          title="Loading audit events"
          description="Fetching the latest audit records and hiding raw parser errors while the data arrives."
          hint="You can retry from this panel without refreshing the full page."
        />
      ) : null}

      {!loadingEvents && eventsError && entries.length === 0 ? (
        <EmptyHintBlock
          tone={eventsError.kind === "error" ? "danger" : "warning"}
          icon={<AlertTriangle className="size-5" />}
          title={
            eventsError.kind === "demo"
              ? "Audit events are unavailable in preview mode"
              : eventsError.kind === "offline"
                ? "Audit service is unavailable"
                : "Audit request failed"
          }
          description={
            eventsError.kind === "demo"
              ? "The frontend is running without the live audit backend, so the events table stays in a safe preview state."
              : eventsError.kind === "offline"
                ? "The audit backend is currently unreachable, so the events table could not load."
                : "The audit API returned an unexpected result, and the raw parser error was hidden from the UI."
          }
          hint={eventsError.message}
          actionLabel="Retry"
          onAction={() => void fetchEvents()}
        />
      ) : null}

      {!loadingEvents &&
      !eventsError &&
      hasLoadedEvents &&
      entries.length === 0 ? (
        <EmptyHintBlock
          tone="info"
          icon={<List className="size-5" />}
          title="No audit events matched"
          description={
            filters.keyword || filters.eventType || filters.severity
              ? "The current filters did not match any audit record."
              : "No audit entry has been recorded yet."
          }
          hint={
            filters.keyword || filters.eventType || filters.severity
              ? "Clear the filters or search again to widen the result set."
              : "Once workflow actions, permission checks, or reviews run, audit entries will appear here."
          }
          actionLabel="Refresh"
          onAction={() => void fetchEvents()}
        />
      ) : null}

      {entries.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-stone-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50 text-left text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                  <th className="px-3 py-2">Seq</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr
                    key={entry.entryId}
                    onClick={() => selectEntry(entry)}
                    className="cursor-pointer border-b border-stone-50 transition-colors hover:bg-stone-50"
                  >
                    <td className="px-3 py-2 font-mono text-stone-400">
                      #{entry.sequenceNumber}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-stone-100 px-1 py-0.5 text-[10px] font-semibold text-stone-600">
                        {entry.event.eventType.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-stone-600">
                      {entry.event.actor.name ?? entry.event.actor.id}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-stone-600">
                      {entry.event.action}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1 py-0.5 text-[10px] font-semibold ${
                          entry.event.result === "success"
                            ? "bg-emerald-100 text-emerald-700"
                            : entry.event.result === "failure"
                              ? "bg-red-100 text-red-700"
                              : entry.event.result === "denied"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {entry.event.result}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-400">
                      {formatTime(entry.timestamp.system)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > 0 ? (
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>
                {total} total | Page {page.pageNum} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page.pageNum <= 1}
                  onClick={() => setPage({ pageNum: page.pageNum - 1 })}
                  className="rounded-lg p-1 transition-colors hover:bg-stone-100 disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={page.pageNum >= totalPages}
                  onClick={() => setPage({ pageNum: page.pageNum + 1 })}
                  className="rounded-lg p-1 transition-colors hover:bg-stone-100 disabled:opacity-30"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function AuditPanel() {
  const activeTab = useAuditStore(state => state.activeTab);
  const setActiveTab = useAuditStore(state => state.setActiveTab);

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-stone-200/80 px-4">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors ${
                active
                  ? "border-[#6B8E7B] text-[#6B8E7B]"
                  : "border-transparent text-stone-400 hover:text-stone-600"
              }`}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "events" ? <EventsTab /> : null}
        {activeTab === "timeline" ? <AuditTimeline /> : null}
        {activeTab === "verify" ? <AuditChainVerifier /> : null}
        {activeTab === "anomalies" ? <AnomalyAlertPanel /> : null}
      </div>
    </div>
  );
}
