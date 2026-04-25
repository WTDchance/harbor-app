import { NextRequest, NextResponse } from 'next/server'
import { listInboxes, createInbox, deleteInbox } from '@/lib/agentmail'
import { requireApiSession } from '@/lib/aws/api-auth'

async function getSupabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (s) => { try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
      },
    }
  )
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await getSupabase()
    const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const inboxes = await listInboxes()
    return NextResponse.json(inboxes)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabase()
    const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { username, displayName } = await req.json()
    if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 })

    const inbox = await createInbox(username, displayName)
    return NextResponse.json(inbox)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await getSupabase()
    const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { inboxId } = await req.json()
    if (!inboxId) return NextResponse.json({ error: 'inboxId required' }, { status: 400 })

    await deleteInbox(inboxId)
    return NextResponse.json({ deleted: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
