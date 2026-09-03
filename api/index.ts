// Vercel Node serverless function entry — wraps the same Express app used
// for local dev (server/src/app.ts). An Express app is itself a valid
// (req, res) handler, so exporting it directly works without extra glue.
import app from "../server/src/app.js";

export default app;
