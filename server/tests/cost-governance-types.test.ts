/**
 * 成本治理共享类型 — 单元测试
 *
 * 测试 convertCurrency 工具函数和常量定义的正确性。
 */
import { describe, it, expect } from "vitest";
import {
  convertCurrency,
  EXCHANGE_RATES,
  CONCURRENCY_LIMITS,
  RATE_LIMITS,
  DOWNGRADE_CHAIN,
  DEFAULT_BUDGET_TEMPLATES,
} from "../../shared/cost-governance";
import type {
  Currency,
  ConcurrencyLevel,
  RateLevel,
  BudgetTemplate,
} from "../../shared/cost-governance";

// ---------------------------------------------------------------------------
// convertCurrency
// ---------------------------------------------------------------------------
describe("convertCurrency", () => {
  it("should return the same amount when from === to (USD)", () => {
    expect(convertCurrency(100, "USD", "USD")).toBe(100);
  });

  it("should return the same amount when from === to (CNY)", () => {
    expect(convertCurrency(42.5, "CNY", "CNY")).toBe(42.5);
  });

  it("should convert USD to CNY using the fixed rate", () => {
    const result = convertCurrency(10, "USD", "CNY");
    expect(result).toBeCloseTo(10 * 7.2, 10);
  });

  it("should convert CNY to USD using the fixed rate", () => {
    const result = convertCurrency(72, "CNY", "USD");
    expect(result).toBeCloseTo(72 * (1 / 7.2), 10);
  });

  it("should handle zero amount", () => {
    expect(convertCurrency(0, "USD", "CNY")).toBe(0);
    expect(convertCurrency(0, "CNY", "USD")).toBe(0);
  });

  it("should handle very small amounts", () => {
    const result = convertCurrency(0.001, "USD", "CNY");
    expect(result).toBeCloseTo(0.001 * 7.2, 10);
  });

  it("should handle negative amounts (debt/refund)", () => {
    const result = convertCurrency(-50, "USD", "CNY");
    expect(result).toBeCloseTo(-50 * 7.2, 10);
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------
describe("EXCHANGE_RATES", () => {
  it("should contain USD_TO_CNY and CNY_TO_USD", () => {
    expect(EXCHANGE_RATES).toHaveProperty("USD_TO_CNY");
    expect(EXCHANGE_RATES).toHaveProperty("CNY_TO_USD");
  });

  it("should have reciprocal rates", () => {
    expect(
      EXCHANGE_RATES["USD_TO_CNY"] * EXCHANGE_RATES["CNY_TO_USD"]
    ).toBeCloseTo(1, 10);
  });
});

describe("CONCURRENCY_LIMITS", () => {
  it("should map all four levels", () => {
    const levels: ConcurrencyLevel[] = ["NORMAL", "LOW", "MINIMAL", "SINGLE"];
    for (const l of levels) {
      expect(CONCURRENCY_LIMITS[l]).toBeDefined();
    }
  });

  it("NORMAL should be Infinity", () => {
    expect(CONCURRENCY_LIMITS.NORMAL).toBe(Infinity);
  });

  it("SINGLE should be 1", () => {
    expect(CONCURRENCY_LIMITS.SINGLE).toBe(1);
  });
});

describe("RATE_LIMITS", () => {
  it("should map all four levels", () => {
    const levels: RateLevel[] = ["NORMAL", "HIGH", "MEDIUM", "LOW"];
    for (const l of levels) {
      expect(RATE_LIMITS[l]).toBeDefined();
    }
  });

  it("NORMAL should be Infinity", () => {
    expect(RATE_LIMITS.NORMAL).toBe(Infinity);
  });

  it("limits should decrease: HIGH > MEDIUM > LOW", () => {
    expect(RATE_LIMITS.HIGH).toBeGreaterThan(RATE_LIMITS.MEDIUM);
    expect(RATE_LIMITS.MEDIUM).toBeGreaterThan(RATE_LIMITS.LOW);
  });
});

describe("DOWNGRADE_CHAIN", () => {
  it("should define the full chain gpt-4o → gpt-4o-mini → glm-4.6 → glm-5-turbo", () => {
    expect(DOWNGRADE_CHAIN["gpt-4o"]).toBe("gpt-4o-mini");
    expect(DOWNGRADE_CHAIN["gpt-4o-mini"]).toBe("glm-4.6");
    expect(DOWNGRADE_CHAIN["glm-4.6"]).toBe("glm-5-turbo");
  });

  it("glm-5-turbo should have no further downgrade target", () => {
    expect(DOWNGRADE_CHAIN["glm-5-turbo"]).toBeUndefined();
  });
});

describe("DEFAULT_BUDGET_TEMPLATES", () => {
  it("should contain at least 2 templates", () => {
    expect(DEFAULT_BUDGET_TEMPLATES.length).toBeGreaterThanOrEqual(2);
  });

  it("each template should have required fields", () => {
    for (const t of DEFAULT_BUDGET_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.defaultBudget).toBeGreaterThan(0);
      expect(t.defaultTokenBudget).toBeGreaterThan(0);
      expect(t.defaultAlertThresholds.length).toBeGreaterThan(0);
    }
  });

  it("alert thresholds should be sorted ascending by percent", () => {
    for (const t of DEFAULT_BUDGET_TEMPLATES) {
      for (let i = 1; i < t.defaultAlertThresholds.length; i++) {
        expect(t.defaultAlertThresholds[i].percent).toBeGreaterThanOrEqual(
          t.defaultAlertThresholds[i - 1].percent
        );
      }
    }
  });
});
