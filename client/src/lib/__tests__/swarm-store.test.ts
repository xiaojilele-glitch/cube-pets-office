/**
 * Unit tests for swarm-store.
 *
 * Validates Zustand collaboration state management:
 * - activeSessions CRUD and cap at 20
 * - crossPodMessages append and cap at 50
 * - initSocket wires Socket.IO events correctly
 *
 * @see Requirements 7.1, 7.2, 7.5
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useSwarmStore } from "../swarm-store";
import type { CollaborationSession } from "@shared/swarm";
import type { CrossPodMessageEvent } from "../swarm-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  id: string,
  status: CollaborationSession["status"] = "active"
): CollaborationSession {
  return {
    id,
    request: {
      id: `req-${id}`,
      sourcePodId: "pod-a",
      sourceManagerId: "mgr-a",
      requiredCapabilities: ["cap1"],
      contextSummary: "test",
      depth: 1,
      workflowId: "wf-1",
      createdAt: Date.now(),
    },
    status,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeMessage(messageId: number): CrossPodMessageEvent {
  return {
    sourcePodId: "pod-a",
    targetPodId: "pod-b",
    contentPreview: `msg-${messageId}`,
    messageId,
    receivedAt: Date.now(),
  };
}

// Reset store between tests
beforeEach(() => {
  useSwarmStore.setState({
    activeSessions: [],
    crossPodMessages: [],
  });
});

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

describe("activeSessions management", () => {
  it("addSession appends a session", () => {
    const session = makeSession("s1");
    useSwarmStore.getState().addSession(session);
    expect(useSwarmStore.getState().activeSessions).toHaveLength(1);
    expect(useSwarmStore.getState().activeSessions[0].id).toBe("s1");
  });

  it("updateSession merges partial update", () => {
    const session = makeSession("s1", "pending");
    useSwarmStore.getState().addSession(session);
    useSwarmStore.getState().updateSession("s1", { status: "active" });
    expect(useSwarmStore.getState().activeSessions[0].status).toBe("active");
  });

  it("removeSession removes by id", () => {
    useSwarmStore.getState().addSession(makeSession("s1"));
    useSwarmStore.getState().addSession(makeSession("s2"));
    useSwarmStore.getState().removeSession("s1");
    expect(useSwarmStore.getState().activeSessions).toHaveLength(1);
    expect(useSwarmStore.getState().activeSessions[0].id).toBe("s2");
  });

  it("caps activeSessions at 20, trimming oldest", () => {
    for (let i = 0; i < 25; i++) {
      useSwarmStore.getState().addSession(makeSession(`s${i}`));
    }
    const sessions = useSwarmStore.getState().activeSessions;
    expect(sessions).toHaveLength(20);
    // Oldest 5 (s0-s4) should be trimmed
    expect(sessions[0].id).toBe("s5");
    expect(sessions[19].id).toBe("s24");
  });
});

// ---------------------------------------------------------------------------
// CrossPodMessages management
// ---------------------------------------------------------------------------

describe("crossPodMessages management", () => {
  it("addCrossPodMessage appends a message", () => {
    useSwarmStore.getState().addCrossPodMessage(makeMessage(1));
    expect(useSwarmStore.getState().crossPodMessages).toHaveLength(1);
  });

  it("caps crossPodMessages at 50, trimming oldest", () => {
    for (let i = 0; i < 55; i++) {
      useSwarmStore.getState().addCrossPodMessage(makeMessage(i));
    }
    const msgs = useSwarmStore.getState().crossPodMessages;
    expect(msgs).toHaveLength(50);
    // Oldest 5 (0-4) should be trimmed
    expect(msgs[0].messageId).toBe(5);
    expect(msgs[49].messageId).toBe(54);
  });
});

// ---------------------------------------------------------------------------
// Socket.IO integration
// ---------------------------------------------------------------------------

describe("initSocket", () => {
  it("wires cross_pod_message event to addCrossPodMessage", () => {
    const handlers: Record<string, Function> = {};
    const fakeSocket = {
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
    };

    useSwarmStore.getState().initSocket(fakeSocket as any);

    expect(fakeSocket.on).toHaveBeenCalledWith(
      "cross_pod_message",
      expect.any(Function)
    );

    // Simulate event
    const msg = makeMessage(42);
    handlers["cross_pod_message"](msg);
    expect(useSwarmStore.getState().crossPodMessages).toHaveLength(1);
    expect(useSwarmStore.getState().crossPodMessages[0].messageId).toBe(42);
  });

  it("wires collaboration_session_update to addSession for new sessions", () => {
    const handlers: Record<string, Function> = {};
    const fakeSocket = {
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
    };

    useSwarmStore.getState().initSocket(fakeSocket as any);

    expect(fakeSocket.on).toHaveBeenCalledWith(
      "collaboration_session_update",
      expect.any(Function)
    );

    // Simulate new session event
    const session = makeSession("new-1");
    handlers["collaboration_session_update"](session);
    expect(useSwarmStore.getState().activeSessions).toHaveLength(1);
    expect(useSwarmStore.getState().activeSessions[0].id).toBe("new-1");
  });

  it("wires collaboration_session_update to updateSession for existing sessions", () => {
    // Pre-populate a session
    useSwarmStore.getState().addSession(makeSession("existing-1", "pending"));

    const handlers: Record<string, Function> = {};
    const fakeSocket = {
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
    };

    useSwarmStore.getState().initSocket(fakeSocket as any);

    // Simulate update event for existing session
    const updated = makeSession("existing-1", "active");
    handlers["collaboration_session_update"](updated);

    const sessions = useSwarmStore.getState().activeSessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("active");
  });
});
