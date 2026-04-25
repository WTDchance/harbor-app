import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { resolvePracticeIdForApi } from '@/lib/active-practice';
import { requireApiSession } from '@/lib/aws/api-auth'
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  );
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) {
    return NextResponse.json({ error: 'No practice found' }, { status: 404 });
  }
  const { error: ue } = await supabase.from('practices').update({ onboarding_dismissed: true }).eq('id', practiceId);
  if (ue) {
    return NextResponse.json({ error: ue.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
