# Agent Governance

**[Open the live demo →](https://agent-governance-theta.vercel.app)**

A control plane that sits between AI agents and the things they can break.

Give an agent tools and it will eventually try to refund the wrong customer, email
five thousand people, or drop a table. Not because it is malicious — because it is
confidently wrong at three in the morning and nothing was standing in the way.

This is the thing standing in the way.

```
agent proposes  →  policy decides  →  human approves  →  it runs  →  ledger records it
                        │                                              │
                        └── refused outright ──────────────────────────┘
```

---

## The three ideas

**1. Nothing runs unchecked.**
Every tool call an agent wants to make is a *proposal* first. The policy engine gives one
of three answers: run it, hold it for a person, or refuse it. Reads go straight through.
Refunds, customer emails, deploys and deletes stop and wait.

**2. It fails closed.**
An agent asking for a tool that isn't on the list gets refused — no fuzzy matching, no
benefit of the doubt. An agent inventing a tool name is either hallucinating or probing,
and both deserve the same answer. Budget is checked before anything else, because a
runaway agent is the failure that costs real money while everyone is asleep.

**3. The log can't be quietly rewritten.**
Every event is hashed together with the hash of the event before it. Change one field in
one historical entry and its hash stops matching, and every entry after it is orphaned.

That last one is the part worth clicking. The demo has a **Tamper with it** button that
edits a past log entry the way someone covering their tracks would. Hit **Verify chain**
afterwards and it tells you exactly which line was touched:

> ✗ Entry #2 was edited after it was written. Its contents no longer match its hash.

The difference between *"we have logs"* and *"we can prove what happened"*.

---

## Try it in thirty seconds

1. Open the [live demo](https://agent-governance-theta.vercel.app).
2. Pick **Move funds to an unknown wallet** → **Propose action**. Refused on sight.
3. Pick **Refund $84.00** → it stops and waits for you. Approve it and watch the budget move.
4. Hit **Verify chain** → all entries check out.
5. Hit **Tamper with it**, then **Verify chain** again → it names the corrupted line.

---

## How the policy works

Policy is data, not conditionals buried in a service. Each rule is a row you can read,
reorder, or move into a database later without touching the engine.

| Tier | What it covers | What happens |
|------|----------------|--------------|
| 1 | Reads — CRM lookups, queries, search | Runs unattended |
| 2 | Internal writes — tickets, CRM updates | Runs, recorded in full |
| 3 | Money, customers, production, deletes | **Waits for a human** |

Three rules override the tier entirely:

- **Unknown tool** → refused. Fails closed.
- **Over budget** → refused, checked before anything else is weighed.
- **One unusually large spend** → escalated to a human even when it fits, because an agent
  asking for a quarter of the entire budget in a single action is worth a second look.

Two properties are enforced by tests rather than hoped for: the engine is **deterministic**
(same proposal, same budget, same verdict, every time) and it **always explains itself**,
because the reason it gives is the reason that lands in the audit log.

---

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 24 tests
```

---

## What's inside

```
lib/policy.ts    the gate — rules as data, deterministic, fails closed
lib/audit.ts     the hash chain — append, and verify by recomputing every hash
lib/store.ts     state behind an interface, so the storage is swappable
app/api/         proposals, approvals, the ledger, chain verification
components/      the dashboard
```

**Stack:** TypeScript · Next.js 15 (App Router) · React 19 · Node crypto · Vitest ·
deployed on Vercel. No dependencies beyond the framework itself — the policy engine and
the hash chain are plain TypeScript, which is why they're easy to test and easy to read.

### Tests

24 tests, and they're aimed at the things that would actually hurt:

- a changed value, a changed actor, a **deleted** entry, and a **reordered** pair are each
  caught, and the verifier names the sequence number where the chain breaks
- the thorough forger — someone who edits an entry *and* recomputes its hash — still fails,
  because every later entry was built on the old one
- budget is proven to be checked *before* the tier, so a tier-1 read still gets refused when
  the money has run out
- spend landing exactly on the cap is allowed; one cent over is not

---

## Honest about the demo

**State is in memory.** Open the live URL and you get a freshly seeded scenario; a cold
start reseeds it. That's deliberate — no signup, no database to provision, nothing to
configure before you can see it work.

It's also the only part of this that isn't production-shaped. Everything reaches state
through the `Store` interface in `lib/store.ts`, so swapping in Postgres is one adapter and
one line in `getStore()`. Nothing above that file knows or cares where the rows live.

**What this isn't:** it doesn't run the agents, and it doesn't talk to a model. It's the
layer underneath — the part that decides whether an action is allowed to happen at all, and
proves afterwards what did.

---

## Where the idea came from

I've been building AI agent automations that touch real systems — CRM records, teaching-hour
tracking, workflow runs across live branches. The uncomfortable part was never getting an
agent to *do* something. It was answering two questions afterwards:

*Who approved this?* and *how would we know if the log had been edited?*

Most agent stacks have an answer to neither. This is my answer.

---

Built by **Zohaib Qamar** — [GitHub](https://github.com/zbs-ops) ·
[LinkedIn](https://www.linkedin.com/in/zohaib-qamar-qwertyu/)
