import { NextResponse } from 'next/server';

import { resetStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export function POST(): NextResponse {
  resetStore();
  return NextResponse.json({ ok: true });
}
