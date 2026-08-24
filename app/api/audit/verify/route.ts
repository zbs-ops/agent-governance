import { NextResponse } from 'next/server';

import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Recomputes every hash in the ledger and reports the first entry that lies. */
export function GET(): NextResponse {
  return NextResponse.json(getStore().verify());
}
