import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main className="wrap">
      <header className="masthead">
        <h1>Agent Governance</h1>
        <p>
          A control plane that sits between AI agents and the things they can break. Every action an
          agent wants to take is checked against policy, held for a human when it is risky, and
          written to a ledger you can verify line by line.
        </p>
      </header>
      <Dashboard />
      <footer>
        Built by{' '}
        <a href="https://github.com/zbs-ops" target="_blank" rel="noreferrer">
          Zohaib Qamar
        </a>{' '}
        · state is in memory, so a cold start reseeds the demo · full write-up in the{' '}
        <a
          href="https://github.com/zbs-ops/agent-governance#readme"
          target="_blank"
          rel="noreferrer"
        >
          README
        </a>
      </footer>
    </main>
  );
}
