'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuditEntry, Budget, ChainVerification, GatedAction } from '@/lib/types';

const SCENARIOS: { label: string; agent: string; tool: string; args: Record<string, unknown>; cost: number }[] =
  [
    {
      label: 'Look up a customer',
      agent: 'support-agent',
      tool: 'crm.read',
      args: { customer: 'northwind-ltd' },
      cost: 0,
    },
    {
      label: 'Open an internal ticket',
      agent: 'support-agent',
      tool: 'ticket.create',
      args: { subject: 'Card declined at checkout', priority: 'normal' },
      cost: 0,
    },
    {
      label: 'Refund $84.00',
      agent: 'billing-agent',
      tool: 'refund.issue',
      args: { invoice: '9114', amount_cents: 8400 },
      cost: 8400,
    },
    {
      label: 'Email 5,000 customers',
      agent: 'growth-agent',
      tool: 'email.send',
      args: { to: '5,000 customers', template: 'price-change' },
      cost: 1500,
    },
    {
      label: 'Deploy to production',
      agent: 'devops-agent',
      tool: 'deploy.production',
      args: { service: 'checkout-api', sha: 'a91f2c4' },
      cost: 0,
    },
    {
      label: 'Drop the customers table',
      agent: 'rogue-agent',
      tool: 'db.drop',
      args: { table: 'customers' },
      cost: 0,
    },
    {
      label: 'Move funds to an unknown wallet',
      agent: 'rogue-agent',
      tool: 'crypto.transfer',
      args: { to: '0xbeef…', amount: 'all' },
      cost: 0,
    },
  ];

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function tierClass(action: GatedAction): string {
  if (action.decision.verdict === 'DENY') return 'deny';
  return `t${action.decision.tier}`;
}

function tierLabel(action: GatedAction): string {
  if (action.decision.verdict === 'DENY') return 'refused';
  return `tier ${action.decision.tier}`;
}

