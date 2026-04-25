// lib/ehr/norms.ts
// Normative reference data for interpreting assessment scores against
// general outpatient populations. Sources pinned for audit.

export type Norm = {
  instrument: string
  population: string
  mean: number
  sd: number
  /** Threshold commonly cited as "reliable change" (Jacobson & Truax). */
  reliable_change: number
  /** Minimal clinically important difference. */
  mcid: number
  source: string
}

export const NORMS: Norm[] = [
  {
    instrument: 'PHQ-9',
    population: 'Outpatient primary care at baseline',
    mean: 7.2,
    sd: 5.5,
    reliable_change: 5, // commonly cited in NICE / Kroenke literature
    mcid: 5,
    source: 'Kroenke, Spitzer, Williams (2001); Löwe et al. (2004)',
  },
  {
    instrument: 'GAD-7',
    population: 'Outpatient primary care at baseline',
    mean: 4.9,
    sd: 4.8,
    reliable_change: 4,
    mcid: 4,
    source: 'Spitzer, Kroenke, Williams, Löwe (2006)',
  },
  {
    instrument: 'PCL-5',
    population: 'General veteran baseline samples',
    mean: 28.0,
    sd: 17.5,
    reliable_change: 10,
    mcid: 10,
    source: 'Bovin et al. (2016); Weathers et al. (2013)',
  },
  {
    instrument: 'AUDIT-C',
    population: 'Primary-care adult baseline',
    mean: 2.2,
    sd: 2.4,
    reliable_change: 2,
    mcid: 2,
    source: 'Bush et al. (1998)',
  },
]

export function getNorm(instrumentId: string): Norm | null {
  const id = instrumentId.toUpperCase()
  return NORMS.find((n) => n.instrument.toUpperCase() === id) ?? null
}

/** Given a score, return a percentile (0-100) against the population. */
export function percentile(score: number, norm: Norm): number {
  // Normal CDF approximation via erf series
  const z = (score - norm.mean) / norm.sd
  const p = 0.5 * (1 + erf(z / Math.SQRT2))
  return Math.round(p * 100)
}

// Abramowitz & Stegun 7.1.26
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}
