# DESIGN.md — GigPilot web UI

## Theme

Light, ink-on-paper. One committed dark surface exists: the scan terminal log (a deliberate "machine output" panel). No gradients, no glass, no glow.

## Color (OKLCH)

| Token | Value | Role |
|---|---|---|
| `--bg` | `oklch(0.985 0.002 250)` | App background (true off-white, faint cool) |
| `--bg-2` | `oklch(0.962 0.004 250)` | Sidebar / second neutral layer |
| `--panel` | `#fff` | Content surfaces |
| `--border` | `oklch(0.905 0.005 250)` | Hairlines |
| `--text` | `oklch(0.24 0.012 255)` | Ink |
| `--muted` | `oklch(0.48 0.018 255)` | Secondary text (≥4.5:1 on white) |
| `--accent` | `oklch(0.45 0.09 250)` | Links, selection, focus. Desaturated deep blue. |
| `--go` | `oklch(0.52 0.12 155)` | Apply verdict only |
| `--warn` | `oklch(0.55 0.12 70)` | Review verdict only |
| `--danger` | `oklch(0.50 0.17 25)` | Skip verdict / errors only |

Primary buttons are solid ink (`--text`), not accent. Verdict colors never fill whole surfaces — chips and score text only.

## Typography

- `Geist` for everything; `Geist Mono` for numbers, scores, URLs, terminal output.
- Fixed rem scale, ratio ~1.2. Page title 20px/600, section 13px/600, body 13.5px, meta 12.5px muted.
- `tabular-nums` on all data.

## Components

- **Triage row** (pipeline): score block (mono, verdict-colored text) | title + one meta line | quiet actions. Grouped under verdict sections ("Worth applying", "Review", "Low fit").
- **Stat strip** (dashboard): inline label+number pairs separated by hairlines — never hero-metric cards.
- **Report view**: rendered markdown with real tables; header extracted into title + score chip. Opens in a slide-over from the pipeline and on the Reports page.
- Buttons: 1 solid ink primary per view; secondary = bordered neutral; tertiary = text link.
- Every interactive element: hover, focus-visible ring (accent), `:active { scale(0.98) }`, disabled.

## Motion

150–250ms, `cubic-bezier(0.23, 1, 0.32, 1)`. Transitions on transform/opacity/background only. Slide-over 260ms. No stagger/page-load sequences. Reduced-motion collapses to instant.
