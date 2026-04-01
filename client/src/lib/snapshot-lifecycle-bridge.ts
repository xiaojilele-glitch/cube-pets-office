/**
 * snapshot-lifecycle-bridge.ts
 *
 * Bridges the snapshot scheduler lifecycle hooks with the Mission state
 * management layer. Registers globalThis accessors and subscribes to
 * store changes to call onMissionStatusChange / onMissionStageChange
 * at the right moments.
 *
 * Requirements: 1.1, 1.2
 * Task: 9.2
 */

import { useAppStore } from "./store";
import { useWorkflowStore } from "./workflow-store";
import {
  onMissionStatusChange,
  onMissionStageChange,
} from "@/runtime/browser-runtime";
import type { MissionStatus } from "../../../shared/mission/contracts";

let _bridgeInitialised = false;

/**
 * Previous workflow status/stage tracked per workflow so we only fire
 * lifecycle hooks on actual transitions.
 */
const _prevWorkflowState = new Map<
  string,
  { status: string | undefined; stage: string | undefined }
>();

/**
 * Initialise the snapshot ↔ mission lifecycle bridge.
 *
 * Safe to call multiple times — only the first invocation takes effect.
 *
 * What it does:
 * 1. Registers `globalThis.__snapshotZustandAccessor` so buildCollectState
 *    can read the current Zustand slice without circular imports.
 * 2. Registers `globalThis.__snapshotRestoreZustand` so the recovery flow
 *    can write back into the Zustand store.
 * 3. Registers `globalThis.__snapshotRestoreScene` for 3D scene recovery.
 * 4. Registers a mission provider via `globalThis.__snapshotRegisterMissionProvider`.
 * 5. Subscribes to workflow-store events to detect mission status/stage
 *    transitions and call onMissionStatusChange / onMissionStageChange.
 */
