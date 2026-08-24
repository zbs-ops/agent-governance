import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Governance — approval and audit for AI agents',
  description:
    'A control plane that sits between AI agents and the things they can break: policy checks, human approval for risky actions, and a tamper-evident audit log.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
