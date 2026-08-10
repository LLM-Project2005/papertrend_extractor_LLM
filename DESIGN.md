# Papertrend Design System

## Design Thesis

Papertrend is a research instrument built from folded evidence. Its visual world
combines the precision of an academic specimen catalogue with the transformation
of origami: a flat paper enters, structured knowledge unfolds, and every insight
can be traced back to its source.

The system is deliberately two-speed:

- Public surfaces are cinematic and memorable. They use monumental typography,
  real paper imagery, specimen labels, dark fields, and deliberate motion.
- Product surfaces are quiet and operational. They use compact rails, clear data
  hierarchy, stable dimensions, and restrained origami details as wayfinding.

## Brand Grammar

- **Material:** cool paper, graphite, cobalt ink, verification cyan.
- **Signature form:** asymmetric folded planes, never decorative blobs.
- **Information motif:** catalogue numbers, hairlines, evidence coordinates, and
  short monospace labels.
- **Composition:** asymmetric grids and edge-to-edge bands. Avoid generic centered
  hero/card stacks.
- **Imagery:** paper and evidence should look inspectable, not atmospheric stock.

## Typography

- Display: Aptos Display / Segoe UI Variable Display, roman, 600 or 700.
- Interface and body: Aptos / Segoe UI Variable, 400-600.
- Metadata, IDs, stages, and labels: Cascadia Mono / SFMono.
- Letter spacing is always 0.
- Landing display: 64-140px depending on breakpoint, with tight line height.
- Product page title: 30-38px. Panel title: 16-20px.
- Body: 15-17px, 1.55-1.75 line height.
- No italic display text and no decorative serif injection.

## Color Contract

The base palette is cool and high contrast. Cobalt is the only dominant accent;
cyan communicates live processing and verified evidence. Magenta remains limited
to analytical series where an additional categorical color is required.

Light:

- Canvas `#f2f5f3`
- Surface `#fbfcfa`
- Raised `#e8eeeb`
- Ink `#10161f`
- Muted `#536273`
- Line `#ccd6d2`
- Strong line `#96a6a1`
- Cobalt `#075fce`
- Cyan `#087f8c`

Dark:

- Canvas `#070a0f`
- Surface `#0d1219`
- Raised `#151c25`
- Ink `#f1f5f3`
- Muted `#aeb9c7`
- Line `#283442`
- Strong line `#4b5c6e`
- Cobalt `#78aefe`
- Cyan `#5ce1e6`

Every component consumes semantic tokens. Hardcoded light surfaces with dark-mode
overrides are legacy and should be converted when touched. Public cinematic
feature stories intentionally stay dark in both theme preferences; docs, auth,
and product surfaces support true light and dark themes.

## Shape And Material

- Operational cards, dialogs, and inputs: 6-8px radius.
- Media frames and repeated content records: 8px maximum.
- Pills are reserved for status, filters, and a small number of primary CTAs.
- Circular controls are reserved for icon-only actions.
- Prefer hairlines, dividers, and negative space over floating card stacks.
- Shadows are rare. Overlays may use one deep, cool shadow.

## Layout Families

- **Landing:** full-bleed paper hero, specimen strip, manifesto, interactive
  capability chapters, real product state, provenance close.
- **Features:** cinematic dark chapters with one folded capability per page and
  real workflow evidence.
- **Docs:** reference manual with persistent index, readable article measure,
  section numbering, and strong current-location markers.
- **Auth:** split evidence field and direct form; reassuring, low distraction.
- **Workspace:** 60px top bar, 224px instrument rail, dense unframed content.
- **Chat:** conversation-first canvas with visible scope and evidence drawer.
- **Dashboard:** analytical canvas, comparable plots, restrained controls.
- **Library:** list-first document operations with explicit state and provenance.

## Motion

- Public motion: 450-900ms, purposeful reveals and slow paper movement.
- Product motion: 140-220ms for controls; long tasks use stage progress, not
  ornamental animation.
- Origami motion changes plane relationship or reveals information; it never
  exists as a looping decoration without meaning.
- No bounce, elastic easing, or cursor-following effects.
- Respect `prefers-reduced-motion` everywhere.

## Accessibility And Responsive Rules

- Verify 320, 375, 414, 768, 1024, and 1440px.
- No horizontal scrolling; long titles use `overflow-wrap: anywhere`.
- Click targets are at least 40px and primary mobile actions are 44px.
- Focus rings use the action token and remain visible in both themes.
- Color never carries status alone.
- Mobile navigation is a real labelled drawer, not compressed desktop links.
- Hero content leaves a visible hint of the following section.

## Hallmark Pre-Emit Critique

Philosophy 5 / Hierarchy 5 / Execution 4 / Specificity 5 / Restraint 4 / Variety 5