export function initSnapshotLifecycleBridge(): void {
  if (_bridgeInitialised) return;
  _bridgeInitialised = true;

  // ---- 1. Zustand accessor (read) ----------------------------------------
  (globalThis as any).__snapshotZustandAccessor = () => {
    const state = useAppStore.getState();
    return {
      runtimeMode: state.runtimeMode,
      aiConfig: state.aiConfig,
      chatMessages: state.chatMessages,
    };
  };

  // ---- 2. Zustand restore (write) ----------------------------------------
  (globalThis as any).__snapshotRestoreZustand = (slice: {
    runtimeMode: string;
    aiConfig: any;
    chatMessages: any[];
  }) => {
    const store = useAppStore;
    store.setState({
      runtimeMode: slice.runtimeMode as "frontend" | "advanced",
      aiConfig: slice.aiConfig,
      chatMessages: slice.chatMessages,
    });
  };

  // ---- 3. Scene restore ---------------------------------------------------
  (globalThis as any).__snapshotRestoreScene = (layout: {
    cameraPosition: [number, number, number];
    cameraTarget: [number, number, number];
    selectedPet: string | null;
  }) => {
    // The 3D scene registers its own handler via __sceneSetRecovering
    // (see Scene3D.tsx). Here we just forward the selectedPet to the
    // app store; camera positioning is handled by the scene itself if
    // a handler is registered.
    useAppStore.getState().setSelectedPet(layout.selectedPet);

    // Forward to scene-level handler if registered
    const sceneRestore = (globalThis as any).__sceneRestoreLayout as
      | ((layout: any) => void)
      | undefined;
    if (sceneRestore) {
      sceneRestore(layout);
    }
  };

  // ---- 4. Mission provider ------------------------------------------------
  // Register a mission provider that reads the current selected mission
  // from the tasks store. We lazy-import to avoid circular deps.
  registerMissionProvider();

  // ---- 5. Subscribe to workflow-store for status/stage transitions ---------
  subscribeToWorkflowEvents();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function registerMissionProvider(): void {
  const register = (globalThis as any).__snapshotRegisterMissionProvider as
    | ((provider: () => any) => void)
    | undefined;

  if (!register) {
    // Runtime not initialised yet — defer until it is.
    // This can happen if the bridge is initialised before
    // createBrowserRuntime(). We'll retry once on the next tick.
    setTimeout(() => {
      const retryRegister = (globalThis as any)
        .__snapshotRegisterMissionProvider as
        | ((provider: () => any) => void)
        | undefined;
      if (retryRegister) {
        retryRegister(buildMissionProvider());
      }
    }, 0);
    return;
  }

  register(buildMissionProvider());
}

/**
 * Build a mission provider function that returns the currently active
 * MissionRecord from the tasks store. In frontend mode the "mission"
 * is synthesised from the workflow data, so we derive a minimal
 * MissionRecord-compatible object.
 */
function buildMissionProvider(): () => any {
  return () => {
    // Lazy-require to avoid circular dependency at module load time.
    // The tasks-store is always loaded by the time missions run.
    try {
      const { useTasksStore } = require("./tasks-store") as {
        useTasksStore: { getState: () => any };
      };
      const tasksState = useTasksStore.getState();
      const selectedId = tasksState.selectedTaskId;
      if (!selectedId) return null;

      const detail = tasksState.detailsById?.[selectedId];
      if (!detail) return null;

      // The detail record contains the mission-level data we need.
      // Map it to a MissionRecord-compatible shape.
      return {
        id: detail.id,
        kind: detail.kind ?? "",
        title: detail.title ?? "",
        status: mapToMissionStatus(detail.status),
        progress: detail.progress ?? 0,
        stages: detail.stages ?? [],
        createdAt: detail.createdAt ?? Date.now(),
        updatedAt: detail.updatedAt ?? Date.now(),
        events: [],
        artifacts: detail.artifacts ?? [],
        decision: detail.decision ?? undefined,
        currentStageKey: detail.currentStageKey ?? undefined,
        sourceText: detail.sourceText ?? detail.title ?? "",
      };
    } catch {
      return null;
    }
  };
}

function mapToMissionStatus(status: string | undefined): MissionStatus {
  switch (status) {
    case "running":
    case "waiting":
    case "done":
    case "failed":
    case "queued":
      return status;
    case "completed":
      return "done";
    default:
      return "queued";
  }
}

/**
 * Subscribe to workflow-store changes and fire snapshot lifecycle hooks
 * when a workflow's status or stage changes.
 */
function subscribeToWorkflowEvents(): void {
  useWorkflowStore.subscribe((state, prevState) => {
    // --- Stage changes (from eventLog) ---
    if (state.eventLog !== prevState.eventLog && state.eventLog.length > 0) {
      const latest = state.eventLog[state.eventLog.length - 1];
      if (latest?.type === "stage_change") {
        onMissionStageChange();
      }
    }

    // --- Workflow status transitions ---
    // Check currentWorkflow for status changes
    const curr = state.currentWorkflow;
    const prev = prevState.currentWorkflow;

    if (curr && curr.id) {
      const prevTracked = _prevWorkflowState.get(curr.id);
      const currStatus = curr.status;
      const currStage = curr.current_stage;

      if (
        !prevTracked ||
        prevTracked.status !== currStatus ||
        prevTracked.stage !== currStage
      ) {
        _prevWorkflowState.set(curr.id, {
          status: currStatus,
          stage: currStage ?? undefined,
        });

        // Fire status change hook
        if (!prevTracked || prevTracked.status !== currStatus) {
          const missionStatus = mapToMissionStatus(currStatus);
          onMissionStatusChange(curr.id, missionStatus);
        }

        // Fire stage change hook (if stage changed but not already caught above)
        if (
          prevTracked &&
          prevTracked.stage !== currStage &&
          prevTracked.status === currStatus
        ) {
          onMissionStageChange();
        }
      }
    }

    // Clean up tracking for workflows that are no longer current
    if (prev && prev.id && (!curr || curr.id !== prev.id)) {
      _prevWorkflowState.delete(prev.id);
    }
  });
}
