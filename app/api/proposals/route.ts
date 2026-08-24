import { NextResponse } from 'next/server';

import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const store = getStore();
  return NextResponse.json({ actions: store.actions(), budget: store.budget() });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as {
    agent?: string;
    tool?: string;
    args?: Record<string, unknown>;
    estimatedCostCents?: number;
  };

  if (!body.tool || typeof body.tool !== 'string') {
    return NextResponse.json({ error: 'tool is required' }, { status: 400 });
  }

  const gated = getStore().propose({
    agent: body.agent ?? 'api-caller',
    tool: body.tool,
    args: body.args ?? {},
    estimatedCostCents: Number(body.estimatedCostCents ?? 0),
  });

  return NextResponse.json(gated, { status: 201 });
}
