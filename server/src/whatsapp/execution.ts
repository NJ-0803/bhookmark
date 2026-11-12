import { createHash, randomBytes } from "node:crypto";
import { fromRow, type Bookmark } from "../bookmarks";
import { normalized, previewMessage, type ChatRestaurant } from "../chat/preview";
import type { IncomingText } from "./review";

export interface QueryClient { query<T = Record<string, any>>(text: string, params?: any[]): Promise<{ rows: T[] }> }
/** An actual interactive transaction, not a sequence of independent SQL calls. */
export interface TransactionDatabase {
  transaction<T>(run: (client: QueryClient) => Promise<T>): Promise<T>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const freshToken = () => randomBytes(24).toString("hex");
const commandToken = /^[a-f0-9]{48}$/;
const senderPattern = /^\d{7,15}$/;
const sameFood = (a: Bookmark, b: Bookmark) => a.restaurantId === b.restaurantId && normalized(a.name) === normalized(b.name)
  && a.note === b.note && a.referenceUrl === b.referenceUrl && a.tried === b.tried && a.rating === b.rating;

/** Account binding and real SQL save/rating execution for ISOLATED review data.
 * No environment/database discovery, network send or production mounting.
 * The caller owns authenticated user identity and signed webhook verification.
 */
export function createWhatsAppExecution(db: TransactionDatabase, search: (q: string) => Promise<ChatRestaurant[]>, now = Date.now) {
  const locked = <T>(run: (c: QueryClient) => Promise<T>) => db.transaction(async c => {
    // Serializes linking/WhatsApp messages across workers; user/food row locks
    // additionally coordinate with existing web bookmark writes.
    await c.query("SELECT pg_advisory_xact_lock(173621109)");
    return run(c);
  });
  return {
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
        await c.query("DELETE FROM whatsapp_links WHERE user_id=$1", [userId]);
        await c.query("DELETE FROM whatsapp_link_intents WHERE user_id=$1", [userId]);
        await c.query("UPDATE whatsapp_undo SET consumed=true WHERE user_id=$1", [userId]);
      });
    },
    async process(message: IncomingText) {
      if (!senderPattern.test(message.sender)) throw new Error("Invalid sender");
      return locked(async c => {
        const previous = (await c.query("SELECT reply FROM whatsapp_execution_events WHERE phone_id=$1 AND message_id=$2", [message.phoneId, message.id])).rows[0];
        if (previous) return { reply: previous.reply as string, duplicate: true };
        // An event handled by the earlier refusal-only review queue must not
        // become a new food mutation if the composition changes before a retry.
        const seen = (await c.query("SELECT message_id FROM whatsapp_review_inbox WHERE phone_id=$1 AND message_id=$2", [message.phoneId, message.id])).rows[0];
        if (seen) return { reply: null, duplicate: true };
        // Refuse mutation before reserving reply quota. Same SQL transaction.
        const time = now();
        if (message.timestamp > time + 60_000 || message.timestamp < time - 23 * 3600_000) return { reply: null, duplicate: false };
        const month = new Date(time).toISOString().slice(0, 7); // Isolated harness uses UTC only.
        await c.query("INSERT INTO whatsapp_review_quota(phone_id,month,reserved) VALUES($1,$2,0) ON CONFLICT DO NOTHING", [message.phoneId, month]);
        const quota = (await c.query("UPDATE whatsapp_review_quota SET reserved=reserved+1 WHERE phone_id=$1 AND month=$2 AND reserved<900 RETURNING reserved", [message.phoneId, month])).rows[0];
        if (!quota) {
          await c.query("INSERT INTO whatsapp_execution_events(phone_id,message_id,reply) VALUES($1,$2,$3)", [message.phoneId, message.id, "Review cap reached. No food changed. Use the website."]);
          return { reply: null, duplicate: false };
        }
        const linkCommand = /^LINK ([a-f0-9]{48})$/.exec(message.text.trim());
        let userId: string | null = null, reply: string;
        if (linkCommand) {
          const intent = (await c.query("SELECT * FROM whatsapp_link_intents WHERE token_hash=$1 AND expires_at>$2 AND NOT confirmed FOR UPDATE", [hash(linkCommand[1]), time])).rows[0];
          if (!intent || intent.sender) reply = "That link code is invalid, used or expired. Start again while signed into Bhookmark.";
          else {
            const confirmation = freshToken();
            await c.query("UPDATE whatsapp_link_intents SET sender=$2,confirmation_hash=$3 WHERE user_id=$1", [intent.user_id, message.sender, hash(confirmation)]);
            reply = `Return to the signed-in Bhookmark account and confirm your full WhatsApp number with code ${confirmation}. No food is accessible until you confirm.`;
          }
        } else {
          const link = (await c.query("SELECT user_id FROM whatsapp_links WHERE sender=$1", [message.sender])).rows[0];
          userId = link?.user_id ?? null;
          if (!userId) reply = "Link your account from the signed-in Bhookmark review page first. No food has been read or changed.";
          else if (/^(STOP|UNLINK)$/i.test(message.text.trim())) {
            await c.query("DELETE FROM whatsapp_links WHERE user_id=$1", [userId]);
            await c.query("DELETE FROM whatsapp_link_intents WHERE user_id=$1", [userId]);
            await c.query("UPDATE whatsapp_undo SET consumed=true WHERE user_id=$1", [userId]);
            reply = "WhatsApp account link removed. No more food can be read or changed from this number unless you link again.";
          } else {
            await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
            const rows = (await c.query("SELECT * FROM food_bookmarks WHERE user_id=$1 ORDER BY created_at DESC FOR UPDATE", [userId])).rows;
            const existing = rows.map(fromRow);
            const undo = /^UNDO ([a-f0-9]{48})$/.exec(message.text.trim());
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
            } else {
              const p = await previewMessage(userId, message.text, { list: async () => existing, search });
              if (p.kind === "list") reply = p.reply + p.bookmarks.slice(0, 10).map(b => `\n${b.name} at ${b.restaurantName}: ${b.rating === null ? "unrated" : b.rating + "/10"}`).join("") + (p.bookmarks.length > 10 ? "\nMore in the website." : "");
              else if (p.kind === "clarify") reply = p.reply + (p.choices?.map(r => `\n${r.name}: ${r.address}`).join("") ?? "");
              else if (p.operation === "save" && existing.length >= 500) reply = "Your list is full. Nothing saved; remove a dish first.";
              else {
                const b = p.input, bookmarkId = p.bookmarkId ?? freshToken();
                const before = existing.find(v => v.id === bookmarkId) ?? null;
                const result = p.operation === "update"
                  ? await c.query("UPDATE food_bookmarks SET note=$3,reference_url=$4,tried=$5,rating=$6 WHERE id=$1 AND user_id=$2 RETURNING *", [bookmarkId, userId, b.note, b.referenceUrl, b.tried, b.rating])
                  : await c.query(`INSERT INTO food_bookmarks(id,user_id,restaurant_id,restaurant_name,address,name,note,reference_url,tried,rating,created_at)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [bookmarkId, userId, b.restaurantId, b.restaurantName, b.address, b.name, b.note, b.referenceUrl, b.tried, b.rating, time]);
                if (!result.rows[0]) throw new Error("Bookmark changed during execution");
                const after = fromRow(result.rows[0]), undoToken = freshToken();
                await c.query("INSERT INTO whatsapp_undo(token,user_id,bookmark_id,before_value,after_value,expires_at) VALUES($1,$2,$3,$4,$5,$6)", [undoToken, userId, bookmarkId, before && JSON.stringify(before), JSON.stringify(after), time + 10 * 60_000]);
                reply = `${before ? "Updated" : "Saved"} ${b.name} at ${b.restaurantName}${b.rating !== null ? `, ${b.rating}/10` : " (unrated)"}. To reverse within10minutes: UNDO ${undoToken}`;
              }
            }
          }
        }
        reply = reply.slice(0, 3900);
        await c.query("INSERT INTO whatsapp_execution_events(phone_id,message_id,user_id,reply) VALUES($1,$2,$3,$4)", [message.phoneId, message.id, userId, reply]);
        await c.query("INSERT INTO whatsapp_review_inbox(phone_id,message_id,received_at) VALUES($1,$2,$3)", [message.phoneId, message.id, time]);
        await c.query("INSERT INTO whatsapp_review_outbox(phone_id,message_id,recipient,reply,expires_at) VALUES($1,$2,$3,$4,$5)", [message.phoneId, message.id, message.sender, reply, message.timestamp + 24 * 3600_000]);
        return { reply, duplicate: false };
      });
    },
  };
}
