import { createHash, randomBytes } from "node:crypto";
import { fromRow, type Bookmark, type BookmarkInput } from "../bookmarks";
import { normalized, previewMessage, type ChatRestaurant } from "../chat/preview";
import type { IncomingText } from "./review";
import { advance, type Button, type ConvState } from "../telegram/conversation";

export interface QueryClient { query<T = Record<string, any>>(text: string, params?: any[]): Promise<{ rows: T[] }> }
/** An actual interactive transaction, not a sequence of independent SQL calls. */
export interface TransactionDatabase {
  transaction<T>(run: (client: QueryClient) => Promise<T>): Promise<T>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const freshToken = () => randomBytes(24).toString("hex");
const commandToken = /^[a-f0-9]{48}$/;
/** WhatsApp numbers are bare digits. Telegram user ids are namespaced "tg:<id>" so the
 * two channels can never collide in the shared link, event, quota or undo tables. */
export const senderPattern = /^(?:\d{7,15}|tg:[1-9]\d{0,15})$/;
const channelOf = (sender: string) => sender.startsWith("tg:") ? { name: "Telegram", what: "Telegram account id" } : { name: "WhatsApp", what: "full WhatsApp number" };
const sameFood = (a: Bookmark, b: Bookmark) => a.restaurantId === b.restaurantId && normalized(a.name) === normalized(b.name)
  && a.note === b.note && a.referenceUrl === b.referenceUrl && a.tried === b.tried && a.rating === b.rating;

/** Account binding and real SQL save/rating execution for ISOLATED review data.
 * No environment/database discovery, network send or production mounting.
 * The caller owns authenticated user identity and signed webhook verification.
 */
export interface EngineOptions {
  /** "global" (default, unchanged): one app-wide lock per message. "fine": lock order sender -> global (link ops only) -> user. */
  locking?: "global" | "fine";
  /** Telegram choice-based save conversation (needs migrations/telegram-conversation.sql). Telegram senders only. */
  conversation?: boolean;
  /** Per-sender fair use (needs migrations/telegram-conversation.sql). null/undefined = off. */
  senderLimits?: { perMinute: number; perDay: number } | null;
  /** Receipt wording. False/absent = explicit staging/test wording. True only for the real bhookmark.com deployment. */
  production?: boolean;
  /** https URL of the Bhookmark sign-in/link page. Enables the first-time "Link account" button for unlinked Telegram senders. */
  linkUrl?: string;
  /** Content-free operational events: counts and timings only. */
  onEvent?: (e: { event: "processed" | "duplicate" | "rate_limited" | "cap_reached"; ms: number }) => void;
}
export interface EngineReply { reply: string | null; duplicate?: boolean; buttons?: Button[][] }
class CapReached extends Error {}
const readCommand = /^(?:(?:show|list)(?: my)? (?:saves|saved food|bookmarks)|what (?:dishes )?did i like at .+?)[.!?]*$/i;
const GLOBAL_LOCK = "SELECT pg_advisory_xact_lock(173621109)";
const keyedLock = (c: QueryClient, key: string) => c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);

/** Account binding and real SQL save/rating execution for ISOLATED review data.
 * No environment/database discovery, network send or production mounting.
 * The caller owns authenticated user identity and signed webhook verification.
 */
