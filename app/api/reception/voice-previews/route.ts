// W52 D6 — voice preview audio URLs.
//
// Returns a static catalog of preview MP3 URLs the practice can hit
// during onboarding. URLs come from env vars so the production catalog
// can be updated without a redeploy.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VOICES = [
  { id: 'eleven-labs-rachel', name: 'Rachel', envKey: 'HARBOR_VOICE_PREVIEW_RACHEL_URL' },
  { id: 'eleven-labs-bella',  name: 'Bella',  envKey: 'HARBOR_VOICE_PREVIEW_BELLA_URL' },
  { id: 'eleven-labs-adam',   name: 'Adam',   envKey: 'HARBOR_VOICE_PREVIEW_ADAM_URL' },
  { id: 'eleven-labs-antoni', name: 'Antoni', envKey: 'HARBOR_VOICE_PREVIEW_ANTONI_URL' },
  { id: 'play-ht-jennifer',   name: 'Jennifer', envKey: 'HARBOR_VOICE_PREVIEW_JENNIFER_URL' },
] as const

export async function GET() {
  const previews = VOICES.map(v => ({
    id: v.id,
    name: v.name,
    audio_url: process.env[v.envKey] ?? null,
  }))
  return NextResponse.json({ previews })
}
