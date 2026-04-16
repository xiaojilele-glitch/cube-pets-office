import { beforeEach, describe, expect, it, vi } from "vitest";

const appendMessageLog = vi.fn();
const emit = vi.fn();
const getAgent = vi.fn();
const getWorkflow = vi.fn();
const createMessage = vi.fn();
const getInbox = vi.fn();
const getMessagesByWorkflow = vi.fn();

vi.mock("../db/index.js", () => ({
  default: {
    getAgent,
    getWorkflow,
    createMessage,
    getInbox,
    getMessagesByWorkflow,
  },
}));

vi.mock("../memory/session-store.js", () => ({
  sessionStore: {
    appendMessageLog,
  },
}));

vi.mock("../core/socket.js", () => ({
  getSocketIO: () => ({
    emit,
  }),
}));

describe("phase1 message bus hardening", () => {
  beforeEach(() => {
    appendMessageLog.mockReset();
    emit.mockReset();
    getAgent.mockReset();
    getWorkflow.mockReset();
    createMessage.mockReset();
    getInbox.mockReset();
    getMessagesByWorkflow.mockReset();

    const agents = {
      ceo: {
        id: "ceo",
        department: "meta",
        role: "ceo",
        manager_id: null,
      },
      pixel: {
        id: "pixel",
        department: "game",
        role: "manager",
        manager_id: "ceo",
      },
      blaze: {
        id: "blaze",
        department: "game",
        role: "worker",
        manager_id: "pixel",
      },
      nexus: {
        id: "nexus",
        department: "ai",
        role: "manager",
        manager_id: "ceo",
      },
    };

    getAgent.mockImplementation((id: keyof typeof agents) => agents[id]);
    getWorkflow.mockReturnValue({ id: "wf-1", status: "running" });
    createMessage.mockImplementation(message => ({
      ...message,
      id: 1,
      created_at: "2026-03-26T00:00:00.000Z",
    }));
    getInbox.mockReturnValue([]);
    getMessagesByWorkflow.mockReturnValue([]);
    vi.resetModules();
  });

  it("allows direct-report communication on the correct stage", async () => {
    const { messageBus } = await import("../core/message-bus.js");

    const result = await messageBus.send(
      "ceo",
      "pixel",
      "focus on gameplay",
      "wf-1",
      "direction"
    );

    expect(result.id).toBe(1);
    expect(createMessage).toHaveBeenCalledOnce();
    expect(appendMessageLog).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      "agent_event",
      expect.objectContaining({
        type: "message_sent",
        from: "ceo",
        to: "pixel",
        stage: "direction",
      })
    );
  });

  it("rejects skip-level messaging", async () => {
    const { messageBus, MessageBusValidationError } =
      await import("../core/message-bus.js");

    await expect(
      messageBus.send("ceo", "blaze", "skip the manager", "wf-1", "direction")
    ).rejects.toBeInstanceOf(MessageBusValidationError);
    await expect(
      messageBus.send("ceo", "blaze", "skip the manager", "wf-1", "direction")
    ).rejects.toMatchObject({ code: "hierarchy_violation" });
  });

  it("rejects mismatched stage routing even for valid hierarchy pairs", async () => {
    const { messageBus } = await import("../core/message-bus.js");

    await expect(
      messageBus.send("pixel", "blaze", "department summary", "wf-1", "summary")
    ).rejects.toMatchObject({ code: "stage_route_violation" });
  });
});