export default function Dashboard() {
  const [actions, setActions] = useState<GatedAction[]>([]);
  const [budget, setBudget] = useState<Budget>({ spentCents: 0, limitCents: 0 });
  const [chain, setChain] = useState<AuditEntry[]>([]);
  const [check, setCheck] = useState<ChainVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(0);

  const refresh = useCallback(async () => {
    const [proposals, audit] = await Promise.all([
      fetch('/api/proposals', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/audit', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    setActions(proposals.actions as GatedAction[]);
    setBudget(proposals.budget as Budget);
    setChain(audit.entries as AuditEntry[]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const propose = () => {
    const s = SCENARIOS[choice]!;
    return run(() =>
      fetch('/api/proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent: s.agent,
          tool: s.tool,
          args: s.args,
          estimatedCostCents: s.cost,
        }),
      }),
    );
  };

  const decide = (id: string, approve: boolean) =>
    run(() =>
      fetch(`/api/proposals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approve, reviewer: 'you@company.com' }),
      }),
    );

  const verify = () =>
    run(async () => {
      const result = (await fetch('/api/audit/verify', { cache: 'no-store' }).then((r) =>
        r.json(),
      )) as ChainVerification;
      setCheck(result);
    });

  const tamper = () =>
    run(async () => {
      await fetch('/api/audit/tamper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seq: 2 }),
      });
      const result = (await fetch('/api/audit/verify', { cache: 'no-store' }).then((r) =>
        r.json(),
      )) as ChainVerification;
      setCheck(result);
    });

  const reset = () =>
    run(async () => {
      await fetch('/api/reset', { method: 'POST' });
      setCheck(null);
    });

  const pending = actions.filter((a) => a.state === 'PENDING_APPROVAL');
  const blocked = actions.filter((a) => a.state === 'BLOCKED');
  const executed = actions.filter((a) => a.state === 'EXECUTED');
  const spentPct = budget.limitCents
    ? Math.min(100, (budget.spentCents / budget.limitCents) * 100)
    : 0;

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="n">{actions.length}</div>
          <div className="k">actions seen</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: 'var(--amber)' }}>
            {pending.length}
          </div>
          <div className="k">waiting on you</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: 'var(--red)' }}>
            {blocked.length}
          </div>
          <div className="k">refused</div>
        </div>
        <div className="stat">
          <div className="n">{money(budget.spentCents)}</div>
          <div className="k">of {money(budget.limitCents)} spent</div>
          <div className="meter">
            <span style={{ width: `${spentPct}%` }} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 22 }}>
        <h2>Send an agent action through the gate</h2>
        <div className="body">
          <div className="row">
            <select
              value={choice}
              onChange={(e) => setChoice(Number(e.target.value))}
              style={{ minWidth: 260 }}
            >
              {SCENARIOS.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
            <button className="primary" onClick={propose} disabled={busy}>
              Propose action
            </button>
            <button onClick={reset} disabled={busy}>
              Reset demo
            </button>
          </div>
          <p style={{ color: 'var(--muted)', margin: '12px 0 0', fontSize: 14 }}>
            Reads run on their own. Refunds, customer emails, deploys and deletes stop and wait for
            you. Anything not on the tool list is refused outright — an agent inventing a tool name
            is either confused or probing, and neither gets the benefit of the doubt.
          </p>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>
            Actions <span className="state">newest first</span>
          </h2>
          <div className="body">
            {actions.length === 0 && <div className="empty">Nothing yet.</div>}
            {actions.map((a) => (
              <div className="action" key={a.proposal.id}>
                <div className="top">
                  <div>
                    <span className="tool mono">{a.proposal.tool}</span>{' '}
                    <span className="agent">· {a.proposal.agent}</span>
                  </div>
                  <span className={`pill ${tierClass(a)}`}>{tierLabel(a)}</span>
                </div>

                <div className="why">{a.decision.reasons[a.decision.reasons.length - 1]}</div>

                <div className="args mono">{JSON.stringify(a.proposal.args)}</div>

                <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                  <span className="state">
                    {a.state.replace(/_/g, ' ').toLowerCase()}
                    {a.reviewedBy ? ` · ${a.reviewedBy}` : ''}
                    {a.proposal.estimatedCostCents > 0
                      ? ` · ${money(a.proposal.estimatedCostCents)}`
                      : ''}
                  </span>
                  {a.state === 'PENDING_APPROVAL' && (
                    <span className="row">
                      <button
                        className="approve"
                        onClick={() => decide(a.proposal.id, true)}
                        disabled={busy}
                      >
                        Approve
                      </button>
                      <button
                        className="reject"
                        onClick={() => decide(a.proposal.id, false)}
                        disabled={busy}
                      >
                        Reject
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>
            Audit ledger
            <span className="row">
              <button onClick={verify} disabled={busy}>
                Verify chain
              </button>
              <button onClick={tamper} disabled={busy}>
                Tamper with it
              </button>
              <button onClick={() => window.open('/api/audit?download')} disabled={busy}>
                Download
              </button>
            </span>
          </h2>
          <div className="body">
            {check && (
              <div className={`banner ${check.valid ? 'ok' : 'bad'}`}>
                {check.valid ? '✓ ' : '✗ '}
                {check.message}
              </div>
            )}
            <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 13 }}>
              Each line carries the hash of the line before it. Press <em>Tamper with it</em> to edit
              a past entry the way someone covering their tracks would, then verify again — the
              ledger names the exact line that changed.
            </p>
            <div className="ledger">
              {chain.length === 0 && <div className="empty">Empty.</div>}
              {[...chain].reverse().map((e) => (
                <div className="entry" key={e.seq}>
                  <div className="seq mono">#{e.seq}</div>
                  <div>
                    <div className="ev">
                      {e.event} <span className="state">· {e.actor}</span>
                    </div>
                    <div className="state mono">
                      {e.proposalId} {JSON.stringify(e.detail)}
                    </div>
                    <div className="hash mono">{e.hash.slice(0, 32)}…</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 18 }}>
        {executed.length} executed · every decision above is reproducible: the same proposal against
        the same budget always produces the same verdict.
      </p>
    </>
  );
}
