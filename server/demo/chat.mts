import express from "express";
import { pathToFileURL } from "node:url";
import { previewMessage, type Preview } from "../src/chat/preview.js";
import type { Bookmark } from "../src/bookmarks.js";

// Fictional fixtures only. No database import, account session, AI or provider.
const restaurants = [
  { id: "manual:demo-toit-indiranagar", name: "Toit Indiranagar", address: "Indiranagar, Bengaluru" },
  { id: "manual:demo-toit-whitefield", name: "Toit Whitefield", address: "Whitefield, Bengaluru" },
];
const bookmarks: Bookmark[] = [{ id: "demo-pizza", restaurantId: restaurants[0].id,
  restaurantName: restaurants[0].name, address: restaurants[0].address, name: "Pizza",
  note: "Demo note: no olives", referenceUrl: "", tried: false, rating: null, savedAt: 0 }];
const deps = { list: async () => structuredClone(bookmarks), search: async (q: string) => {
  const words = q.toLowerCase().split(/\s+/);
  return restaurants.filter(r => words.every(w => `${r.name} ${r.address}`.toLowerCase().includes(w)));
} };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function createDemoApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
    next();
  });
  app.use(express.json({ limit: "4kb" }));
  app.post("/preview", async (req, res) => {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return res.sendStatus(403);
    const message = req.body?.message;
    if (typeof message !== "string" || !message.trim() || message.length > 2000 || Object.keys(req.body).some(k => k !== "message")) {
      return res.status(400).json({ error: "Send a message of 1 to 2000 characters." });
    }
    const preview = await previewMessage("demo-only", message, deps);
    return res.json({ preview, writesEnabled: false });
  });
  app.get("/", async (_req, res) => {
    const initial = await previewMessage("demo-only", "Had pizza at Toit Indiranagar, 8.5/10", deps);
    return res.type("html").send(html(initial));
  });
  app.use((_req, res) => res.sendStatus(404));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ error: "Couldn't read that request." }));
  return app;
}

