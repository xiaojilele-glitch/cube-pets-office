import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "./store";

describe("mission-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({ runtimeMode: "advanced" });
  });

  it("throws a structured error when the mission API returns an HTML fallback page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><body>fallback</body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      })
    );

    const { MissionApiError, getMissionApiError, listMissions } = await import(
      "./mission-client"
    );

    let thrown: unknown;
    try {
      await listMissions();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MissionApiError);
    const requestError = getMissionApiError(thrown);
    expect(requestError?.source).toBe("html-fallback");
    expect(requestError?.message).not.toContain("Unexpected token");
    expect(requestError?.detail).toContain("backend");
  });

  it("returns parsed JSON for successful mission responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, tasks: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    );

    const { listMissions } = await import("./mission-client");
    await expect(listMissions()).resolves.toEqual({ ok: true, tasks: [] });
  });
});
