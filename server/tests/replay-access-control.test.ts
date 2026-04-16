import { describe, expect, it, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

import {
  replayAccessControl,
  registerMissionOwner,
} from "../replay/access-control.js";

function mockReq(
  headers: Record<string, string>,
  params: Record<string, string> = {}
): Request {
  return { headers, params } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("replayAccessControl", () => {
  beforeEach(() => {
    // Register a known mission owner for tests
    registerMissionOwner("mission-owned", "owner-user");
  });

  it("returns 401 when x-user-id header is missing", () => {
    const req = mockReq({}, { missionId: "mission-1" });
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    replayAccessControl(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("allows admin access to any mission", () => {
    const req = mockReq(
      { "x-user-id": "admin-user", "x-user-role": "admin" },
      { missionId: "mission-owned" }
    );
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    replayAccessControl(req, res, next);

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("allows owner to access their own mission", () => {
    const req = mockReq(
      { "x-user-id": "owner-user" },
      { missionId: "mission-owned" }
    );
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    replayAccessControl(req, res, next);

    expect(nextCalled).toBe(true);
  });

  it("denies non-owner regular user access", () => {
    const req = mockReq(
      { "x-user-id": "other-user" },
      { missionId: "mission-owned" }
    );
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    replayAccessControl(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(nextCalled).toBe(false);
  });

  it("allows access when no owner is registered for the mission", () => {
    const req = mockReq(
      { "x-user-id": "any-user" },
      { missionId: "untracked-mission" }
    );
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    replayAccessControl(req, res, next);

    expect(nextCalled).toBe(true);
  });

  it("allows access when no missionId param is present", () => {
    const req = mockReq({ "x-user-id": "any-user" }, {});
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    replayAccessControl(req, res, next);

    expect(nextCalled).toBe(true);
  });
});
