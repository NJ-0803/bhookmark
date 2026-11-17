import { Pool } from "@neondatabase/serverless";
import { Router } from "express";
import { createWhatsAppLinkRouter } from "../whatsapp/linkRoutes";
import { searchLocal } from "../restaurants";
import { createWhatsAppExecution, type QueryClient, type TransactionDatabase } from "../whatsapp/execution";
import { createTelegramRouter } from "./adapter";

/** Bot API sender. Only built when sends are explicitly enabled. */
export function createTelegramSender(token: string, fetchImpl: typeof fetch = fetch) {
  if (!/^\d{3,20}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error("Invalid bot token format");
  return async (chatId: string, text: string, buttons?: { text: string; data?: string; url?: string }[][]) => {
    if (!/^[1-9]\d{0,15}$/.test(chatId)) throw new Error("Invalid chat id");
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: Number(chatId), text: text.slice(0, 4000), disable_web_page_preview: true,
        ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons.map(r => r.map(b => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))) } } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    // never log token or body. `status` lets the webhook decide whether a retry can help.
    if (!res.ok) throw Object.assign(new Error(`Telegram sendMessage failed (${res.status})`), { status: res.status });
  };
}

/** Acknowledges a button press so the client stops showing a spinner. */
export function createTelegramAnswerer(token: string, fetchImpl: typeof fetch = fetch) {
  if (!/^\d{3,20}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error("Invalid bot token format");
  return async (callbackQueryId: string) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Telegram answerCallbackQuery failed (${res.status})`);
  };
}

/** Interactive transactions need a real connection pool; the neon HTTP client cannot do them. */
export function createPoolDatabase(url: string): TransactionDatabase {
  const pool = new Pool({ connectionString: url, max: 3 });
  // A stuck lock or slow statement fails fast (503, Telegram retries) instead of hanging the function.
  return { async transaction(run) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      const out = await run({ query: async (t: string, p?: any[]) => ({ rows: (await client.query(t, p)).rows }) } as QueryClient);
      await client.query("COMMIT");
      return out;
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  } };
}

const positive = (v: string | undefined, fallback: number) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : fallback);

/** Off unless BHOOKMARK_TELEGRAM=1 and all secrets are present. Sending needs BHOOKMARK_TELEGRAM_SEND=1 as well.
 * Enabling in production is a deliberate deployment decision made outside this code.
 * Routes: POST /webhook (Telegram), and the signed-in website linking API under /link. */
export function createTelegramRouterFromEnv(env = process.env): Router {
  const enabled = env.BHOOKMARK_TELEGRAM === "1" && !!env.DATABASE_URL;
  const botToken = env.TELEGRAM_BOT_TOKEN ?? "";
  const botId = botToken.split(":")[0] ?? "";
  if (!enabled) return Router().use((_req, res) => res.sendStatus(404));
  // New behaviour is opt-in so the deployed bot is unchanged until the matching migration
  // (server/migrations/telegram-conversation.sql) has been applied and tested on staging.
  const engine = createWhatsAppExecution(createPoolDatabase(env.DATABASE_URL!), async q => (await searchLocal(q)).restaurants, Date.now, Number(env.TELEGRAM_MONTHLY_REPLY_CAP ?? 20000), {
    locking: env.TELEGRAM_LOCKING === "fine" ? "fine" : "global",
    conversation: env.TELEGRAM_CONVERSATION === "1",
    // Receipt wording is staging-safe unless production is explicitly declared.
    production: env.TELEGRAM_ENV_LABEL === "production",
    linkUrl: /^https:\/\/[^\s]+$/.test(env.TELEGRAM_LINK_URL ?? "") ? env.TELEGRAM_LINK_URL : undefined,
    senderLimits: env.TELEGRAM_SENDER_LIMITS === "1" ? { perMinute: positive(env.TELEGRAM_PER_MINUTE, 12), perDay: positive(env.TELEGRAM_PER_DAY, 300) } : null,
    // Counts and timings only. Never message text, ids or tokens.
    onEvent: e => console.log(JSON.stringify({ app: "bhookmark-telegram", ...e })),
  });
  const botUsername = /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(env.TELEGRAM_BOT_USERNAME ?? "") ? env.TELEGRAM_BOT_USERNAME! : null;
  const router = Router();
  // Public and harmless: lets the website know whether and where to send people.
  router.get("/link/config", (_req, res) => { res.set("Cache-Control", "no-store"); return botUsername ? res.json({ ok: true, botUsername }) : res.sendStatus(404); });
  router.use("/link", createWhatsAppLinkRouter(engine, !!botUsername, true));
  router.use(createTelegramRouter({
    enabled, secretToken: env.TELEGRAM_WEBHOOK_SECRET ?? "", botId,
    execute: m => engine.process(m),
    send: env.BHOOKMARK_TELEGRAM_SEND === "1" ? createTelegramSender(botToken) : undefined,
    answer: env.BHOOKMARK_TELEGRAM_SEND === "1" ? createTelegramAnswerer(botToken) : undefined,
    onError: e => console.error(JSON.stringify({ app: "bhookmark-telegram", event: "error", name: (e as Error)?.name, code: (e as { code?: string })?.code, status: (e as { status?: number })?.status })),
  }));
  return router;
}
