import { afterEach, describe, expect, it, vi } from "vitest";

const originalValue = process.env.PAPER_STARTING_CAPITAL_USD;

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.PAPER_STARTING_CAPITAL_USD;
  } else {
    process.env.PAPER_STARTING_CAPITAL_USD = originalValue;
  }
  vi.resetModules();
});

describe("env config paper starting capital", () => {
  it("falls back to 5000 when missing", async () => {
    delete process.env.PAPER_STARTING_CAPITAL_USD;
    vi.resetModules();
    const { config } = await import("../src/config/env");
    expect(config.paperStartingCapitalUsd).toBe(5000);
  });

  it("falls back to 5000 when invalid", async () => {
    process.env.PAPER_STARTING_CAPITAL_USD = "invalid";
    vi.resetModules();
    const { config } = await import("../src/config/env");
    expect(config.paperStartingCapitalUsd).toBe(5000);
  });

  it("parses a valid numeric capital value", async () => {
    process.env.PAPER_STARTING_CAPITAL_USD = "7500";
    vi.resetModules();
    const { config } = await import("../src/config/env");
    expect(config.paperStartingCapitalUsd).toBe(7500);
  });
});
