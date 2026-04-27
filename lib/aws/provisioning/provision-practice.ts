// lib/aws/provisioning/provision-practice.ts
//
// Wave 29 — Practice provisioning orchestrator. Given a practice
// already created in pending_payment state (via /api/signup), this
// runs the full carrier-side provisioning:
//   1. Search SignalWire for an available number (area code if given)
//   2. Purchase + configure the SignalWire number
//   3. Clone the Retell demo agent + LLM with practice-specific defaults
//   4. Import the SignalWire number into Retell, binding to the new agent
//   5. UPDATE practices row with the IDs + provisioning_state='active'
//
// Idempotent: re-running after partial failure picks up where it left
// off based on which IDs are already populated on the practice row.

import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import {
  searchAvailableNumbers,
  purchaseAndConfigureNumber,
} from './signalwire-numbers'
import {
  cloneAgentForPractice,
  importNumberToRetell,
  rollbackRetellClone,
} from './retell-clone'

export interface ProvisionPracticeInput {
  practiceId: string
  preferredAreaCode?: string
}

export interface ProvisionPracticeResult {
  practiceId: string
  signalwirePhoneNumber: string
  signalwirePhoneSid: string
  retellAgentId: string
  retellLlmId: string
}

export async function provisionPractice(
  input: ProvisionPracticeInput,
): Promise<ProvisionPracticeResult> {
  const { practiceId, preferredAreaCode } = input

  // 1. Load practice
  const { rows: pRows } = await pool.query(
    `SELECT id, name, owner_email, signalwire_number, signalwire_phone_sid,
            retell_agent_id, retell_llm_id, provisioning_state,
            (SELECT display_name FROM therapists
              WHERE practice_id = practices.id AND is_primary = true
              ORDER BY created_at ASC LIMIT 1) AS therapist_name
       FROM practices WHERE id = $1`,
    [practiceId],
  )
  const practice = pRows[0]
  if (!practice) throw new Error(`practice_not_found:${practiceId}`)

  await auditSystemEvent({
    action: 'provision.start',
    severity: 'info',
    practiceId,
    details: {
      practice_name: practice.name,
      already_has: {
        signalwire_number: !!practice.signalwire_number,
        retell_agent: !!practice.retell_agent_id,
      },
    },
  })

  // 2. Stamp provisioning_state if needed
  if (practice.provisioning_state !== 'active') {
    await pool.query(
      `UPDATE practices SET provisioning_state = 'provisioning', updated_at = NOW() WHERE id = $1`,
      [practiceId],
    )
  }

  let signalwirePhoneNumber = practice.signalwire_number || ''
  let signalwirePhoneSid = practice.signalwire_phone_sid || ''
  let retellAgentId = practice.retell_agent_id || ''
  let retellLlmId = practice.retell_llm_id || ''

  try {
    // 3. SignalWire purchase if no number yet
    if (!signalwirePhoneNumber) {
      const available = await searchAvailableNumbers({
        areaCode: preferredAreaCode,
        limit: 5,
      })
      if (available.length === 0) throw new Error('no_signalwire_numbers_available')
      const pick = available[0]
      const purchased = await purchaseAndConfigureNumber({
        phoneNumber: pick.phoneNumber,
        friendlyName: `Harbor — ${practice.name}`,
      })
      signalwirePhoneNumber = purchased.phoneNumber
      signalwirePhoneSid = purchased.sid

      await pool.query(
        `UPDATE practices
            SET signalwire_number = $1,
                signalwire_phone_sid = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [signalwirePhoneNumber, signalwirePhoneSid, practiceId],
      )
      await auditSystemEvent({
        action: 'provision.signalwire_purchased',
        severity: 'info',
        practiceId,
        details: { phone_number: signalwirePhoneNumber, sid: signalwirePhoneSid },
      })
    }

    // 4. Retell clone if no agent yet
    if (!retellAgentId || !retellLlmId) {
      const cloned = await cloneAgentForPractice({
        practiceName: practice.name,
        therapistName: practice.therapist_name || undefined,
        practiceId,
      })
      retellAgentId = cloned.agentId
      retellLlmId = cloned.llmId

      await pool.query(
        `UPDATE practices
            SET retell_agent_id = $1,
                retell_llm_id = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [retellAgentId, retellLlmId, practiceId],
      )
      await auditSystemEvent({
        action: 'provision.retell_cloned',
        severity: 'info',
        practiceId,
        details: { agent_id: retellAgentId, llm_id: retellLlmId },
      })
    }

    // 5. Bind the SignalWire number into Retell
    await importNumberToRetell({
      phoneNumber: signalwirePhoneNumber,
      agentId: retellAgentId,
      practiceName: practice.name,
    })
    await auditSystemEvent({
      action: 'provision.retell_imported_number',
      severity: 'info',
      practiceId,
      details: { phone_number: signalwirePhoneNumber, agent_id: retellAgentId },
    })

    // 6. Mark complete
    await pool.query(
      `UPDATE practices
          SET provisioning_state = 'active',
              voice_provider = 'signalwire',
              updated_at = NOW()
        WHERE id = $1`,
      [practiceId],
    )

    await auditSystemEvent({
      action: 'provision.complete',
      severity: 'info',
      practiceId,
      details: {
        phone_number: signalwirePhoneNumber,
        agent_id: retellAgentId,
        llm_id: retellLlmId,
      },
    })

    return {
      practiceId,
      signalwirePhoneNumber,
      signalwirePhoneSid,
      retellAgentId,
      retellLlmId,
    }
  } catch (err) {
    // Mark failed but don't roll back resources we already paid for
    // (SignalWire number stays purchased; admin can re-run)
    await pool.query(
      `UPDATE practices SET provisioning_state = 'provisioning_failed', updated_at = NOW() WHERE id = $1`,
      [practiceId],
    )
    await auditSystemEvent({
      action: 'provision.failed',
      severity: 'error',
      practiceId,
      details: {
        error: (err as Error).message,
        partial: {
          signalwire_number: signalwirePhoneNumber,
          retell_agent_id: retellAgentId,
          retell_llm_id: retellLlmId,
        },
      },
    })
    throw err
  }
}
