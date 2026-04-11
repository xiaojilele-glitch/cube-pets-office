import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("fetchJsonSafe", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("classifies network failures as offline in advanced mode", async () => {
    const { useAppStore } = await import("./store");
    useAppStore.setState({ runtimeMode: "advanced" });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const { fetchJsonSafe } = await import("./api-client");
    const result = await fetchJsonSafe("/api/audit/events");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("offline");
    expect(result.error.source).toBe("network");
  });

  it("classifies HTML fallbacks as demo mode in frontend mode", async () => {
    const { useAppStore } = await import("./store");
    useAppStore.setState({ runtimeMode: "frontend" });
    fetchMock.mockResolvedValueOnce(
      new Response("<!doctype html><html><body>fallback</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );

    const { fetchJsonSafe } = await import("./api-client");
    const result = await fetchJsonSafe("/api/lineage?limit=10");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("demo");
    expect(result.error.source).toBe("html-fallback");
  });

  it("keeps structured server errors out of raw parser failures", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "Policy not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { fetchJsonSafe } = await import("./api-client");
    const result = await fetchJsonSafe("/api/permissions/policies/agent-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("error");
    expect(result.error.message).toBe("Policy not found");
  });

  it("returns parsed JSON data for successful responses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, roles: [{ roleId: "admin" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { fetchJsonSafe } = await import("./api-client");
    const result = await fetchJsonSafe<{
      ok: true;
      roles: Array<{ roleId: string }>;
    }>("/api/permissions/roles");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.roles[0]?.roleId).toBe("admin");
  });
});
