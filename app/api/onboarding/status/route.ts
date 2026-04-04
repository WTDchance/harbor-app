// app/api/onboarding/status/route.ts
// Harbor â Onboarding checklist status
// Returns step-by-step onboarding progress for a practice

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { user }, error } = await supabase.auth.getUser(authHeader.slice(7));
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get practice_id from users table
  const { data: userRecord } = await supabase
    .from('users')
    .select('practice_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.practice_id) {
    return NextResponse.json({ error: 'No practice found' }, { status: 404 });
  }

  const practiceId = userRecord.practice_id;

  // Check if onboarding was dismissed
  const { data: practice } = await supabase
    .from('practices')
    .select('onboarding_dismissed, notification_phone')
    .eq('id', practiceId)
    .single();

  if (practice?.onboarding_dismissed) {
    return NextResponse.json({
      dismissed: true,
      steps: [],
      completedCount: 0,
      totalCount: 0,
      practicePhone: null,
    });
  }

  // Check each onboarding step in parallel
  const [callsRes, calendarRes, intakeRes] = await Promise.all([
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId),
    supabase
      .from('calendar_connections')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId),
    supabase
      .from('intake_forms')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .eq('status', 'completed'),
  ]);

  const steps = [
    {
      id: 'test_call',
      title: 'Make a test call',
      description:
        'Call your Harbor number to hear your AI receptionist in action',
      completed: (callsRes.count ?? 0) > 0,
      action: null,
    },
    {
      id: 'connect_calendar',
      title: 'Connect Google Calendar',
      description: 'Let Ellie check your availability for scheduling',
      completed: (calendarRes.count ?? 0) > 0,
      action: '/dashboard/settings',
    },
    {
      id: 'review_intake',
      title: 'Review intake forms',
      description: 'Check how patient intake paperwork is collected',
      completed: (intakeRes.count ?? 0) > 0,
      action: '/dashboard/intake',
    },
    {
      id: 'setup_forwarding',
      title: 'Set up call forwarding',
      description:
        "Forward your office phone to Harbor when you're unavailable",
      completed: false, // Manual step â always shown until dismissed
      action: null,
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;

  return NextResponse.json({
    dismissed: false,
    steps,
    completedCount,
    totalCount: steps.length,
    practicePhone: practice?.notification_phone || null,
  });
}
