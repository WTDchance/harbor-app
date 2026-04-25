import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

async function getPractice() {
  // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return null
  const { data } = await supabase.from('practices').select('id, name').eq('notification_email', user.email).single()
  return data
}

export async function GET(request: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const practiceId = request.nextUrl.searchParams.get('id')

    if (practiceId && practiceId !== practice.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('practices')
      .select('*')
      .eq('id', practice.id)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // supabase client removed (Cognito auth)
    const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { name, ai_name, phone_number, timezone } = body

    if (!name || !phone_number) {
      return NextResponse.json({ error: 'Missing required fields: name, phone_number' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('phone_number', phone_number)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Phone number already in use' }, { status: 409 })
    }

    const { data, error } = await supabaseAdmin
      .from('practices')
      .insert({
        name,
        ai_name: ai_name || 'Ellie',
        phone_number,
        timezone: timezone || 'America/Los_Angeles',
        notification_email: user.email,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const practiceId = request.nextUrl.searchParams.get('id')
    if (!practiceId) return NextResponse.json({ error: 'Missing practice ID' }, { status: 400 })
    if (practiceId !== practice.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { id, created_at, stripe_customer_id, stripe_subscription_id, notification_email, ...updateData } = body

    const { data, error } = await supabaseAdmin
      .from('practices')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', practiceId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const practiceId = request.nextUrl.searchParams.get('id')
    if (!practiceId) return NextResponse.json({ error: 'Missing practice ID' }, { status: 400 })
    if (practiceId !== practice.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { error } = await supabaseAdmin.from('practices').delete().eq('id', practiceId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
