# Pressure Suite design system

The single source of truth for how the frontend looks. When code and this file disagree, this file wins; when this
file is missing something, add it here first, then build it.

## Direction

A test console used at a bench during real pressure tests. Dense, calm, legible at a glance, numbers first. It
should read like engineering software (lab instrument front panels, DAQ software, mission control), not a SaaS
dashboard.

What that means in practice:

- The answer is the biggest thing on screen. Key results are large mono readouts; inputs are compact.
- Flat surfaces separated by hairline rules. No cards floating on grey, no cards inside cards.
- Colour carries meaning only. Grey does the layout; the accent marks what you can operate; status colours mark
  state; the chart palette marks data series. Nothing is coloured for decoration.
- Every number, unit and input value is set in the mono face, so columns of figures line up.
- Same thing, same place, same colour on every tab: tool actions top right, inputs on the left, the test vessel
  always the same chart colour.

## Tokens

Defined once in `frontend/src/index.css` as CSS variables inside Tailwind v4 `@theme`, so they become utilities
(`bg-surface`, `text-muted`, `border-rule`) and a dark theme can later override the variables without touching
components. Components refer to roles, never to hue names or hex values.

- The block is `@theme static`, so every variable is emitted even when no utility uses it (the data colours are
  only read from SVG and Recharts props).
- Where a colour value is needed instead of a class (SVG attributes, Recharts props, inline styles), import it from
  `frontend/src/shared/theme.ts` (`COLOR`, `DATA_VESSEL`, `sourceColor(i)`), which hands out `var(--color-...)`
  references. No hex values outside `index.css`, `theme.ts` comments and the favicon in `index.html`.
- Utilities: colours as `bg-surface`, `text-muted`, `border-rule-strong`, `text-crit-ink`, `bg-warn-tint`; type as
  `text-label`, `text-small`, `text-body`, `text-readout-sm`, `text-readout`; radius `rounded-control`; shadow
  `shadow-raised`.

### Colour: surfaces and ink

| Token | Value | Use |
|---|---|---|
| `bg` | `#E9EAE6` | Page / panel grey, the console face |
| `surface` | `#F6F6F3` | Panels, top bar, toolbar, status bar, tooltips |
| `inset` | `#FFFFFF` | Input wells and table bodies that hold inputs |
| `ink` | `#15171A` | Primary text, readout values |
| `muted` | `#5C6166` | Labels, units, secondary lines, tick labels |
| `rule` | `#C6C8C3` | Hairlines: panel rules, table row rules, chart grid |
| `rule-strong` | `#82868A` | Input well borders, axis lines, idle lamp, table header rule |

`rule-strong` is darker than the first draft (`#8E9296`) so input wells reach 3:1 against `surface` (3.39) and
`inset` (3.67), the WCAG minimum for a control boundary. `rule` is decorative separation only and never the sole
boundary of a control.

### Colour: accent (interactive elements and focus ONLY)

| Token | Value | Use |
|---|---|---|
| `accent` | `#2350A0` | Primary button fill, active tab underline, active segment marker, focus ring, links, checked checkbox/switch |
| `accent-hover` | `#1B4085` | Hover/pressed state of accent fills |
| `accent-tint` | `#E3EAF6` | Drop-zone highlight while dragging, hover wash on quiet buttons |
| `on-accent` | `#FFFFFF` | Text and icons on an `accent` fill |

Contrast: 7.1:1 on `surface`, 6.4:1 on `bg`. White text on `accent` is 8.4:1.

The accent never marks data, status or a heading. If something is blue and you cannot click, focus or drag it, it is
wrong.

### Colour: status (state ONLY, never decoration)

Each status has a mark colour (lamps, left bars, chart reference marks; non-text, needs 3:1), an ink colour for text
(needs 4.5:1), and a tint for callout backgrounds.

| Status | Mark | Ink (text) | Tint | Meaning |
|---|---|---|---|---|
| `ok` | `#2E7D32` | `#256B29` | `#E6F0E6` | Target reached, check passed |
| `warn` | `#B7791F` | `#8A5A12` | `#F7EEDD` | Worth acting on: short of target, a limit hit, stale result |
| `crit` | `#C62828` | `#B02222` | `#F8E5E4` | Safety-critical or input error: pneumatic energy, trapped gas, flashing liquid, invalid input |
| `idle` | `rule-strong` | `muted` | none | Neutral state: not run, not needed, equalized |

