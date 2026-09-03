# Section 17 — red-team plan, what was actually run

`server/scripts/redteam-smoke.mjs` is a real, runnable script — not a
description of testing, an actual one. Run it yourself any time with the
backend running:

```
cd server && npm run dev        # terminal 1
cd server && node scripts/redteam-smoke.mjs   # terminal 2
```

## Last run: 13/13 passed
Covers a P0 subset chosen because it maps directly to code that exists:

| Doc ID | What it checks | Result |
|---|---|---|
| A-01 | OTP request rate limit (3/10min per phone) | PASS |
| A-02 | Generic error regardless of phone registration | PASS |
| A-03 | OTP brute-force cap (5 attempts) | PASS |
| A-04 | Refresh-token reuse revokes the whole session family | PASS |
| A-07 | Non-moderator denied the moderation queue | PASS |
| A-08/A-09 | IDOR — can't read/delete another user's log | PASS |
| F-10/F-11 | Idempotency key prevents duplicate log on retry | PASS |
| T-01/T-04 | Venue/device burst gets held, not published | PASS |

## What this is *not*
This is a smoke test of code I wrote, run by me, against a server I control,
with no real users, no real money on the line, and no adversary who actually
wants to break it. That is categorically different from Section 17's red-team
plan, which calls for:

- **Independent testers** (not the same person who wrote the defenses)
- **A staging environment** that mirrors production, not a dev laptop
- **The other ~55 rows** of the doc's matrix not covered above — most
  need infrastructure that doesn't exist yet (real image uploads for T-05/T-06,
  real moderator tooling for T-13/T-14, a real AI vision/translation pipeline
  for the entire AI-0x row, a real child-safety review for the P-0x row)
- **A launch-blocking sign-off process** — nobody should treat "the smoke
  test passed" as equivalent to "this cleared red-team review." It isn't.

## Honest next step
Once Gate 1.5 (Trust beta) has a real staging deployment, this smoke test is
a reasonable *starting point* to extend — not a finished red-team program.
Hiring or assigning an actual independent tester before Gate 2 is the real
recommendation, not something I can substitute for by running more scripts
against my own code.