export function createWhatsAppExecution(db: TransactionDatabase, search: (q: string) => Promise<ChatRestaurant[]>, now = Date.now, quotaCap = 900, opts: EngineOptions = {}) {
  if (!Number.isInteger(quotaCap) || quotaCap < 1 || quotaCap > 100000) throw new Error("Invalid quota cap");
  const fine = opts.locking === "fine", limits = opts.senderLimits ?? null;
  const locked = <T>(run: (c: QueryClient) => Promise<T>) => db.transaction(async c => {
    // Serializes linking/WhatsApp messages across workers; user/food row locks
    // additionally coordinate with existing web bookmark writes.
    await c.query(GLOBAL_LOCK);
    return run(c);
  });
  const savedReply = async (c: QueryClient, userId: string, operation: "save" | "update", bookmarkId: string | undefined, b: BookmarkInput, existing: Bookmark[], time: number) => {
    const id = bookmarkId ?? freshToken();
    const before = existing.find(v => v.id === id) ?? null;
    const result = operation === "update"
      ? await c.query("UPDATE food_bookmarks SET note=$3,reference_url=$4,tried=$5,rating=$6 WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId, b.note, b.referenceUrl, b.tried, b.rating])
      : await c.query(`INSERT INTO food_bookmarks(id,user_id,restaurant_id,restaurant_name,address,name,note,reference_url,tried,rating,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [id, userId, b.restaurantId, b.restaurantName, b.address, b.name, b.note, b.referenceUrl, b.tried, b.rating, time]);
    if (!result.rows[0]) throw new Error("Bookmark changed during execution");
    const after = fromRow(result.rows[0]), undoToken = freshToken();
    await c.query("INSERT INTO whatsapp_undo(token,user_id,bookmark_id,before_value,after_value,expires_at) VALUES($1,$2,$3,$4,$5,$6)", [undoToken, userId, id, before && JSON.stringify(before), JSON.stringify(after), time + 10 * 60_000]);
    const what = `${before ? "Updated" : "Saved"} ${b.name} at ${b.restaurantName}${b.rating !== null ? `, ${b.rating}/10` : " (unrated)"}`;
    // The receipt is built only here, after the INSERT/UPDATE returned a row inside this transaction.
    // The transaction can still roll back later (the quota check runs last), but then no reply is sent and nothing is stored.
    const where = !opts.conversation ? "." : opts.production ? ". Your food is logged to your account at bhookmark.com." : " in the Bhookmark STAGING TEST account. This is a test, not your bhookmark.com account.";
    return `${what}${where} To reverse within 10 minutes: UNDO ${undoToken}`;
  };
  const listReply = (p: { reply: string; bookmarks: Bookmark[] }) => p.reply + p.bookmarks.slice(0, 10).map(b => `\n${b.name} at ${b.restaurantName}: ${b.rating === null ? "unrated" : b.rating + "/10"}`).join("") + (p.bookmarks.length > 10 ? "\nMore in the website." : "");
  const engine = {
    async beginLink(userId: string) {
      return locked(async c => {
        const user = await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
        if (!user.rows.length) throw new Error("Account not found");
        const token = freshToken(), expiresAt = now() + 10 * 60_000;
        await c.query(`INSERT INTO whatsapp_link_intents(user_id,token_hash,expires_at) VALUES($1,$2,$3)
          ON CONFLICT(user_id) DO UPDATE SET token_hash=$2,expires_at=$3,sender=NULL,confirmation_hash=NULL,confirmed=false`, [userId, hash(token), expiresAt]);
        return { command: `LINK ${token}`, expiresAt };
      });
    },
    async linkStatus(userId: string) {
      return locked(async c => {
        const intent = (await c.query("SELECT * FROM whatsapp_link_intents WHERE user_id=$1 AND expires_at>$2 AND NOT confirmed", [userId, now()])).rows[0];
        const link = (await c.query("SELECT sender FROM whatsapp_links WHERE user_id=$1", [userId])).rows[0];
        // Full sender is intentional: the signed-in user must check the whole
        // number before confirming, not only an ambiguous last-four suffix.
        return { pendingSender: intent?.sender ?? null, linkedSender: link?.sender ?? null };
      });
    },
    async confirmLink(userId: string, sender: string, confirmation: string) {
      if (!senderPattern.test(sender) || !commandToken.test(confirmation)) return false;
      return locked(async c => {
        const intent = (await c.query(`SELECT * FROM whatsapp_link_intents WHERE user_id=$1 AND sender=$2
          AND confirmation_hash=$3 AND expires_at>$4 AND NOT confirmed FOR UPDATE`, [userId, sender, hash(confirmation), now()])).rows[0];
        if (!intent) return false;
        // Never displace another account or silently change this user's number.
        const conflicts = await c.query("SELECT * FROM whatsapp_links WHERE sender=$1 OR user_id=$2", [sender, userId]);
        if (conflicts.rows.some(r => r.user_id !== userId || r.sender !== sender)) return false;
        await c.query("INSERT INTO whatsapp_links(sender,user_id,linked_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [sender, userId, now()]);
        await c.query("UPDATE whatsapp_link_intents SET confirmed=true,token_hash=$2,confirmation_hash=NULL WHERE user_id=$1", [userId, hash(freshToken())]);
        return true;
      });
    },
    async unlink(userId: string) {
      await locked(async c => {
        // Wait for any in-flight save by this user so nothing is written after the link is gone.
        if (fine) await keyedLock(c, `user:${userId}`);
        if (opts.conversation) await c.query("DELETE FROM tg_conversations WHERE sender IN (SELECT sender FROM whatsapp_links WHERE user_id=$1)", [userId]);
        await c.query("DELETE FROM whatsapp_links WHERE user_id=$1", [userId]);
        await c.query("DELETE FROM whatsapp_link_intents WHERE user_id=$1", [userId]);
        await c.query("UPDATE whatsapp_undo SET consumed=true WHERE user_id=$1", [userId]);
      });
    },
    async process(message: IncomingText): Promise<EngineReply> {
      if (!senderPattern.test(message.sender)) throw new Error("Invalid sender");
      const started = Date.now();
      try {
        const out = await db.transaction(c => handle(c, message));
        opts.onEvent?.({ event: out.duplicate ? "duplicate" : "processed", ms: Date.now() - started });
        return out;
      } catch (e) {
        if (!(e instanceof CapReached)) throw e;
        // The work was rolled back. Record the refusal separately so retries are deduplicated.
        await db.transaction(c => c.query("INSERT INTO whatsapp_execution_events(phone_id,message_id,reply) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [message.phoneId, message.id, "Review cap reached. No food changed. Use the website."]));
        opts.onEvent?.({ event: "cap_reached", ms: Date.now() - started });
        return { reply: null, duplicate: false };
      }
    },
  };
  async function handle(c: QueryClient, message: IncomingText): Promise<EngineReply> {
    // Lock order is fixed everywhere: sender -> global (link operations only) -> user.
    if (fine) await keyedLock(c, `sender:${message.phoneId}:${message.sender}`); else await c.query(GLOBAL_LOCK);
    const previous = (await c.query(opts.conversation ? "SELECT reply,buttons FROM whatsapp_execution_events WHERE phone_id=$1 AND message_id=$2" : "SELECT reply FROM whatsapp_execution_events WHERE phone_id=$1 AND message_id=$2", [message.phoneId, message.id])).rows[0];
    if (previous) return { reply: (previous.reply as string) || null, duplicate: true, ...(opts.conversation && previous.buttons ? { buttons: previous.buttons as Button[][] } : {}) };
    // An event handled by the earlier refusal-only review queue must not
    // become a new food mutation if the composition changes before a retry.
    const seen = (await c.query("SELECT message_id FROM whatsapp_review_inbox WHERE phone_id=$1 AND message_id=$2", [message.phoneId, message.id])).rows[0];
    if (seen) return { reply: null, duplicate: true };
    const time = now();
    if (message.timestamp > time + 60_000 || message.timestamp < time - 23 * 3600_000) return { reply: null, duplicate: false };
    if (limits) {
      const bump = async (bucket: string) => Number((await c.query("INSERT INTO whatsapp_sender_window(phone_id,sender,bucket,count) VALUES($1,$2,$3,1) ON CONFLICT(phone_id,sender,bucket) DO UPDATE SET count=whatsapp_sender_window.count+1 RETURNING count", [message.phoneId, message.sender, bucket])).rows[0].count);
      const minute = `m:${Math.floor(time / 60_000)}`, day = `d:${Math.floor(time / 86_400_000)}`;
      await c.query("DELETE FROM whatsapp_sender_window WHERE phone_id=$1 AND sender=$2 AND bucket NOT IN ($3,$4)", [message.phoneId, message.sender, minute, day]);
      const m = await bump(minute), d = await bump(day);
      if (m > limits.perMinute || d > limits.perDay) {
        // Deliberate refusal: nothing is accepted, so nothing is lost. Tell the sender once per window, then stay silent.
        const notice = d > limits.perDay ? (d === limits.perDay + 1 ? "You've reached today's message limit for Bhookmark. Nothing was saved. Try again tomorrow or use the website." : "")
          : m === limits.perMinute + 1 ? "You're sending messages too quickly. Nothing was saved. Please wait a minute." : "";
        await c.query("INSERT INTO whatsapp_execution_events(phone_id,message_id,reply) VALUES($1,$2,$3)", [message.phoneId, message.id, notice]);
        opts.onEvent?.({ event: "rate_limited", ms: 0 });
        return { reply: notice || null, duplicate: false };
      }
    }
    const linkCommand = /^LINK ([a-f0-9]{48})$/.exec(message.text.trim());
    let userId: string | null = null, reply: string, buttons: Button[][] | undefined;
    if (linkCommand) {
      if (fine) await c.query(GLOBAL_LOCK);
      const intent = (await c.query("SELECT * FROM whatsapp_link_intents WHERE token_hash=$1 AND expires_at>$2 AND NOT confirmed FOR UPDATE", [hash(linkCommand[1]), time])).rows[0];
      if (!intent || intent.sender) reply = "That link code is invalid, used or expired. Start again while signed into Bhookmark.";
      else if ((await c.query("SELECT 1 FROM whatsapp_links WHERE user_id=$1 OR sender=$2", [intent.user_id, message.sender])).rows.length) {
        // One link per account and per sender, across channels. Never displace an existing link.
        reply = "This Bhookmark account or this chat is already linked. Nothing was changed. Unlink the existing one from Bhookmark first, then try again.";
      } else {
        const confirmation = freshToken();
        await c.query("UPDATE whatsapp_link_intents SET sender=$2,confirmation_hash=$3 WHERE user_id=$1", [intent.user_id, message.sender, hash(confirmation)]);
        reply = `Return to the signed-in Bhookmark account and confirm your ${channelOf(message.sender).what} with code ${confirmation}. No food is accessible until you confirm.`;
      }
    } else {
      let link: Record<string, any> | undefined = (await c.query("SELECT user_id FROM whatsapp_links WHERE sender=$1", [message.sender])).rows[0];
      if (fine && link) {
        await keyedLock(c, `user:${link.user_id}`);
        // The link may have been removed while we waited. Re-check under the user lock.
        const again = (await c.query("SELECT user_id FROM whatsapp_links WHERE sender=$1", [message.sender])).rows[0];
        link = again?.user_id === link.user_id ? again : undefined;
      }
      userId = link?.user_id ?? null;
      if (!userId && opts.conversation && opts.linkUrl && message.sender.startsWith("tg:")) {
        // First-time visitor who started from Telegram. The button only opens the Bhookmark site: the account is
        // still linked solely by the signed-in owner pasting/confirming the code. No identity is ever linked automatically.
        reply = "Welcome to Bhookmark. Link your account to save food. Nothing has been read or changed.";
        buttons = [[{ text: "Link account", url: opts.linkUrl }]];
      } else if (!userId) reply = "Link your account from the signed-in Bhookmark review page first. No food has been read or changed.";
      else if (/^(STOP|UNLINK)$/i.test(message.text.trim())) {
        if (opts.conversation) await c.query("DELETE FROM tg_conversations WHERE phone_id=$1 AND sender=$2", [message.phoneId, message.sender]);
        await c.query("DELETE FROM whatsapp_links WHERE user_id=$1", [userId]);
        await c.query("DELETE FROM whatsapp_link_intents WHERE user_id=$1", [userId]);
        await c.query("UPDATE whatsapp_undo SET consumed=true WHERE user_id=$1", [userId]);
        reply = `${channelOf(message.sender).name} account link removed. No more food can be read or changed from this ${channelOf(message.sender).name} account unless you link again.`;
      } else {
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
        const rows = (await c.query("SELECT * FROM food_bookmarks WHERE user_id=$1 ORDER BY created_at DESC FOR UPDATE", [userId])).rows;
        const existing = rows.map(fromRow);
        const undo = /^UNDO ([a-f0-9]{48})$/.exec(message.text.trim());
        const talk = !!opts.conversation && message.sender.startsWith("tg:") && !undo && (!!message.callback || !readCommand.test(message.text.trim()));
        if (undo) {
          const action = (await c.query("SELECT * FROM whatsapp_undo WHERE token=$1 AND user_id=$2 AND expires_at>$3 AND NOT consumed FOR UPDATE", [undo[1], userId, time])).rows[0];
          const current = action && existing.find(b => b.id === action.bookmark_id);
          if (!action || !current || !sameFood(current, action.after_value)) reply = "Cannot undo: it expired, was already used, or the dish changed. Nothing changed.";
          else {
            if (action.before_value) {
              const b = action.before_value as Bookmark;
              await c.query("UPDATE food_bookmarks SET note=$3,reference_url=$4,tried=$5,rating=$6 WHERE id=$1 AND user_id=$2", [current.id, userId, b.note, b.referenceUrl, b.tried, b.rating]);
            } else await c.query("DELETE FROM food_bookmarks WHERE id=$1 AND user_id=$2", [current.id, userId]);
            await c.query("UPDATE whatsapp_undo SET consumed=true WHERE token=$1", [undo[1]]);
            reply = "Undone. Your earlier saved-food state is restored.";
          }
        } else if (talk) {
          const stored = (await c.query("SELECT state FROM tg_conversations WHERE phone_id=$1 AND sender=$2 FOR UPDATE", [message.phoneId, message.sender])).rows[0];
          const out = await advance((stored?.state as ConvState) ?? null, message.callback ? { data: message.callback.data } : { text: message.text }, { existing, search, now: time });
          if (out.state) await c.query("INSERT INTO tg_conversations(phone_id,sender,state,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(phone_id,sender) DO UPDATE SET state=$3,expires_at=$4", [message.phoneId, message.sender, JSON.stringify(out.state), out.state.expiresAt]);
          else await c.query("DELETE FROM tg_conversations WHERE phone_id=$1 AND sender=$2", [message.phoneId, message.sender]);
          if (out.save) {
            reply = await savedReply(c, userId, out.save.operation, out.save.bookmarkId, out.save.input, existing, time);
            if (opts.production && opts.linkUrl) buttons = [[{ text: "Open Bhookmark", url: opts.linkUrl }]];
          }
          else if (out.command === "list") reply = listReply(await previewMessage(userId, "Show my saves", { list: async () => existing, search }) as any);
          else { reply = out.reply; buttons = out.buttons; }
        } else {
          const p = await previewMessage(userId, message.text, { list: async () => existing, search });
          if (p.kind === "list") reply = listReply(p);
          else if (p.kind === "clarify") reply = p.reply + (p.choices?.map(r => `\n${r.name}: ${r.address}`).join("") ?? "");
          else if (p.operation === "save" && existing.length >= 500) reply = "Your list is full. Nothing saved; remove a dish first.";
          else reply = await savedReply(c, userId, p.operation, p.bookmarkId, p.input, existing, time);
        }
      }
    }
    reply = reply.slice(0, 3900);
    // Reserve reply quota last, so the single quota row is locked only for the final few statements.
    // If the cap is reached the whole transaction rolls back: no food or state changes.
    const month = new Date(time).toISOString().slice(0, 7); // Isolated harness uses UTC only.
    await c.query("INSERT INTO whatsapp_review_quota(phone_id,month,reserved) VALUES($1,$2,0) ON CONFLICT DO NOTHING", [message.phoneId, month]);
    const quota = (await c.query("UPDATE whatsapp_review_quota SET reserved=reserved+1 WHERE phone_id=$1 AND month=$2 AND reserved<$3 RETURNING reserved", [message.phoneId, month, quotaCap])).rows[0];
    if (!quota) throw new CapReached();
    if (opts.conversation) await c.query("INSERT INTO whatsapp_execution_events(phone_id,message_id,user_id,reply,buttons) VALUES($1,$2,$3,$4,$5)", [message.phoneId, message.id, userId, reply, buttons ? JSON.stringify(buttons) : null]);
    else await c.query("INSERT INTO whatsapp_execution_events(phone_id,message_id,user_id,reply) VALUES($1,$2,$3,$4)", [message.phoneId, message.id, userId, reply]);
    await c.query("INSERT INTO whatsapp_review_inbox(phone_id,message_id,received_at) VALUES($1,$2,$3)", [message.phoneId, message.id, time]);
    await c.query("INSERT INTO whatsapp_review_outbox(phone_id,message_id,recipient,reply,expires_at) VALUES($1,$2,$3,$4,$5)", [message.phoneId, message.id, message.sender, reply, message.timestamp + 24 * 3600_000]);
    return { reply, duplicate: false, ...(buttons ? { buttons } : {}) };
  }
  return engine;
}
