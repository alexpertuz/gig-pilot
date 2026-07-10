# Pipeline card metadata design

## Goal

Make pipeline gig cards feel more lively and easier to scan while preserving the current white, restrained editorial interface. Improve source recognition, posting-time visibility, and metadata hierarchy without changing pipeline behavior or data ownership.

## Scope

This change affects only the pipeline gig rows and their responsive presentation. It does not change scanning, scoring, source configuration, reports, evaluation actions, or User Layer files.

## Visual design

- Keep every card white with the existing neutral outer border.
- Present the score inside a compact square badge. Its foreground and soft background use the existing semantic tier colors: green for `go`, amber for `review`, red for `low`, and neutral gray for `unscored`.
- Keep the score state label (`scored` or `est.`) inside the badge so score meaning remains visible.
- Preserve the title as the card's strongest text element.
- Replace the current dot-joined metadata sentence with a wrapping metadata row made of distinct elements.
- Render the source as a compact pill containing an icon and a cleaned display name.
- Emphasize relative posting age with a small colored time badge, while showing the exact local date and 24-hour time beside it in quieter text.
- Present budget as a separate metadata item rather than embedding it in a text sentence.
- Preserve reasons, red flags, hover actions, and report/evaluation behavior.

## Source identity and fallbacks

Known source families may use lightweight local marks and restrained brand colors. Source matching must be case-insensitive and tolerate variants such as subreddit names (`r/forhire`) by mapping them to the Reddit family while retaining the specific source label.

Source rendering must not depend on a closed list because users can add providers. An unknown or user-defined source receives a deterministic neutral fallback: a small rounded-square mark containing the first alphanumeric character of the cleaned source name. If no usable source name exists, show a generic link mark and the label `Source`.

No external icon package, remote image, or network dependency will be added.

## Date and time behavior

For a valid `firstSeen` timestamp, render:

- A human-readable relative age such as `today`, `1 day ago`, or `16 days ago`.
- The exact date in an English abbreviated form such as `Jun 24, 2026`.
- The local time in 24-hour `HH:mm` format, such as `14:35`.

The exact value is formatted in the browser's local timezone. When a timestamp is absent or invalid, omit the relative age, date, and time together rather than showing placeholders or invalid values.

Relative-age emphasis follows freshness rather than score: recent posts receive the strongest accent, moderately old posts receive a quieter warm treatment, and stale posts remain visibly subdued. The existing stale-row behavior remains intact.

## Responsive behavior

The metadata row wraps naturally. On narrow screens, source, relative age, exact timestamp, and budget may flow to multiple lines without truncating the title. Existing card actions remain visible at the mobile breakpoint.

## Accessibility and interaction

- Source icons are decorative because the adjacent source label conveys their meaning.
- Color is not the only status signal: numeric score, score-state text, relative-age text, and source labels remain present.
- Existing keyboard focus and hover behavior remain unchanged.
- Unknown source marks retain sufficient contrast against the current light card surface.

## Implementation boundaries

- Extend the existing `PipelineBoard` row presentation with small formatting and source-identity helpers.
- Add focused CSS classes to the existing component stylesheet and semantic tokens only if needed.
- Do not introduce a new dependency or refactor unrelated pipeline logic.
- Preserve all existing in-progress changes in the working tree.

## Verification

- Add or update focused tests for known and unknown source rendering, valid timestamps, invalid or missing timestamps, and score badge classes where the current test setup supports component rendering.
- Run the web application's existing typecheck/build and relevant tests.
- Visually inspect the pipeline at desktop and mobile widths, checking wrapping, contrast, hover actions, and fallback icons.
