import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.slice(7));
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: rec } = await supabase.from('users').select('practice_id').eq('id', user.id).single();
  if (!rec?.practice_id) {
    return NextResponse.json({ error: 'No practice found' }, { status: 404 });
  }
  const { error: ue } = await supabase.from('practices').update({ onboarding_dismissed: true }).eq('id', rec.practice_id);
  if (ue) {
    return NextResponse.json({ error: ue.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
