/**
 * Design tokens for places that need a colour value rather than a class: SVG attributes, Recharts props and inline
 * styles. Each is a reference to the CSS variable defined in index.css, so a theme override reaches them too.
 * DESIGN.md documents what each one means.
 */

const v = (name: string) => `var(--color-${name})`

export const COLOR = {
  bg: v('bg'),
  surface: v('surface'),
  inset: v('inset'),
  ink: v('ink'),
  muted: v('muted'),
  rule: v('rule'),
  ruleStrong: v('rule-strong'),
  accent: v('accent'),
  ok: v('ok'),
  warn: v('warn'),
  crit: v('crit'),
} as const

/** The vessel under test (COPV, hydro tank, gas test vessel): the same colour on every tab. */
export const DATA_VESSEL = v('data-vessel')

/** Sources in inventory order. Past the end, series fall back to DATA_OTHER (still listed in legends and tables). */
export const DATA_SERIES = [v('data-1'), v('data-2'), v('data-3'), v('data-4'), v('data-5')] as const
export const DATA_OTHER = v('data-other')

/** Colour of the source at position `index` in the inventory. */
export const sourceColor = (index: number) => DATA_SERIES[index] ?? DATA_OTHER
