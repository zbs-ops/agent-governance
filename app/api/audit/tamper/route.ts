import { NextResponse } from 'next/server';

import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Demo only. Edits a historical entry the way someone covering their tracks
 * would, so you can watch the verifier catch it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { seq?: number };
  const seq = Number(body.seq ?? 2);

  if (!getStore().tamper(seq)) {
    return NextResponse.json({ error: `No entry #${seq}` }, { status: 404 });
  }
  return NextResponse.json({ tampered: seq });
}
