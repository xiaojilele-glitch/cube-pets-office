/**
 * Cost REST API unit tests.
 *
 * Tests the cost route handlers by creating a minimal Express app
 * and exercising each endpoint with mock HTTP calls.
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */
import { describe, expect, it, beforeEach } from "vitest";
import express from "express";
import costRouter from "../routes/cost.js";
import { costTracker } from "../core/cost-tracker.js";
import { estimateCost, DEFAULT_BUDGET } from "../../shared/cost.js";
import type {
  CostSnapshot,
  Budget,
  MissionCostSummary,
} from "../../shared/cost.js";

/** Create a minimal Express app with the cost router */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/cost", costRouter);
  return app;
}

/** Helper to make requests against the Express app without supertest */
async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        return reject(new Error("Failed to get server address"));
      }
      const url = `http://127.0.0.1:${addr.port}${path}`;
      const options: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      fetch(url, options)
        .then(async res => {
          const json = await res.json().catch(() => null);
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch(err => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("Cost REST API", () => {
  beforeEach(() => {
    // Reset tracker state between tests
    costTracker.resetCurrentMission();
    costTracker.setBudget({ ...DEFAULT_BUDGET });
    costTracker.manualReleaseDegradation();
  });

  describe("GET /api/cost/live", () => {
    it("should return a zero-value snapshot when no mission is active", async () => {
      const app = createApp();
      const res = await request(app, "GET", "/api/cost/live");

      expect(res.status).toBe(200);
      const snap = res.body as CostSnapshot;
      expect(snap.totalTokensIn).toBe(0);
      expect(snap.totalTokensOut).toBe(0);
      expect(snap.totalCost).toBe(0);
      expect(snap.totalCalls).toBe(0);
      expect(snap.agentCosts).toEqual([]);
    });

    it("should return updated snapshot after recording calls", async () => {
      costTracker.recordCall({
        id: "test-1",
        timestamp: Date.now(),
        model: "gpt-4o-mini",
        tokensIn: 500,
        tokensOut: 200,
        unitPriceIn: 0.00015,
        unitPriceOut: 0.0006,
        actualCost: estimateCost("gpt-4o-mini", 500, 200),
        durationMs: 100,
        agentId: "agent-a",
      });

      const app = createApp();
      const res = await request(app, "GET", "/api/cost/live");

      expect(res.status).toBe(200);
      const snap = res.body as CostSnapshot;
      expect(snap.totalTokensIn).toBe(500);
      expect(snap.totalTokensOut).toBe(200);
      expect(snap.totalCalls).toBe(1);
      expect(snap.agentCosts.length).toBe(1);
      expect(snap.agentCosts[0].agentId).toBe("agent-a");
    });
  });

  describe("GET /api/cost/history", () => {
    it("should return empty array when no missions finalized", async () => {
      const app = createApp();
      const res = await request(app, "GET", "/api/cost/history");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /api/cost/budget", () => {
    it("should return current budget configuration", async () => {
      const app = createApp();
      const res = await request(app, "GET", "/api/cost/budget");

      expect(res.status).toBe(200);
      const budget = res.body as Budget;
      expect(budget.maxCost).toBe(DEFAULT_BUDGET.maxCost);
      expect(budget.maxTokens).toBe(DEFAULT_BUDGET.maxTokens);
      expect(budget.warningThreshold).toBe(DEFAULT_BUDGET.warningThreshold);
    });
  });

  describe("PUT /api/cost/budget", () => {
    it("should update budget and return new values", async () => {
      const app = createApp();
      const newBudget = {
        maxCost: 5.0,
        maxTokens: 50000,
        warningThreshold: 0.7,
      };
      const res = await request(app, "PUT", "/api/cost/budget", newBudget);

      expect(res.status).toBe(200);
      const budget = res.body as Budget;
      expect(budget.maxCost).toBe(5.0);
      expect(budget.maxTokens).toBe(50000);
      expect(budget.warningThreshold).toBe(0.7);
    });

    it("should return 400 for invalid budget (missing fields)", async () => {
      const app = createApp();
      const res = await request(app, "PUT", "/api/cost/budget", {
        maxCost: 1.0,
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid budget (negative values)", async () => {
      const app = createApp();
      const res = await request(app, "PUT", "/api/cost/budget", {
        maxCost: -1,
        maxTokens: 1000,
        warningThreshold: 0.8,
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/cost/downgrade/release", () => {
    it("should release degradation and return none level", async () => {
      const app = createApp();
      const res = await request(app, "POST", "/api/cost/downgrade/release");

      expect(res.status).toBe(200);
      const body = res.body as { ok: boolean; downgradeLevel: string };
      expect(body.ok).toBe(true);
      expect(body.downgradeLevel).toBe("none");
    });
  });
});
