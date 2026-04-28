// lib/aws/ehr/patient-relationships.ts
//
// W44 T3 — symmetric inserts for patient relationship rows. When Mom
// is added as a parent of Child, a corresponding child-of row is
// inserted from Child's side so a query from either patient surfaces
// the other.

export type Relationship =
  | 'parent' | 'guardian' | 'spouse' | 'partner'
  | 'child' | 'sibling' | 'other'

export const RELATIONSHIPS: Relationship[] = [
  'parent', 'guardian', 'spouse', 'partner', 'child', 'sibling', 'other',
]

/** Compute the inverse relationship that should be auto-inserted
 *  on the other side. Asymmetric pairs (parent <-> child) flip;
 *  symmetric pairs (spouse, partner, sibling, other) stay the same. */
export function inverseRelationship(rel: Relationship): Relationship {
  switch (rel) {
    case 'parent':
    case 'guardian':
      return 'child'
    case 'child':
      // We don't know if the related party was a parent vs a guardian
      // from the child side, so default to 'parent'. The therapist can
      // edit if it should be 'guardian'.
      return 'parent'
    case 'spouse':
    case 'partner':
    case 'sibling':
    case 'other':
      return rel
  }
}

/** Whether the inverse relationship should also carry is_minor_consent.
 *  Only applies when the original relationship is parent/guardian and
 *  is_minor_consent=true on the parent's side; the *minor* side does
 *  not grant consent back to anyone, so the inverse always uses false. */
export function inverseIsMinorConsent(): boolean {
  return false
}
