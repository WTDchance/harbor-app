import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/admin/support — list all tickets across practices (admin only)
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify admin role
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .single()

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const priority = url.searchParams.get('priority')
    const limit = parseInt(url.searchParams.get('limit') || '100')

    let query = supabaseAdmin
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (priority && priority !== 'all') {
      query = query.eq('priority', priority)
    }

    const { data: tickets, error } = await query

    if (error) {
      console.error('Admin support fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 })
    }

    // Enrich with practice names
    if (tickets && tickets.length > 0) {
      const practiceIds = [...new Set(tickets.map((t: any) => t.practice_id))]
      const { data: practices } = await supabaseAdmin
        .from('practices')
        .select('id, name')
        .in('id', practiceIds)

      const practiceMap = new Map((practices || []).map((p: any) => [p.id, p.name]))
      for (const t of tickets) {
        ;(t as any).practice_name = practiceMap.get(t.practice_id) || 'Unknown'
      }
    }

    return NextResponse.json({ tickets: tickets || [] })
  } catch (err) {
    console.error('Admin support error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
