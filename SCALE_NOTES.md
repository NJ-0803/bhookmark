# Section 15 — why "1M users" isn't something run locally

The doc is right that "1M users" needs to be split into registered vs. DAU vs.
concurrent — but none of the three scenarios (A/B/C/D in the doc) can be
honestly tested against what's built here, for one structural reason:

**The current backend (`server/`) is a single Node process holding all state
in JavaScript `Map`s in memory.** It has no database, no cache layer, no
queue, no horizontal scaling — it's a stand-in for local development, not a
scaled-down version of the real architecture. Running a load-test tool
against it wouldn't measure anything about whether the *real* architecture
(Postgres + read replicas, Redis, CDN + object storage, durable queues,
hybrid feed fan-out) can handle 1M users — it would just measure how fast one
laptop can handle HTTP requests, which tells you nothing useful about the
actual question.

## What real load testing requires
- A deployed environment on real infrastructure (cloud compute, a real
  managed database, a real cache, a real CDN) — this costs money and requires
  the user's cloud account, not something I can provision unilaterally.
- A real load-generation tool run against that environment (k6, Gatling,
  Locust, or a managed service) — also typically has a cost at the traffic
  volumes the doc describes.
- Time: the doc's own test plan (baseline → ramp → spike → soak → hot-key →
  chaos → cost) is measured in hours per scenario, not minutes.

## What's honest to say right now
Nothing in this repository has been load-tested at any scale beyond the
red-team smoke script's handful of sequential requests. The architecture
patterns Section 15 asks for (signed upload URLs, async AI/moderation queues,
hybrid feed fan-out, idempotency, circuit breakers around external vendors)
are referenced in code comments where relevant (see `server/src/routes/logs.ts`
for idempotency) but a single in-memory Node process is not that architecture
— it's the thing you migrate away from once Gate 2 traction justifies the
cost of doing so.

**Next real step, when you're ready:** pick a cloud provider, stand up a real
Postgres instance and a real queue, and only then does a load test produce a
number worth trusting.
