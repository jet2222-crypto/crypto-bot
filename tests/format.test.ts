import { describe, expect, it } from "vitest";
import { formatPrice } from "../src/utils/format";

describe("formatPrice", () => {
  it("formats normal prices with two decimals", () => {
    expect(formatPrice(123.456)).toBe("123.46");
  });

  it("formats very small prices with meaningful precision", () => {
    expect(formatPrice(0.00003456)).toBe("0.00003456");
  });

  it("formats tiny prices without scientific notation when possible", () => {
    expect(formatPrice(0.000000123456)).toBe("0.000000123456");
  });

  it("formats large prices with separators", () => {
    expect(formatPrice(12345.678)).toBe("12,345.68");
  });
});
