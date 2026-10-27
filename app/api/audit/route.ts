import { NextResponse } from 'next/server';

import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The ledger as JSON. `?download` serves it as a file, so anyone can keep a copy and check it
 * later without trusting this server (for example with `agentguard verify-ledger` from PyPI).
 */
export function GET(request: Request): NextResponse {
  const response = NextResponse.json({ entries: getStore().chain() });
  if (new URL(request.url).searchParams.has('download')) {
    response.headers.set('Content-Disposition', 'attachment; filename="agent-governance-ledger.json"');
  }
  return response;
}
