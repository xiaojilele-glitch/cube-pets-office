import { useEffect } from "react";

import { useAppStore } from "@/lib/store";
import { useWorkflowStore } from "@/lib/workflow-store";

export function useWorkflowRuntimeBootstrap({
  heartbeatReportLimit = 12,
  deferSecondary = false,
}: {
  heartbeatReportLimit?: number;
  deferSecondary?: boolean;
} = {}) {
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const initSocket = useWorkflowStore(state => state.initSocket);
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const fetchAgents = useWorkflowStore(state => state.fetchAgents);
  const fetchStages = useWorkflowStore(state => state.fetchStages);
  const fetchWorkflows = useWorkflowStore(state => state.fetchWorkflows);
  const fetchHeartbeatStatuses = useWorkflowStore(
    state => state.fetchHeartbeatStatuses
  );
  const fetchHeartbeatReports = useWorkflowStore(
    state => state.fetchHeartbeatReports
  );

  useEffect(() => {
    let timeoutId: number | null = null;

    if (runtimeMode === "advanced") {
      void initSocket();
    } else {
      disconnectSocket();
    }

    void fetchAgents();
    void fetchStages();
    void fetchWorkflows();
    void fetchHeartbeatStatuses();

    const loadSecondary = () => {
      void fetchHeartbeatReports(undefined, heartbeatReportLimit);
    };

    if (deferSecondary && typeof window !== "undefined") {
      timeoutId = window.setTimeout(loadSecondary, 700);
    } else {
      loadSecondary();
    }

    return () => {
      if (timeoutId !== null && typeof window !== "undefined") {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    deferSecondary,
    disconnectSocket,
    fetchAgents,
    fetchHeartbeatReports,
    fetchHeartbeatStatuses,
    fetchStages,
    fetchWorkflows,
    heartbeatReportLimit,
    initSocket,
    runtimeMode,
  ]);
}