Contrast of the inks: ok 6.0, warn 5.5, crit 6.3 on `surface`; all above 4.8 on their own tint. The mark colours
are not used for text (warn mark is 3.4:1, below text contrast).

`crit` follows the owner's rule: red only for things people must know. A plain modelling caveat is `warn` or an
assumption, never `crit`.

### Colour: data series (charts and the things charts stand for)

One categorical palette, kept apart from the accent and status hues (no mid-blue, no green, no amber, no red), with
a fixed meaning per slot. Validated with the dataviz palette checker against `surface` (light): lightness band,
chroma floor, adjacent-pair CVD separation (worst ΔE 12.3, deutan), normal-vision floor (worst ΔE 17.1) and 3:1
contrast all pass.

| Token | Value | Fixed meaning |
|---|---|---|
| `data-vessel` | `#00939F` teal | The vessel under test, on every tab: COPV pressure, hydro tank pressure, gas test vessel pressure, the COPV illustration fill |
| `data-1` | `#8C4BC9` purple | Source 1 in inventory order |
| `data-2` | `#B8612A` copper | Source 2 |
| `data-3` | `#C93E8E` magenta | Source 3 |
| `data-4` | `#7F8C1A` olive | Source 4 |
| `data-5` | `#5B6BD6` indigo | Source 5 |
| `data-other` | `muted` | Source 6 and beyond: still listed in the legend and the table |

Rules:

- Colour follows the entity, never its rank. A source keeps its slot when others are removed from a chart, and the
  inventory tile shows the same colour as its chart line (small square swatch next to its name).
- Derived lines of the same entity reuse its colour with a different stroke: the COPV settled pressure is
  `data-vessel` dashed; a source's temperature is its colour in the temperature chart.
- Measured points (end-of-hold readings) are `ink` markers, 8px, with a 2px `surface` ring: a different shape
  carries the meaning, not a new hue.
- Target and limit reference lines are `rule-strong`, dashed, with a mono label.
- Fluids (N2, He) are identified by text (`N₂`, `He` in mono), not by colour.
- Dark mode gets its own validated steps later; do not auto-invert.

### Type

Bundled with `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` (imported in `main.tsx`, files emitted by
Vite into `dist`). No Google Fonts, no CDN, no runtime requests. Latin subset, weights 400, 500, 600.

| Token | Family | Use |
|---|---|---|
| `font-sans` | IBM Plex Sans | All UI text: labels, headings, buttons, notes |
| `font-mono` | IBM Plex Mono | Every number, unit, input value, table cell with figures, readout, chart tick and tooltip |

Scale (px / line height). Use only these; no other `text-[..]` sizes.

| Step | Size | Use |
|---|---|---|
| `label` | 11 / 14, 500, uppercase, tracking 0.06em, `muted` | Section and panel labels, field labels, table headers, readout labels, axis titles |
| `small` | 12 / 16 | Secondary lines, sub-lines under readouts, table cells, notes |
| `body` | 13 / 18 | Default UI text, input values, buttons |
| `readout-sm` | 16 / 20, mono 500 | Secondary readouts |
| `readout` | 28 / 32, mono 500 | Key results (test pressure, energy, settled pressure, gas needed) |

Field labels: the field label is `label` style too, but in sentence case is acceptable where an uppercase label would
shout across a dense grid of fields. Pick one per surface and keep it: inputs columns use uppercase labels.

### Shape and depth

- Radius: `2px` on controls (inputs, selects, buttons, segments, lamps excluded: lamps are square, 0). `0` on panels,
  bars, tables, modals, tooltips. No other radii, no `rounded-full` anywhere (switch knobs are squares too).
- Borders: 1px. The only 2px lines are the active tab / active segment underline, the focus ring, and primary chart
  lines.
- Shadows: none, except the drag overlay and the modal editors (one shared value, `--shadow-raised`).

### Spacing

4px grid, tighter than the old layout.

