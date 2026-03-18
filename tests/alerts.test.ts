import { describe, expect, it } from "vitest";
import { formatAlertMessage, sendAlert } from "../src/alerts";

describe("alerts formatting", () => {
  it("formats alert messages with meta fields", () => {
    const text = formatAlertMessage({
      event: "POSITION_OPENED",
      title: "Paper position opened",
      message: "BTC_USDT opened",
      meta: {
        instrument: "BTC_USDT",
        quantity: 0.1
      }
    });

    expect(text).toContain("Paper position opened: BTC_USDT opened");
    expect(text).toContain("instrument=BTC_USDT");
    expect(text).toContain("quantity=0.1");
  });
});

describe("alerts non-fatal behavior", () => {
  it("does not throw when telegram mode is enabled but credentials are missing", async () => {
    await expect(
      sendAlert(
        {
          enabled: true,
          mode: "telegram"
        },
        {
          event: "BOT_STARTUP",
          title: "Startup",
          message: "Bot started"
        }
      )
    ).resolves.toBeUndefined();
  });

  it("does nothing when alerts are disabled", async () => {
    await expect(
      sendAlert(
        {
          enabled: false,
          mode: "console"
        },
        {
          event: "BOT_STARTUP",
          title: "Startup",
          message: "Bot started"
        }
      )
    ).resolves.toBeUndefined();
  });
});
