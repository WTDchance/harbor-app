// lib/ehr/consents.ts
// The standard consent types Harbor expects each patient to have on file.
// Documents can be customized per-practice later; this is the canonical list
// for compliance.

export type ConsentDefinition = {
  type: string
  label: string
  description: string
  required: boolean
}

export const STANDARD_CONSENTS: ConsentDefinition[] = [
  {
    type: 'hipaa_npp',
    label: 'HIPAA Notice of Privacy Practices',
    description: 'Patient acknowledges receipt of the practice\'s HIPAA privacy notice.',
    required: true,
  },
  {
    type: 'informed_consent',
    label: 'Informed Consent to Treatment',
    description: 'General consent to engage in mental-health treatment, including risks, benefits, and alternatives.',
    required: true,
  },
  {
    type: 'financial_agreement',
    label: 'Financial Agreement',
    description: 'Fees, cancellation policy, no-show charges, and insurance authorization terms.',
    required: true,
  },
  {
    type: 'telehealth_consent',
    label: 'Telehealth Consent',
    description: 'Required if the patient participates in any session via video or phone.',
    required: false,
  },
  {
    type: 'sms_consent',
    label: 'SMS Communication Consent (TCPA)',
    description: 'Opt-in to receive appointment reminders and practice communications via text message.',
    required: false,
  },
]
