#!/usr/bin/env node
/**
 * One-off bulk push: warm receptionist prompt + ElevenLabs Sarah voice
 * to every existing practice's Retell LLM + agent.
 *
 * Usage:
 *   DATABASE_URL=... RETELL_API_KEY=... node scripts/push-warm-receptionist.mjs
 *
 * Optional flags:
 *   --dry-run     show what would happen, change nothing
 *   --no-voice    only update prompt, skip voice
 *   --no-prompt   only update voice, skip prompt
 *
 * Skip rules:
 *   - prompt: skip practices with non-empty ai_prompt_override
 *   - voice:  skip practices with non-NULL ai_voice_id
 *   - both:   skip rows with NULL retell_llm_id (not provisioned)
 *
 * Idempotent: Retell PATCHes are no-ops when state already matches.
 */

import { readFileSync } from 'node:fs'
import pg from 'pg'

const argv = new Set(process.argv.slice(2))
const DRY_RUN = argv.has('--dry-run')
const SKIP_VOICE = argv.has('--no-voice')
const SKIP_PROMPT = argv.has('--no-prompt')

const DATABASE_URL = process.env.DATABASE_URL
const RETELL_API_KEY = process.env.RETELL_API_KEY
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2) }
if (!RETELL_API_KEY) { console.error('RETELL_API_KEY required'); process.exit(2) }

// Inline-extract the canonical prompt + voice from the source of truth.
// (Avoids needing a TS build step here.)
const promptSrc = readFileSync('lib/aws/retell/default-prompt.ts', 'utf8')
const promptMatch = promptSrc.match(/export const HARBOR_DEFAULT_RECEPTIONIST_PROMPT = `([\s\S]*?)`\s*$/m)
const voiceMatch = promptSrc.match(/export const HARBOR_DEFAULT_RETELL_VOICE_ID = '([^']+)'/)
if (!promptMatch) { console.error('could not extract HARBOR_DEFAULT_RECEPTIONIST_PROMPT'); process.exit(2) }
if (!voiceMatch) { console.error('could not extract HARBOR_DEFAULT_RETELL_VOICE_ID'); process.exit(2) }
const PROMPT = promptMatch[1]
const VOICE_ID = voiceMatch[1]

console.log(`[push-warm-receptionist] prompt=${PROMPT.length}b voice=${VOICE_ID} dry_run=${DRY_RUN} prompt=${!SKIP_PROMPT} voice=${!SKIP_VOICE}`)

async function retellPatch(path, body) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${RETELL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` }
  }
  return { ok: true }
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('rds.amazonaws.com') ? { rejectUnauthorized: false } : false,
})
await client.connect()

const { rows } = await client.query(
  `SELECT id, name, retell_llm_id, retell_agent_id,
          ai_prompt_override, ai_voice_id
     FROM practices
    WHERE retell_llm_id IS NOT NULL
    ORDER BY created_at ASC`,
)

const summary = {
  practice_count: rows.length,
  prompt: { ok: 0, error: 0, skipped: 0 },
  voice: { ok: 0, error: 0, skipped: 0 },
  errors: [],
  skipped: [],
}

for (const r of rows) {
  // Prompt
  if (!SKIP_PROMPT) {
    const hasOverride = typeof r.ai_prompt_override === 'string' && r.ai_prompt_override.trim().length > 0
    if (hasOverride) {
      summary.prompt.skipped++
      summary.skipped.push({ practice_id: r.id, name: r.name, what: 'prompt', why: 'ai_prompt_override_set' })
    } else if (DRY_RUN) {
      summary.prompt.skipped++
    } else {
      const out = await retellPatch(`/update-retell-llm/${r.retell_llm_id}`, { general_prompt: PROMPT })
      if (out.ok) {
        summary.prompt.ok++
      } else {
        summary.prompt.error++
        summary.errors.push({ practice_id: r.id, name: r.name, what: 'prompt', error: out.error })
      }
    }
  }
  // Voice
  if (!SKIP_VOICE) {
    if (!r.retell_agent_id) {
      summary.voice.skipped++
      summary.skipped.push({ practice_id: r.id, name: r.name, what: 'voice', why: 'no_retell_agent_id' })
    } else if (typeof r.ai_voice_id === 'string' && r.ai_voice_id.trim().length > 0) {
      summary.voice.skipped++
      summary.skipped.push({ practice_id: r.id, name: r.name, what: 'voice', why: 'ai_voice_id_set' })
    } else if (DRY_RUN) {
      summary.voice.skipped++
    } else {
      const out = await retellPatch(`/update-agent/${r.retell_agent_id}`, { voice_id: VOICE_ID })
      if (out.ok) {
        summary.voice.ok++
      } else {
        summary.voice.error++
        summary.errors.push({ practice_id: r.id, name: r.name, what: 'voice', error: out.error })
      }
    }
  }
}

await client.end()

console.log(JSON.stringify(summary, null, 2))
process.exit(summary.prompt.error + summary.voice.error > 0 ? 1 : 0)
