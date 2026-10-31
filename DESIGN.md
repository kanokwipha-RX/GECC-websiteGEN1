# GECC Sisaket design contract

Preserve the current Navy–Gold government identity, complete group/person imagery,
Thai IBM Plex Sans Thai family and public-page order. Refine rather than rebrand.

## Runtime ownership
Existing index.html :root owns incumbent tokens; assets/premium.css owns additive
spacing/motion/accessibility tokens and shared refinements. Do not duplicate themes.

- Navy #0F2263, royal blue #1B3487, gold #C59B42 (decoration), readable gold #8A6417.
- Ivory #F6F3EC, white surfaces, text #13204A; teal #146B68 is a supporting accent.
- Keep current dark theme; each new token has a dark equivalent when necessary.
- IBM Plex Sans Thai 400/500/600/700; no alternate display font or Thai letter spacing.
- New spacing: 4/8/12/16/24/32px. Legacy spacing is not silently normalized.
- Existing radius 8/12/18px and glass collection cards remain canonical.
- Visible focus, minimum 24px targets (44px primary controls), stable busy buttons.
- No crop of embedded image text, no text overlay over faces or document details.
- Motion: 160ms controls, 220ms page entry, 320ms reveal; reduced motion is instant.
- All content visible without motion/IntersectionObserver. No animated fake counts.
- Idle status text uses premium.css `--idle: #596171` in light mode; existing dark
  token remains authoritative. Module cards, workflow status, reviewer tiles and
  report buttons use existing semantic surface/text tokens in both themes.
- Compact countdown uses `.cdn-compact`; `.mini` belongs only to score bars.
- At up to 600px the six public navigation links use three columns so complete
  Thai labels are visible; the sticky page header follows the measured navigation height.
- Public production dashboards reuse executiveHead/countdownHTML/dualBandSummary
  with server aggregates only; private drilldowns remain authenticated. Chart
  panels use --surface in both themes. Photo-free person cards keep copy in flow.

## Review checklist (all screens)
1. Existing shell -> site navigation -> header -> content -> pager -> footer retained.
2. Native buttons/actions and anchors/external documents retain existing handlers.
3. Shared .btn/.inp/.card/status widgets reused; no second visual control system.
4. Public collection headings keep current hierarchy and full imagery.
5. Form errors are linked and first invalid field is reachable by keyboard.
6. Modal title/focus trap/Escape/return focus owned by shared modal implementation.
7. Toasts announce via existing live region; persistent errors remain visible.
8. No document-width overflow at 360px; wide tables scroll within their wrapper.
9. Light/dark and reduced-motion behavior verified separately.
10. Assessment logic and source records are not edited for visual reasons.


## Content v2 approved public behavior

The owner approved public organization names, criterion completion states, scores and update dates through an explicit allowlisted public/units projection. Evidence, assessment narrative, reviewer notes and account data remain scoped. PHP is the production runtime; static Sites is a separately labelled sample-data concept preview. Gallery and MENTOR reuse shell/go, collection headings, personCard, native .inp controls, openModal and toast. The coordinator owns album draft/publication and content changes. Library folder links are returned only after a PHP password session; Drive permissions remain independently authoritative. See RELEASE-CONTENT-V2-TH.md for rollout and outstanding real rosters.
