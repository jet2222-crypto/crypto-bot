import { sendConsoleAlert } from "./consoleAlert";
import { nowIso } from "../utils/time";

export type AlertMode = "console" | "webhook" | "telegram";
export type AlertEvent =
  | "BOT_STARTUP"
  | "POSITION_OPENED"
  | "POSITION_CLOSED"
  | "API_FALLBACK_MOCK"
  | "RUNTIME_ERROR"
  | "DEGRADED_MODE_ON"
  | "DEGRADED_MODE_OFF";

export type AlertContext = {
  enabled: boolean;
  mode: AlertMode;
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
};

export type AlertMessage = {
  event: AlertEvent;
  title: string;
  message: string;
  meta?: Record<string, string | number | boolean | undefined>;
};

type AlertPayload = {
  timestamp: string;
  event: AlertEvent;
  title: string;
  message: string;
  meta?: Record<string, string | number | boolean | undefined>;
};

async function resolveFetch(): Promise<typeof fetch> {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  const undici = await import("undici");
  return undici.fetch as unknown as typeof fetch;
}

export function formatAlertMessage(input: AlertMessage): string {
  const metaPairs = Object.entries(input.meta ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  const metaBlock = metaPairs.length > 0 ? ` | ${metaPairs.join(" ")}` : "";
  return `${input.title}: ${input.message}${metaBlock}`;
}

function toPayload(input: AlertMessage): AlertPayload {
  return {
    timestamp: nowIso(),
    event: input.event,
    title: input.title,
    message: input.message,
    meta: input.meta
  };
}

async function postJson(url: string, body: unknown): Promise<void> {
  const fetchFn = await resolveFetch();
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

async function sendWebhookAlert(webhookUrl: string, payload: AlertPayload): Promise<void> {
  await postJson(webhookUrl, payload);
}

async function sendTelegramAlert(botToken: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  await postJson(url, {
    chat_id: chatId,
    text
  });
}

export async function sendAlert(context: AlertContext, input: AlertMessage): Promise<void> {
  if (!context.enabled) {
    return;
  }

  const formatted = formatAlertMessage(input);
  const payload = toPayload(input);

  try {
    if (context.mode === "webhook") {
      if (!context.webhookUrl) {
        sendConsoleAlert(`[ALERT-WARN] ALERT_WEBHOOK_URL missing. ${formatted}`);
        return;
      }
      await sendWebhookAlert(context.webhookUrl, payload);
      return;
    }

    if (context.mode === "telegram") {
      if (!context.telegramBotToken || !context.telegramChatId) {
        sendConsoleAlert(`[ALERT-WARN] Telegram credentials missing. ${formatted}`);
        return;
      }
      await sendTelegramAlert(context.telegramBotToken, context.telegramChatId, formatted);
      return;
    }

    sendConsoleAlert(formatted);
  } catch (cause) {
    sendConsoleAlert(
      `[ALERT-WARN] Failed to send ${input.event} via ${context.mode}: ${
        cause instanceof Error ? cause.message : "unknown"
      }`
    );
  }
}
