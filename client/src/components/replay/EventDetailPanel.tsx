/**
 * EventDetailPanel — Shows event details with type-specific views.
 *
 * Communication: message content, sender/receiver, type
 * Decision: input, logic, result, confidence
 * Code: snippet, status, execution time
 * Resource: resource type, access type, result, permission check
 * Related events links.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 18.4
 */

import { useMemo } from 'react';

import type {
  ExecutionEvent,
  CommunicationEventData,
  DecisionEventData,
  CodeExecutionEventData,
  ResourceAccessEventData,
} from '../../../../shared/replay/contracts';
import { findRelatedEvents } from '@/lib/replay/related-events';
import { useReplayStore } from '@/lib/replay/replay-store-ui';

export interface EventDetailPanelProps {
  event: ExecutionEvent | null;
  allEvents: ExecutionEvent[];
}

export function EventDetailPanel({ event, allEvents }: EventDetailPanelProps) {
  const selectEvent = useReplayStore((s) => s.selectEvent);

  const related = useMemo(
    () => (event ? findRelatedEvents(event, allEvents) : []),
    [event, allEvents],
  );

  if (!event) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-white/40">
        Select an event to view details
      </div>
    );
  }

  const data = event.eventData as Record<string, unknown>;

  return (
    <div className="space-y-4 p-4 text-xs">
      {/* Header */}
      <div>
        <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80">
          {event.eventType.replace(/_/g, ' ')}
        </span>
        <p className="mt-1 text-white/50">{new Date(event.timestamp).toISOString()}</p>
        <p className="text-white/60">
          {event.sourceAgent}{event.targetAgent ? ` → ${event.targetAgent}` : ''}
        </p>
      </div>

      {/* Type-specific detail */}
      <div className="space-y-2 rounded bg-white/5 p-3">
        {(event.eventType === 'MESSAGE_SENT' || event.eventType === 'MESSAGE_RECEIVED') && (
          <CommDetail data={data as unknown as CommunicationEventData} />
        )}
        {event.eventType === 'DECISION_MADE' && (
          <DecisionDetail data={data as unknown as DecisionEventData} />
        )}
        {event.eventType === 'CODE_EXECUTED' && (
          <CodeDetail data={data as unknown as CodeExecutionEventData} />
        )}
        {event.eventType === 'RESOURCE_ACCESSED' && (
          <ResourceDetail data={data as unknown as ResourceAccessEventData} />
        )}
      </div>

      {/* Metadata */}
      {event.metadata && (
        <div className="space-y-1 text-white/50">
          {event.metadata.cost != null && <p>Cost: ${event.metadata.cost.toFixed(4)}</p>}
          {event.metadata.phase && <p>Phase: {event.metadata.phase}</p>}
        </div>
      )}

      {/* Related events */}
      {related.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold text-white/60">Related Events</p>
          {related.slice(0, 5).map((r) => (
            <button
              key={r.eventId}
              onClick={() => selectEvent(r.eventId)}
              className="block w-full truncate rounded px-2 py-1 text-left text-[10px] text-blue-300 hover:bg-white/5"
            >
              {r.eventType} — {r.sourceAgent}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-views ─── */

function CommDetail({ data }: { data: CommunicationEventData }) {
  return (
    <>
      <Row label="Type" value={data.messageType} />
      <Row label="Status" value={data.status} />
      <Row label="From" value={data.senderId} />
      <Row label="To" value={data.receiverId} />
      <p className="mt-1 whitespace-pre-wrap text-white/70">
        {typeof data.messageContent === 'string' ? data.messageContent : JSON.stringify(data.messageContent, null, 2)}
      </p>
    </>
  );
}

function DecisionDetail({ data }: { data: DecisionEventData }) {
  return (
    <>
      <Row label="Agent" value={data.agentId} />
      <Row label="Confidence" value={`${(data.confidence * 100).toFixed(0)}%`} />
      <Row label="Logic" value={data.decisionLogic} />
      <p className="mt-1 text-white/50">Result: {JSON.stringify(data.decisionResult)}</p>
    </>
  );
}

function CodeDetail({ data }: { data: CodeExecutionEventData }) {
  return (
    <>
      <Row label="Language" value={data.codeLanguage} />
      <Row label="Status" value={data.executionStatus} />
      <Row label="Time" value={`${data.executionTime}ms`} />
      <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/30 p-2 text-[10px] text-green-300">
        {data.codeSnippet}
      </pre>
    </>
  );
}

function ResourceDetail({ data }: { data: ResourceAccessEventData }) {
  return (
    <>
      <Row label="Resource" value={`${data.resourceType}: ${data.resourceId}`} />
      <Row label="Access" value={data.accessType} />
      <Row label="Success" value={data.accessResult.success ? 'Yes' : 'No'} />
      {data.permissionCheck && (
        <Row label="Permission" value={data.permissionCheck.passed ? 'Passed' : 'Denied'} />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/40">{label}</span>
      <span className="text-white/80">{value}</span>
    </div>
  );
}
