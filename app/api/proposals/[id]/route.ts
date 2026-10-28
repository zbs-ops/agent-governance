import { NextResponse } from 'next/server';

import { isRegisteredReviewer, mintApprovalToken } from '@/lib/approvals';
import { ApprovalAuthError, SelfApprovalError, getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** The reviewer the dashboard acts as. The server holds this identity's key and vouches
 * for the person clicking in their own browser, so it mints the token for them here.
 * Any other reviewer has to bring their own token, which is the authenticated path. */
const DASHBOARD_REVIEWER = 'you@company.com';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const body = (await request.json()) as {
    approve?: boolean;
    reviewer?: string;
    note?: string;
    token?: string;
  };

  const reviewer = body.reviewer ?? DASHBOARD_REVIEWER;
  // The dashboard is the trusted human surface, so the server mints its reviewer's token.
  // Every other caller must supply its own; an unregistered reviewer gets none and is refused.
  const store = getStore();
  const pending = store.actions().find((a) => a.proposal.id === id);
  const token =
    body.token ??
    (pending && reviewer === DASHBOARD_REVIEWER && isRegisteredReviewer(reviewer)
      ? mintApprovalToken(pending.proposal, reviewer)
      : undefined);

  let updated;
  try {
    updated = store.decide(id, body.approve === true, reviewer, body.note, token);
  } catch (err) {
    if (err instanceof SelfApprovalError || err instanceof ApprovalAuthError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  if (!updated) {
    return NextResponse.json({ error: 'No pending action with that id' }, { status: 404 });
  }
  return NextResponse.json(updated);
}
