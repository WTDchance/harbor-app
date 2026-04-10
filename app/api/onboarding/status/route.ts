// app/api/onboarding/status/route.ts
// Harbor — Onboarding checklist status
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
  const [callsRes, calendarRes, intakeDocsRes] = await Promise.all([
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId),
    supabase
      .from('calendar_connections')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId),
    supabase
      .from('intake_documents')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .eq('active', true),
  ]);

  // Logical order: test call > forwarding > calendar > intake docs
  // Why: verify it works, route real calls, enable scheduling, then paperwork
  const steps = [
    {
      id: 'test_call',
      title: 'Make a test call',
      description:
        'Call your Harbor number to hear your AI receptionist in action',
      completed: (callsRes.count ?? 0) > 0,
      action: '/dashboard/calls',
    },
    {
      id: 'setup_forwarding',
      title: 'Set up call forwarding',
      description:
        'Forward your office phone to Harbor so your receptionist can answer',
      completed: false, // Manual step — mark complete via UI toggle
      action: null,
    },
    {
      id: 'connect_calendar',
      title: 'Connect your calendar',
      description: 'Let your receptionist check availability and book appointments',
      completed: (calendarRes.count ?? 0) > 0,
      action: '/dashboard/settings',
    },
    {
      id: 'upload_intake_docs',
      title: 'Upload your intake documents',
      description:
        'Add your HIPAA notice, consent forms, and other paperwork patients should sign',
      completed: (intakeDocsRes.count ?? 0) > 0,
      action: '/dashboard/intake/documents',
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