| Use | Value |
|---|---|
| Label to well | 4px |
| Between fields in a grid | 8px column, 12px row |
| Panel body padding | 12px |
| Panel header height | 32px |
| Between panels in a column | 0: panels stack, separated by their rule (a column is one continuous face) |
| Between the inputs column and results | 1px rule (`rule`), no gutter gap |
| Control height | 28px (inputs, selects, buttons, segments) |
| Table row | 28px for figures, 36px for rows with inputs |

## Layout

### App shell

```
+--------------------------------------------------------------------------------+
| PRESSURE SUITE   COPV Fill |    Stored Energy | Hydrostatic Test | Gas Test     |  top bar, surface, rule below
+--------------------------------------------------------------------------------+
| Hydrostatic Test                                       Export  Import  Reset    |  toolbar, 40px
+----------------------+---------------------------------------------------------+
| INPUTS (320px fixed) | RESULTS (flex)                                          |
|                      |                                                         |
+----------------------+---------------------------------------------------------+
| * Backend connected · CoolProp 8.0.0 · HEOS · N2 Span… · Gauge rel. 1 bar a      |  status bar, 24px, fixed
+--------------------------------------------------------------------------------+
```

- Wordmark "PRESSURE SUITE" (the product name is "Pressure Suite", two words) in Plex Sans 600, tracking 0.08em,
  `ink`. No logo graphic is required; the favicon is a flat square glyph in `ink` and `accent` (hex written in
  `index.html`, the only place outside `index.css` where token hex values may appear).
- `document.title`: `<Tool name> · Pressure Suite`; `index.html` `<title>`: `Pressure Suite`.
- Tabs: flat text, `body` size, `muted`; the active tab is `ink` with a 2px `accent` underline flush with the bar's
  bottom rule. Hover: `ink`. No filled tab backgrounds.
