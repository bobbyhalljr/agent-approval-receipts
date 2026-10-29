# Agent approval receipts

A dependency-free TypeScript teaching example for Bobby Hall Jr's article, “Your agent’s approval button needs a receipt.”

## Run

Node >=22.18.0. No install or API key required.

```sh
cd code
npm test
npm run demo
```

Native Node type stripping runs this code without static type checking.

## Contract

A trusted server creates a proposal; a separately authorized human route approves that stored receipt; execution checks context, expiry, exact normalized action, and state before consuming admission and dispatching the stored action.

Never expose approve() to the model. Identity and reviewer permissions must be enforced by real authenticated routes. All demo context and reviewer strings are fixtures.

## Deliberate limits

In-memory single-process state; no durable storage, provider integration, UI, authentication, audit store, revocation, current order lookup or reconciliation. A provider exception leaves the receipt consumed. Coordinate production workers with an atomic durable transition, use provider idempotency and reconcile uncertain outcomes. Recheck order state when committing the side effect. Exact-once external execution is not guaranteed.

This standalone companion is not a distribution of the paid Module 3 lesson.

Course: https://bhjr.dev/courses/ship-a-safe-agent
Free Module 1: https://bhjr.dev/courses/ship-a-safe-agent/module-1
