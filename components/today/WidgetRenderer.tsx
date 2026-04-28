// components/today/WidgetRenderer.tsx
//
// W47 T0 — switch-by-id renderer that drives Today off the user's
// saved widget order. Unknown IDs render nothing (forward-compat:
// retiring a widget doesn't break a saved layout).

'use client'

import type { WidgetId } from '@/lib/ui/widget-registry'

import AIBriefWidget          from './widgets/AIBrief'
import EngagementTrendsWidget from './widgets/EngagementTrends'
import MoodHeatmapWidget      from './widgets/MoodHeatmapPracticeAggregate'

interface WidgetRendererProps {
  ids: WidgetId[]
  /** Sections we render inline rather than as standalone components
   *  (need state from the page itself — appointments, attention,
   *  activity). Pass these as props from the page. */
  inlineSlots: Partial<Record<WidgetId, React.ReactNode>>
}

export default function WidgetRenderer({ ids, inlineSlots }: WidgetRendererProps) {
  return (
    <>
      {ids.map((id) => {
        if (inlineSlots[id]) return <div key={id}>{inlineSlots[id]}</div>
        switch (id) {
          case 'ai_brief':         return <AIBriefWidget key={id} />
          case 'engagement_trends':return <EngagementTrendsWidget key={id} />
          case 'mood_heatmap':     return <MoodHeatmapWidget key={id} />
          default: return null
        }
      })}
    </>
  )
}
