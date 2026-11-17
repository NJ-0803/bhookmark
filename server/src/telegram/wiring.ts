import { Pool } from "@neondatabase/serverless";
import { Router } from "express";
import { createWhatsAppLinkRouter } from "../whatsapp/linkRoutes";
import { searchLocal } from "../restaurants";
import { createWhatsAppExecution, type QueryClient, type TransactionDatabase } from "../whatsapp/execution";
import { createTelegramRouter } from "./adapter";

/** Bot API sender. Only built when sends are explicitly enabled. */
export function createTelegramSender(token: string, fetchImpl: typeof fetch = fetch) {
  if (!/^\d{3,20}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error("Invalid bot token format");
  return async (chatId: string, text: string) => {
    if (!/^[1-9]\d{0,15}$/.test(chatId)) throw new Error("Invalid chat id");
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: Number(chatId), text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage failed (${res.status})`); // never log token or body
  };
}

/** Interactive transactions need a real connection pool; the neon HTTP client cannot do them. */
export function createPoolDatabase(url: string): TransactionDatabase {
  const pool = new Pool({ connectionString: url, max: 3 });
  return { async transaction(run) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await run({ query: async (t: string, p?: any[]) => ({ rows: (await client.query(t, p)).rows }) } as QueryClient);
      await client.query("COMMIT");
      return out;
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  } };
}

/** Off unless BHOOKMARK_TELEGRAM=1 and all secrets are present. Sending needs BHOOKMARK_TELEGRAM_SEND=1 as well.
 * Enabling in production is a deliberate deployment decision made outside this code.
 * Routes: POST /webhook (Telegram), and the signed-in website linking API under /link. */
export function createTelegramRouterFromEnv(env = process.env): Router {
  const enabled = env.BHOOKMARK_TELEGRAM === "1" && !!env.DATABASE_URL;
  const botToken = env.TELEGRAM_BOT_TOKEN ?? "";
  const botId = botToken.split(":")[0] ?? "";
  if (!enabled) return Router().use((_req, res) => res.sendStatus(404));
  const engine = createWhatsAppExecution(createPoolDatabase(env.DATABASE_URL!), async q => (await searchLocal(q)).restaurants, Date.now, Number(env.TELEGRAM_MONTHLY_REPLY_CAP ?? 20000));
  const botUsername = /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(env.TELEGRAM_BOT_USERNAME ?? "") ? env.TELEGRAM_BOT_USERNAME! : null;
  const router = Router();
  // Public and harmless: lets the website know whether and where to send people.
  router.get("/link/config", (_req, res) => { res.set("Cache-Control", "no-store"); return botUsername ? res.json({ ok: true, botUsername }) : res.sendStatus(404); });
  router.use("/link", createWhatsAppLinkRouter(engine, !!botUsername, true));
  router.use(createTelegramRouter({
    enabled, secretToken: env.TELEGRAM_WEBHOOK_SECRET ?? "", botId,
    execute: m => engine.process(m),
    send: env.BHOOKMARK_TELEGRAM_SEND === "1" ? createTelegramSender(botToken) : undefined,
  }));
  return router;
}
