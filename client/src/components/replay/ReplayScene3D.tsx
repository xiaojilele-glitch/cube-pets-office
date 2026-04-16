/**
 * ReplayScene3D — 3D replay scene that reuses OfficeRoom + PetWorkers
 * and overlays replay-specific visual effects driven by the ReplayEngine.
 *
 * Subscribes to engine events via useEffect and tracks the current event
 * to drive AgentActivityOverlay, CommunicationLine, DecisionGlow, and
 * ErrorHighlight sub-components.
 *
 * This component renders *inside* a <Canvas> — it is NOT a standalone
 * Canvas wrapper. The parent (ReplayPage) provides the Canvas.
 *
 * Requirements: 8.1, 8.7
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CommunicationEventData,
  DecisionEventData,
  ExecutionEvent,
  ExecutionTimeline,
} from "../../../../shared/replay/contracts";

import { OfficeRoom } from "../three/OfficeRoom";
import { PetWorkers } from "../three/PetWorkers";

import type { ReplayEngine } from "../../lib/replay/replay-engine";

import { AgentActivityOverlay } from "./AgentActivityOverlay";
import type { AgentActivity } from "./AgentActivityOverlay";
import { CommunicationLine } from "./CommunicationLine";
import { DecisionGlow } from "./DecisionGlow";
import { ErrorHighlight } from "./ErrorHighlight";

/* ─── Props ─── */

export interface ReplayScene3DProps {
  engine: ReplayEngine;
  timeline: ExecutionTimeline;
}

/* ─── Agent position lookup ─── */

/**
 * Deterministic position for an agent id.
 * In a real integration this would come from the PetWorkers scene config;
 * here we hash the id to spread agents across the office floor.
 */
function agentPosition(agentId: string): [number, number, number] {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  const x = ((hash & 0xff) / 255) * 8 - 4; // -4 … 4
  const z = (((hash >> 8) & 0xff) / 255) * 6 - 3; // -3 … 3
  return [x, 0, z];
}

/* ─── Overlay state derived from current event ─── */

interface OverlayState {
  activities: Map<string, AgentActivity>;
  commLines: Array<{ from: string; to: string; color?: string }>;
  decisions: Array<{ agentId: string; confidence: number }>;
  errors: string[]; // agent ids with active errors
}

const EMPTY_OVERLAY: OverlayState = {
  activities: new Map(),
  commLines: [],
  decisions: [],
  errors: [],
};

function deriveOverlay(event: ExecutionEvent | null): OverlayState {
  if (!event) return EMPTY_OVERLAY;

  const activities = new Map<string, AgentActivity>();
  const commLines: OverlayState["commLines"] = [];
  const decisions: OverlayState["decisions"] = [];
  const errors: string[] = [];

  switch (event.eventType) {
    case "AGENT_STARTED":
      activities.set(event.sourceAgent, "working");
      break;

    case "AGENT_STOPPED":
      activities.set(event.sourceAgent, "done");
      break;

    case "MESSAGE_SENT":
    case "MESSAGE_RECEIVED": {
      const data = event.eventData as unknown as CommunicationEventData;
      activities.set(data.senderId ?? event.sourceAgent, "working");
      if (event.targetAgent) {
        activities.set(event.targetAgent, "thinking");
        commLines.push({
          from: data.senderId ?? event.sourceAgent,
          to: data.receiverId ?? event.targetAgent,
        });
      }
      break;
    }

    case "DECISION_MADE": {
      const data = event.eventData as unknown as DecisionEventData;
      activities.set(event.sourceAgent, "thinking");
      decisions.push({
        agentId: data.agentId ?? event.sourceAgent,
        confidence: typeof data.confidence === "number" ? data.confidence : 0.5,
      });
      break;
    }

    case "CODE_EXECUTED":
      activities.set(event.sourceAgent, "working");
      break;

    case "RESOURCE_ACCESSED":
      activities.set(event.sourceAgent, "working");
      break;

    case "ERROR_OCCURRED":
      activities.set(event.sourceAgent, "error");
      errors.push(event.sourceAgent);
      break;

    case "MILESTONE_REACHED":
      activities.set(event.sourceAgent, "done");
      break;
  }

  return { activities, commLines, decisions, errors };
}

/* ─── Component ─── */

export function ReplayScene3D({ engine, timeline }: ReplayScene3DProps) {
  const [currentEvent, setCurrentEvent] = useState<ExecutionEvent | null>(null);

  /* Subscribe to engine events */
  useEffect(() => {
    const unsubEvent = engine.onEvent(evt => {
      setCurrentEvent(evt);
    });

    const unsubState = engine.onStateChange(state => {
      if (state.state === "stopped" || state.state === "idle") {
        setCurrentEvent(null);
      }
    });

    return () => {
      unsubEvent();
      unsubState();
    };
  }, [engine]);

  /* Derive overlay state from current event */
  const overlay = useMemo(() => deriveOverlay(currentEvent), [currentEvent]);

  /* Stable position resolver (memoised per agent set in timeline) */
  const agentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const evt of timeline.events) {
      ids.add(evt.sourceAgent);
      if (evt.targetAgent) ids.add(evt.targetAgent);
    }
    return Array.from(ids);
  }, [timeline]);

  const positionOf = useCallback((id: string) => agentPosition(id), []);

  return (
    <group>
      {/* Reuse existing office scene */}
      <OfficeRoom />
      <PetWorkers />

      {/* Activity overlays */}
      {agentIds.map(id => {
        const activity = overlay.activities.get(id);
        if (!activity || activity === "idle") return null;
        return (
          <AgentActivityOverlay
            key={`act-${id}`}
            position={positionOf(id)}
            activity={activity}
          />
        );
      })}

      {/* Communication lines */}
      {overlay.commLines.map((line, i) => (
        <CommunicationLine
          key={`comm-${line.from}-${line.to}-${i}`}
          from={positionOf(line.from)}
          to={positionOf(line.to)}
          active
          color={line.color}
        />
      ))}

      {/* Decision glows */}
      {overlay.decisions.map(d => (
        <DecisionGlow
          key={`dec-${d.agentId}`}
          position={positionOf(d.agentId)}
          confidence={d.confidence}
        />
      ))}

      {/* Error highlights */}
      {overlay.errors.map(id => (
        <ErrorHighlight key={`err-${id}`} position={positionOf(id)} />
      ))}
    </group>
  );
}
