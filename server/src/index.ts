// Local dev entry only — production runs app.ts as a Vercel serverless
// function (see /api/index.ts at the project root).
import app from "./app";

const PORT = 4001;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Bhookmark API (local dev) listening on http://localhost:${PORT}`);
});
