# Papertrend Design System

## Product Character

Papertrend is a research workspace, not a marketing dashboard. It should feel
precise, calm, editorial, and trustworthy. Public surfaces explain the product
through real workflow structure. Product surfaces prioritize repeated work,
scanning, comparison, and clear system status.

## Visual Direction

- Preserve the existing ink, white, blue, cyan, and restrained magenta identity.
- Use blue for actions and selected evidence. Use cyan for active processing and
  verified system state. Use magenta sparingly for analytical contrast.
- Avoid decorative gradients, glowing blobs, oversized pills, and nested cards.
- Public pages may be spacious and editorial. Workspace pages remain compact.
- Cards are individual records or tools only. Page sections are unframed bands.
- Maximum standard radius is 8px. Circular controls and status dots are exempt.

## Typography

- Display and editorial headings: Iowan/Palatino editorial serif stack, roman only.
- UI, body, labels, and controls: Aptos/Segoe UI variable system stack.
- Data, IDs, timestamps, and technical labels: Cascadia/SFMono stack.
- Fonts are local-first so builds never depend on an external font CDN.
- Letter spacing is always 0.
- Hero headings: 48-72px desktop, 38-48px mobile.
- Product page headings: 28-36px. Panel headings: 16-20px.
- Body copy: 15-17px with 1.55-1.75 line height.

## Color Tokens

Light:

- Canvas `#f6f8fb`
- Surface `#ffffff`
- Raised surface `#fbfcfe`
- Ink `#172033`
- Muted ink `#637087`
- Hairline `#dce2ea`
- Strong hairline `#bcc7d6`
- Action `#175cd3`
- Action hover `#124aa9`
- Signal cyan `#087f8c`
- Signal magenta `#a23b72`

Dark:

- Canvas `#0b1018`
- Surface `#101722`
- Raised surface `#151e2b`
- Ink `#eef3f8`
- Muted ink `#9eabbc`
- Hairline `#263244`
- Strong hairline `#3a4a60`
- Action `#75a7ff`
- Signal cyan `#55c8d2`
- Signal magenta `#e08ab5`

## Layout

- Public maximum width: 1200px.
- Product maximum width: 1600px.
- Marketing navigation: 64px.
- Workspace header: 60px.
- Desktop workspace rail: 224px and persistent; mobile uses a modal drawer.
- Product gutters: 16px mobile, 24px tablet, 32px desktop.
- Use 4px/8px spacing increments.

## Components

- Primary buttons are compact rectangles with 6px radius and visible focus.
- Icon-only buttons are square or circular and always have an accessible label.
- Inputs are 40-44px high with a strong focus ring and persistent labels.
- Tabs use a bottom/side selection marker or segmented control, not loose pills.
- Status uses icon, label, and color together. Color is never the only signal.
- Modals use a restrained 8px frame, sticky header/footer when needed, and a
  clear Escape/backdrop close contract.
- Tables and lists are preferred over card grids for operational collections.

## Motion

- Motion intensity: 3/10. Density: public 4/10, product 7/10.
- Use 140-220ms transitions for controls and 300-500ms reveals for marketing.
- No bounce or elastic easing. Respect `prefers-reduced-motion`.
- Loading must explain the current stage and preserve stable layout dimensions.

## Responsive And Accessibility

- Verify at 320, 375, 414, 768, 1024, and 1440px.
- No horizontal page scrolling. Long titles use `overflow-wrap: anywhere`.
- Interactive targets are at least 40px; primary mobile actions are 44px.
- Focus indicators remain visible in both themes.
- Contrast targets WCAG AA. Do not place muted gray text on colored surfaces.
- Navigation, dialogs, menus, status, and charts require semantic labels.

## Page Families

- Landing: editorial research narrative with a real product workflow preview.
- Features: one capability per page, alternating evidence and workflow bands.
- Docs: reference layout with persistent navigation and readable article measure.
- Auth/onboarding: direct, reassuring, low-distraction forms.
- Workspace: dense operational shell with repository context always visible.
- Chat: conversation-first canvas with compact tools and explicit evidence scope.
- Dashboard: analytical canvas with restrained chrome and comparable charts.
- Library: list-first document operations, obvious statuses, predictable actions.