function html(initial: Preview) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bhookmark | Conversation preview</title><style>
*{box-sizing:border-box}body{margin:0;background:#141310;color:#f5efe3;font-family:Arial,sans-serif;font-size:15px;line-height:1.5}main{max-width:1120px;margin:auto;padding:42px 28px}.brand{letter-spacing:.22em;font-size:12px;color:#d7bba2}.status{float:right;color:#ddbaa3;border:1px solid #5a4c3f;padding:5px 13px;border-radius:30px;font-size:12px}h1{font-family:Georgia,serif;font-size:48px;font-weight:400;line-height:1.12;max-width:600px;margin:25px 0 15px}.intro{color:#bfb3a5;max-width:650px;margin:0 0 30px}.layout{display:grid;grid-template-columns:1.6fr 1fr;gap:24px}.chat,.info{border:1px solid #423b32;border-radius:18px;background:#201e19;overflow:hidden}.chathead{border-bottom:1px solid #423b32;padding:17px 22px;display:flex;justify-content:space-between}.chathead small{color:#c5b8a8}.thread{padding:24px;min-height:300px;max-height:440px;overflow:auto}.label{font-size:11px;color:#bba78e;letter-spacing:.1em;margin-bottom:7px}.bubble{padding:14px 18px;max-width:94%;border-radius:14px;margin-bottom:23px}.user{background:#853b4b;margin-left:auto}.assistant{background:#302d26;border:1px solid #514638}.assistant p{margin:0}.detail{font-size:12px;color:#d8c7ae;margin-top:12px;padding-top:10px;border-top:1px solid #5a4c3c}.composer{border-top:1px solid #423b32;padding:18px 20px}form{display:flex;gap:10px}input{flex:1;min-width:0;background:#151411;border:1px solid #635545;border-radius:9px;padding:13px;color:#fff;font:inherit}button{background:#ac5062;color:white;border:0;border-radius:9px;padding:12px 18px;font:inherit;cursor:pointer}button:disabled{opacity:.5}.hint{font-size:12px;color:#bbac9b;margin:10px 0 0}.info{padding:23px;height:fit-content}.info h2{font:26px Georgia,serif;margin:0 0 18px}.info h3{font-size:13px;margin:22px 0 8px;color:#e0b69c}.info p{color:#c4b5a3;font-size:13px}.chip{display:block;width:100%;text-align:left;border:1px solid #584a3b;background:transparent;margin-top:9px;font-size:13px;padding:11px 13px}.notice{background:#332a1d;border:1px solid #725938;border-radius:10px;padding:13px;font-size:13px;color:#e5c89e}footer{font-size:12px;color:#ad9a84;margin-top:21px}@media(max-width:760px){main{padding:24px 18px}h1{font-size:38px}.layout{grid-template-columns:1fr}.status{float:none;display:table;margin-top:14px}.thread{min-height:260px;padding:18px}.chathead{padding:15px}.info{padding:20px}}
</style></head><body><main><div class="brand">BHOOKMARK / LOCAL DEMO <span class="status">Sample data only</span></div><h1>A good meal.<br>A message to remember it.</h1><p class="intro">Try the conversation before connecting a messaging service. This local demo uses the real preview engine and fictional saved food.</p><div class="layout"><section class="chat" aria-label="Conversation"><div class="chathead"><strong>Bhookmark</strong><small>Preview · no account connected</small></div><div class="thread" id="thread" aria-live="polite"><div class="label">YOU · EXAMPLE MESSAGE</div><div class="bubble user">Had pizza at Toit Indiranagar, 8.5/10</div><div class="label">BHOOKMARK · PROPOSED CHANGE</div><div class="bubble assistant"><p>${escape(initial.reply)}</p><div class="detail">Existing Pizza entry found · note preserved: “Demo note: no olives”<br>Proposal only. The original sample remains unrated.</div></div></div><div class="composer"><form id="form"><input id="message" aria-label="Your message" placeholder="Save pizza at Toit" maxlength="2000" required autocomplete="off"><button id="send" type="submit">Preview</button></form><p class="hint">Nothing is saved. No WhatsApp, SMS or Apple Messages connection.</p></div></section><aside class="info"><h2>Try a message</h2><div class="notice">This is a read-only demo, not a live food journal. Refreshing or sending a message does not change any account.</div><button class="chip" data-message="Save pizza at Toit">Ask which Toit branch</button><button class="chip" data-message="Had pizza at Toit Indiranagar, 0/10">Try a valid zero rating</button><button class="chip" data-message="Had pizza at Toit Indiranagar, 7.3/10">See rating validation</button><button class="chip" data-message="Show my saves">See fictional saved food</button><h3>WHAT THIS VERSION DOES</h3><p>Recognizes a small set of save, rate and recall phrases. Keeps branch identity, notes and your exact rating. Asks rather than guessing.</p><h3>WHAT COMES NEXT</h3><p>Choose a messaging channel, add verified account linking, then enable tested saves, retries and undo. None of those are connected here.</p></aside></div><footer>Runs on your computer at 127.0.0.1:4040. No production database or paid API is used by this demo.</footer></main><script>
const form=document.getElementById('form'),input=document.getElementById('message'),thread=document.getElementById('thread'),send=document.getElementById('send');
function append(text,who){const box=document.createElement('div');box.className='bubble '+who;box.textContent=text;thread.appendChild(box);thread.scrollTop=thread.scrollHeight;return box}
form.addEventListener('submit',async event=>{event.preventDefault();const message=input.value.trim();if(!message)return;append(message,'user');input.value='';send.disabled=true;try{const r=await fetch('/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});const body=await r.json();if(!r.ok)throw new Error(body.error||'Preview failed');const p=body.preview;let text=p.reply;if(p.choices)text+='\\n'+p.choices.map(c=>c.name+' · '+c.address).join('\\n');if(p.bookmarks)text+='\\n'+p.bookmarks.map(b=>b.name+' at '+b.restaurantName+' · '+(b.rating===null?'not rated':b.rating+'/10')).join('\\n');append(text,'assistant').style.whiteSpace='pre-wrap'}catch(e){append(e.message||'Preview failed. Nothing was saved.','assistant')}finally{send.disabled=false;input.focus()}});
document.querySelectorAll('[data-message]').forEach(b=>b.addEventListener('click',()=>{input.value=b.dataset.message;form.requestSubmit()}));
</script></body></html>`; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createDemoApp().listen(4040, "127.0.0.1", () => console.log("Bhookmark sample-data demo: http://127.0.0.1:4040 (read-only, no production account)"));
}