- `ToolLayout` (`frontend/src/shared/ToolLayout.tsx`, used by every tool; `BarControl` puts a label beside a tool-bar control): toolbar with the tool name on the left (`body` 600) and
  Export / Import / Reset on the right in that order, always secondary buttons. Optional toolbar controls (Cascade
  Fill's ambient, model and mode) sit between the name and the actions. Below: a fixed 320px inputs column on
  `surface`, a 1px rule, and the results column on `bg`. Below `lg` the columns stack.
- Status bar (`frontend/src/shared/StatusBar.tsx`, conventions per tool in `tools/index.ts` `gauge` / `gaugeDetail`, the long text as its tooltip; it re-checks the backend every 15 s): fixed to the bottom, `surface`, rule above, `small` mono. Left to right: backend lamp (`ok` "Backend
  connected" / `crit` "Backend not reachable: start it with python run.py in backend/"), CoolProp version, backend,
  equations of state, and the gauge convention for the active tool (Cascade Fill: "barg relative to 1 atm; sources
  quoted at 20 °C"; the calculator tabs: "barg relative to 1 bar a"). Long text truncates with a `title` tooltip.

### Results column

Order on every tool: errors and safety-critical notes first, then the key readout strip, then the working tables,
then charts, then non-critical notes, then Assumptions (collapsed).

## Components

### Panel

A flat section, not a card.

- Header: 32px, `label` style title on the left, optional controls on the right (`aside`), 1px `rule` below.
- Body: 12px padding, no border of its own; consecutive panels are separated by the next panel's top rule.
- Collapsible panels keep their behaviour: a small chevron before the label, `aria-expanded`, and `collapsedAside`
  shows a one-line mono result while folded.
- Never nest a Panel in a Panel. Sub-groups inside a panel use a `label` heading and 12px top margin, or a rule.

### NumberField, OptionalNumberField, SelectField, text input

- Well: `inset` background, 1px `rule-strong` border, 2px radius, 28px high.
- Value: `font-mono`, `body` size, left-aligned in forms, right-aligned when the field sits in a table column.
- Unit: inside the well at its right end (mono, `small`, `muted`, right-aligned, no reserved width), so units line
  up on the right edge down a column of equal-width fields. A fixed-width slot was tried and dropped: it squeezed
  values in narrow fields and left short units floating mid-well.
- Labels sit above the well; when a label wraps, the well stays bottom-aligned with its row neighbours.
- Focus: 2px `accent` ring replacing the border colour (no glow, no offset).
- Disabled: `bg` background, `muted` value.
- Invalid (out of range while typing): border `crit`; the value is not committed (existing behaviour).
- Placeholder ("not read", "–") in `muted`.
- Select: same well, a small chevron in the unit slot, native `<select>` kept.
- `hint` text under a field is only for information the label cannot carry (e.g. "= 301 bar a"). Explanations go in
  `title`.

### Readout (replaces Stat)

```
TEST PRESSURE
300 barg
highest cycle target
```

- Label: `label` style.
- Value: `font-mono`; `readout` (28px) for key results, `readout-sm` (16px) for the rest. The unit is set beside the
  value in `small` mono `muted`, baseline-aligned. Value and unit are separate props so the unit is never typed into
  the value string.
- Sub-line: `small`, `muted`, mono when it is figures.
- Optional status: a lamp before the sub-line (e.g. ok "Target reached", warn "Short by 4.2 bar").
- A readout strip is a row of readouts separated by 1px vertical `rule`s, no boxes around each.

### Status lamp (replaces Chip)

An 8px square in the status mark colour, then the text in `small` (`ink`, or the status ink for warn/crit). No pill,
no dot, no background. States: `ok`, `warn`, `crit`, `idle`. Never colour alone: the text always says the state.

Cascade Fill step statuses map to lamps:

| Status | Lamp |
|---|---|
| `target_reached`, `filled` | ok |
| `inlet_limit`, `outlet_limit`, `ratio_limit`, `no_flow` | warn |
| `fluid_mismatch` | crit |
| `equalized`, `vented`, `feeds_pump`, `cooled`, `not_needed` | idle |

Fluid tags (`N₂`, `He`) are plain mono text, not chips.

### Buttons

Exactly three styles, all 28px, 2px radius, `body` 500:

| Style | Look | Use |
|---|---|---|
| Primary | Solid `accent`, white text, hover `accent-hover` | The one main action in a region: Add cycle, Add run, Fill next COPV, Check gas, Run optimizer, Done |
| Secondary | 1px `rule-strong` border, `surface` fill, `ink` text, hover `inset` | Export / Import / Reset, Set up…, links between tabs ("Stored energy details →"), Cancel |
| Quiet | Text only, `accent` text, hover `accent-tint` wash | Inline actions: Clear, Undo, Settings, Use cycle target |

At most one primary button per panel. Icon buttons (remove ×, edit, delete) are quiet, 24px square, `muted`
icon, hover `ink` (delete hover `crit-ink`). The dark navy and sky variants are removed.

### Segmented control and tabs

- Segmented: a row of joined squared buttons inside one 1px `rule-strong` border, 2px outer radius, 28px high.
  Inactive: `surface`, `muted` text. Active: `inset` background, `ink` 600 text, 2px `accent` bar along the bottom.
  No floating white pill, no shadow.
- Tabs (top bar and any in-panel view switch, e.g. Cascade Fill plots): text with the 2px `accent` underline.

### Toggle, checkbox and switch

- Checkbox: native, 14px, `accent-color: var(--color-accent)`, label in `body`.
- Switch (Cascade Fill equipment): 28×16 track with 2px radius, square 12px knob; off `rule-strong` track, on
  `accent`. No round knobs.

### Notes and callouts

- A callout is a block with a 3px left bar in the status mark colour, the status tint as background, text in the
  status ink, no border, no radius, `small` size. A small square warning glyph may precede critical text.
- Levels: `critical` and input errors use `crit` (role="alert", always visible, listed first); `note` uses `warn`;
  `assumption` is never a callout: it goes in the collapsed Assumptions list.
- Assumptions: a `details` element with a `label`-style summary "ASSUMPTIONS (n)", list in `small` `muted`.
- Safety-critical notes stay visible and are never moved into tooltips or Assumptions.

### Tables

- Header row: `label` style, bottom 1px `rule-strong`, units under the name in `muted` lowercase mono.
- Body: mono figures, right-aligned numbers, left-aligned text; 1px `rule` between rows; no zebra stripes.
- Footer/total row: top 1px `rule-strong`, values 600.
- Inputs inside tables use the right-aligned well variant without per-cell units (units sit in the header).
- Row hover: none (tables are read, not selected). A row that is out of tolerance gets a warn lamp in its status cell,
  not a coloured row background.

### Charts (applied in phase 4)

One shared Recharts theme module (`frontend/src/shared/chartTheme.tsx`): `gridProps`, `axisProps` / `yAxisProps`,
`cursorProps`, `lineProps(color, 'vessel' | 'series', dash?)`, `referenceProps(label)`, and the `ChartFrame`,
`ChartLegend`, `ChartTooltip` and `Swatch` components. Every chart uses them; no chart sets its own colours or fonts.

- Axis titles sit outside the plot: the y title above it on the left, the x title under it on the right, both in
  the label style with the unit after a middle dot ("PRESSURE · BARG", "TIME · MIN"). Ticks carry numbers only.
- Toggleable legends (Cascade Fill timeline): each entry is a button with `aria-pressed`; a hidden series shows a
  `rule` swatch and struck-through muted text, and keeps its colour when it comes back.
- Reference lines extend the y domain so a target is always in view.

- Grid: horizontal only, `rule`, 1px. Axis lines `rule-strong`, no tick marks.
- Tick labels: mono 11px `muted`. Axis titles: `label` style, units in the title ("PRESSURE · BARG"), not on every
  tick.
- Lines: 2px for the vessel series, 1.5px for sources and derived series; linear interpolation; no animation;
  no dots except measured points.
- Legend: above the plot, left-aligned, a 14×2px SVG line swatch (dashed like its line) per series plus its label in `small` `ink`. Present for 2+
  series, absent for one (the panel title names it). A filter that hides series must not recolour the rest.
- Tooltip: `surface` background, 1px `rule-strong` border, no radius, no shadow, header in `label` style, values mono.
  Crosshair cursor line in `rule-strong`.
- One y-axis per chart, never dual-axis.

### Modal editors and drag overlay

- Modal: `surface`, no radius, 1px `rule-strong` border, `--shadow-raised`, backdrop `ink` at 30 % opacity. Header is
  a Panel header; footer has the primary "Done".
- Drag overlay: the dragged item as a tile with `--shadow-raised` and a 1px `accent` border. Drop zones show
  `accent-tint` with a 1px dashed `accent` outline while a compatible item is dragged.

### Icons and illustrations

- Line icons in `muted` (or `ink` when they label something), 16px in rows, 24px in tiles. No per-type icon hues
  (no amber pumps, teal heat exchanger, cyan cool-down).
- Inventory sources show their data-series swatch, so they match their chart line.
- The COPV illustration: outline in `ink`, empty part `inset`, fill in `data-vessel`, target line `rule-strong`
  dashed with a mono label.

## Copy rules

- No helper text that repeats the label. A field called "Pressurisation rate" needs no "the rate of pressurisation".
- Longer explanations go into a `title` tooltip on the label, or the Assumptions section.
- Keep: units, conventions that change a number ("= 301 bar a"), and every safety-critical note.
- Sentence case for buttons and field labels; uppercase only via the `label` style.
- Product name: "Pressure Suite". Tool names as in `tools/index.ts`, with the cascade-fill tool shown as "COPV Fill" (its Method control offers "Cascade fill").

## Ban list

Do not use, in any component:

- Default Tailwind palette classes (`slate`, `gray`, `sky`, `blue`, `rose`, `red`, `amber`, `yellow`, `emerald`,
  `green`, `teal`, `cyan`, `violet`, `indigo`, `orange`, `white`, `black`). Use the tokens.
- Hex colours in components. Charts and SVG take colours from `chartTheme.ts` / CSS variables.
- White rounded cards floating on grey; cards nested inside cards; `ring-2` emphasis frames.
- Pill chips with dots; `rounded-full` anywhere.
- Unicode ✓ / ⚠ as status markers (use the lamp).
- Coloured backgrounds that encode item type (cyan cool-down cards, amber pump cards, teal heat exchanger).
- Gradients, glassmorphism, blur, glows, opacity-stacked tints as decoration.
- Emoji.
- Mixed radii (anything other than 2px on controls and 0 elsewhere).
- More than one primary button style; dark navy buttons.
- `system-ui` or any font other than the two bundled Plex families; `tabular-nums` on the sans face as a stand-in for
  mono.
- Shadows other than `--shadow-raised` on the drag overlay and modals.
- Decorative use of the accent or status colours (headings, icons, borders that do not mean state or interaction).
- Font sizes off the type scale.
- Any runtime network request for fonts, icons or styles.

## Audit of the current frontend (before phase 1)

What the code does today, so each phase knows what it is replacing.

- `index.css`: `system-ui`, body `#f1f5f9`, no tokens. `index.html` title "pressuresuite", favicon a rounded
  `#2a78d6` capsule.
- `App.tsx`: `slate-900` navy nav with a capsule logo, "pressuresuite" wordmark, white rounded-top tabs;
  `document.title` uses "pressuresuite".
- `shared/ui.tsx`: Panel is a `rounded-xl` white card with `ring-slate-200`; fields are `rounded-md` with a
  `sky-500` focus ring and sans tabular numbers; Segmented is a floating white pill; Chip is a rounded-full pill;
  Callout uses rose/amber rounded boxes; Stat has no unit slot (units are concatenated into the value string, e.g.
  `` `${fmtP(x)} barg` ``, so phase 2 must split value and unit at each call site).
- Button styles in use: sky solid (Add cycle, Add run, Replace cycles), slate-800 solid (Fill next COPV, modal Done),
  sky-700 solid (Check gas), sky outline (Set up…, Add to sequence, LinkButton), slate outline (Export/Import/Reset,
  two different sizes), text links (Settings, Undo, Clear). Six styles to collapse into three.
- Shells: Stored Energy, Hydrostatic Test and Gas Test share the same aside + main layout, each with its own copy
  of the `ToolActions` row and its own footer text. Cascade Fill uses a different shell: its own TopBar (one-off
  orange ambient block, model and mode segments, time switch, its own Export/Import/Reset), a 256px left sidebar,
  and a footer with CoolProp and convention text.
- Hard-coded hex: three chart `INK` objects and two palettes (`cycles.tsx`, `FillChart.tsx`, `TimelineCharts.tsx`),
  the COPV illustration in `CopvCard.tsx` and `SequenceLane.tsx` (fill `#2a78d6` N2 / `#4a3aa7` He, outline
  `#334155`), the logo.
- Palette classes: about 360 `slate`, 70 `sky`, 40 `amber`, 27 `rose`, 19 `emerald`, plus `cyan`, `teal`,
  `indigo`, `violet`, `orange` for step types and statuses (`cascade-fill/format.ts` `STATUS` and `FLUIDS`).
- Radii in use: `md`, `lg`, `xl`, `2xl`, `full`, `t-lg`. Shadows: `sm`, `lg`, `xl`, `2xl`.
- Cascade Fill specifics: the fill sequence lane has `min-h-40` and stretches to the COPV card height
  (`2xl:items-stretch` + `h-full`), leaving a large empty area; source cards are `w-64` white cards inside the
  inventory card; step cards are tinted by type; status uses Chips with ✓/⚠; the COPV card has a `ring-2` dark
  frame.
- Repeated helper text to cut or move to tooltips: "Off: the tank is treated as rigid…" (Expansion panel), "One
  hold: start and end pressure…" and "For every test hold, turn on…" (Leak panel), "Drag into the gas inventory…"
  and "Click to edit…" (Cascade sidebar), "Pressures are gauge, quoted at 20 °C…" (inventory aside, moves to the
  status bar), the hint under the Thermodynamic model segment, long volume-check intro paragraph.

## Phase 5 decisions (per tool)

- Lists inside a panel are rows or tiles, never cards: sidebar components and equipment are full-width rows split by
  `rule`; gas inventory sources are tiles in a row split by `rule`, bleeding to the panel edges. Only sequence steps
  keep a box, because they are drag targets in a lane.
- Step type and fluid are text and an ink icon; no type tints (cool-down, pump, heat exchanger) and no fluid colours.
- The fill sequence lane is as tall as its content; at 2xl the surface under it fills the row beside the COPV card.
- Helper text that explains rather than states a value moves to a `title` tooltip (gas supply hints, wall toggles,
  Record readings, lane and volume-check explanations). Values stay visible (absolute pressure, leak flows), as do
  all warn and crit notes.
- Table inputs drop their unit; the unit sits under the column header in mono.
- The tool bar uses a 16px gap below 2xl, and the ambient K conversion shows only at 2xl, so it stays on one line
  at 1280.
