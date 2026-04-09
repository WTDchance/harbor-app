'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

export default function ResolveButton({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('harbor_events')
        .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
        .eq('id', eventId);

      if (!error) {
        setDone(true);
        router.refresh();
      }
    });
  };

  if (done) {
    return <span className="text-xs opacity-60">Resolved</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="text-xs px-3 py-1 rounded border border-current opacity-80 hover:opacity-100 disabled:opacity-40"
    >
      {pending ? 'Resolving...' : 'Mark resolved'}
    </button>
  );
}
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

export default function ResolveButton({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('harbor_events')
        .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
        .eq('id', eventId);

      if (!error) {
        setDone(true);
        router.refresh();
      }
    });
  };

  if (done) {
    return <span className="text-xs opacity-60">Resolved</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="text-xs px-3 py-1 rounded border border-current opacity-80 hover:opacity-100 disabled:opacity-40"
    >
      {pending ? 'Resolving...' : 'Mark resolved'}
    </button>
  );
}
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ResolveButton({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('harbor_events')
        .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
        .eq('id', eventId);

      if (!error) {
        setDone(true);
        router.refresh();
      }
    });
  };

  if (done) {
    return <span className="text-xs opacity-60">Resolved</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="text-xs px-3 py-1 rounded border border-current opacity-80 hover:opacity-100 disabled:opacity-40"
    >
      {pending ? 'Resolving...' : 'Mark resolved'}
    </button>
  );
}
