import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createDemoApp } from "../demo/chat.mts";

test("local demo uses sample data, cannot save and rejects cross-origin requests", async () => {
  const server = createDemoApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await fetch(base); const html = await page.text();
    assert.match(html, /Sample data only/); assert.match(html, /Nothing is saved/);
    assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    const post = (message: string, origin?: string) => fetch(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ message }) });
    const preview = await (await post("Had pizza at Toit Indiranagar, 9/10")).json();
    assert.equal(preview.writesEnabled, false); assert.equal(preview.preview.operation, "update");
    const list = await (await post("Show my saves")).json(); assert.equal(list.preview.bookmarks[0].rating, null);
    assert.equal((await post("Show my saves", "https://untrusted.example")).status, 403);
    assert.equal((await post(" ")).status, 400);
    assert.equal((await fetch(`${base}/save`, { method: "POST" })).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
