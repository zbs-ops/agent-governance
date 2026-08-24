import { NextResponse } from 'next/server';

import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const body = (await request.json()) as { approve?: boolean; reviewer?: string; note?: string };

  const updated = getStore().decide(
    id,
    body.approve === true,
    body.reviewer ?? 'reviewer@company.com',
    body.note,
  );

  if (!updated) {
    return NextResponse.json({ error: 'No pending action with that id' }, { status: 404 });
  }
  return NextResponse.json(updated);
}
