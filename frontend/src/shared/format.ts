/** Fixed-decimal number with thousands separators. */
export function fmt(value: number, digits = 1): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Significant-figure formatting for values that span many orders of magnitude (energies, masses). */
export function fmtSig(value: number, sig = 3): string {
  if (!Number.isFinite(value)) return '–'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || abs < 1e-3) return value.toExponential(sig - 1).replace('e+', 'e')
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)))
  return fmt(value, digits)
}

/** Energy in J, kJ or MJ, whichever reads best, as [value, unit]. Input in kJ. */
export function energyParts(kj: number): [string, string] {
  const abs = Math.abs(kj)
  if (abs >= 1000) return [fmtSig(kj / 1000), 'MJ']
  if (abs >= 1) return [fmtSig(kj), 'kJ']
  return [fmtSig(kj * 1000), 'J']
}

/** Energy in J, kJ or MJ, whichever reads best. Input in kJ. */
export function fmtEnergy(kj: number): string {
  return energyParts(kj).join(' ')
}

/** Minutes as "45 min" or "2 h 05 min". */
export function fmtMin(min: number): string {
  if (min < 60) return `${fmt(min, min < 10 ? 1 : 0)} min`
  const total = Math.round(min)
  const h = Math.floor(total / 60)
  const m = String(total - h * 60).padStart(2, '0')
  if (h < 48) return `${h} h ${m} min`
  return `${Math.floor(h / 24)} d ${h % 24} h ${m} min`
}

/** Pressure without trailing zeros: 300, 298.5, 0.25. */
export function fmtP(value: number, maxDigits = 2): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: maxDigits })
}
