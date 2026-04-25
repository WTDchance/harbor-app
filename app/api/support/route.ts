import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolvePracticeIdForApi } from '@/lib/active-practice'

// GET /api/support — list tickets for the authenticated practice
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get practice_id from user (respects admin act-as cookie)
    const practiceId = await resolvePracticeIdForApi(supabaseAdmin, session.user)
    if (!practiceId) {
      return NextResponse.json({ error: 'No practice found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const category = url.searchParams.get('category')
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    let query = supabaseAdmin
      .from('support_tickets')
      .select('*', { count: 'exact' })
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (category && category !== 'all') {
      query = query.eq('category', category)
    }

    const { data: tickets, error, count } = await query

    if (error) {
      console.error('Error fetching support tickets:', error)
      return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 })
    }

    return NextResponse.json({ tickets: tickets || [], total: count || 0 })
  } catch (err) {
    console.error('Support GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/support — create a new support ticket
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const practiceId = await resolvePracticeIdForApi(supabaseAdmin, session.user)
    if (!practiceId) {
      return NextResponse.json({ error: 'No practice found' }, { status: 404 })
    }

    const body = await request.json()
    const { subject, description, category, priority, page_url, browser_info } = body

    if (!subject || !description) {
      return NextResponse.json({ error: 'Subject and description are required' }, { status: 400 })
    }

    const validCategories = ['voice_calls', 'intake', 'scheduling', 'billing', 'dashboard', 'sms', 'other']
    const validPriorities = ['low', 'medium', 'high', 'critical']

    const { data: ticket, error } = await supabaseAdmin
      .from('support_tickets')
      .insert({
        practice_id: practiceId,
        user_id: session.user.id,
        subject,
        description,
        category: validCategories.includes(category) ? category : 'other',
        priority: validPriorities.includes(priority) ? priority : 'medium',
        page_url: page_url || null,
        browser_info: browser_info || null,
        status: 'open',
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating support ticket:', error)
      return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
    }

    return NextResponse.json({ ticket }, { status: 201 })
  } catch (err) {
    console.error('Support POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
