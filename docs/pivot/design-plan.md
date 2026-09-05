# Ledger: Kora Product Design Plan

Direction for the Phase 8 product pass. Ledger is the visual language of a
precise financial ledger: high contrast, generous whitespace, tabular
monospace numerals for every amount and id, hairline structure that carries
meaning, one reserved brand accent, and status color used only for state.

## Principles

1. Proof is the product. The verification moment gets the emphasis and the motion.
2. The ledger, not the chatbot. Amounts and ids are first-class, monospace, tabular, copyable.
3. Structure encodes meaning. Hairlines, the state legend, and the timeline ordinals carry information, they are not decoration.
4. Calm for money. No decorative motion, no gradient washes. Motion only confirms a change the user or the agent just made.

## Color

Light-first tokens, defined as CSS variables and Tailwind theme values:

| Token | Value | Use |
|---|---|---|
| `ink` | `#111418` | Primary text, a deliberate cool near-black |
| `paper` | `#FCFCFD` | App surface, a clean cool white, never cream |
| `vellum` | `#F4F6F8` | Raised or muted surface |
| `line` | `#E4E7EC` | Hairlines and borders |
| `signal` | `#3B4CCA` | Brand and interactive affordances only |

Status tokens stay as the existing four (`success`, `warning`, `destructive`,
`info`) with their `-strong` text variants. Green means verified, amber means
pending or waiting, red means denied or failed, and grey only ever means
missing data. The brand `signal` is never used to mean a status.

Dark theme follows the same tokens: `ink` and `paper` swap roles as
background and foreground, `vellum` deepens to `#1A1F26`, `line` becomes a
10% white hairline, and `signal` lightens to `#7B86E8` so it holds contrast
on dark. Status `-strong` variants already flip shade steps in dark mode and
keep that behavior.

## Type

Two families, distinct, committed. No third UI face. A serif is allowed only
for the landing hero headline, nowhere else.

- UI and display: **Geist**. One family across weights. It ships well with
  Next and is not the Inter default that reads as generated.
- Numerals, ids, amounts, code: **Geist Mono**, always with tabular figures
  (`font-feature-settings: "tnum" 1`). Every money amount and every Stripe id
  renders in mono and is click-to-copy (`CopyId` for ids, `Money` for amounts).

Scale keeps the existing pins (`text-2xl` at 28/34, `text-4xl` at 44/48) so
tile values and the one hero value per page stay separated. Body copy keeps a
line length under 80 characters (`.ledger-prose`, `max-width: 80ch`) and
sentence case everywhere: labels read as sentences, not signage.

## Layout

Left-aligned and editorial, not centered. The console is a persistent left
nav, a top bar carrying the tenant and the deployment mode, and a content
area that opens with one hero number and a bordered stat strip, then data.
Density is expressed as tables and timelines, not as everything-in-a-card.
`HeroStat` renders once per page at display size with its denominator on the
same line; `StatBar` renders the strip as tiles with dividers between them,
not separate cards. Existing primitives (`OpsShell`, `HeroStat`, `StatBar`,
`Tile`) already follow this shape and stay.

## Icons

`lucide-react` only. One consistent stroke width (the library default, 2) and
a fixed size scale (`size-3` inline, `size-4` in navigation and buttons). No
second icon set, ever.

## State legend

The state color legend is defined once in `components/kora/state-legend.tsx`
and reused in the timeline and anywhere a status dot appears. Every status
carries a dot and a word; color without a legend is decoration.

## Self-critique

For each choice, the question: is this what I would produce for any SaaS
dashboard? If yes, it is a default not a choice.

1. Inter plus system mono. Generic default. Changed to Geist plus Geist Mono:
   Inter is the generated-looking default this plan explicitly rejects, and
   only a true mono with `tnum` keeps ledger columns aligned.
2. One status token per state used directly as text color. Generic and
   low-contrast: 600-shade text on a 10% tint lands near 3:1. Kept the
   existing `-strong` split (fill token vs. text token) instead of flattening
   it, because the split is the non-obvious choice that keeps pills readable
   at 12px.
3. Nine metrics in nine rounded cards. The default dashboard grid. Changed to
   one hero number plus a bordered strip with dividers: a label with a number
   is a tile, not a card, and cards are reserved for things with internal
   structure.
4. Centered hero-style console layout. Generic marketing shape applied to a
   tool. Changed to left-aligned editorial with persistent nav: an operator
   reads state, not a pitch.
5. Per-screen ad-hoc status dots with slightly different labels. Default
   drift. Changed to one shared legend component imported by every surface, so
   "waiting" means the same thing everywhere.
6. Uppercase tracked-out eyebrow labels over section headings. Default SaaS
   signage. Removed in favor of sentence-case labels; tracking stays only on
   the tiny tile labels where it separates label from value.

## Anti-slop checklist verdict

- No warm cream background with a terracotta or clay accent. Pass: `paper` is
  a cool white, the accent is `signal` blue.
- No near-black background with a single acid-green or vermilion accent.
  Pass: light-first, near-black appears only as text.
- No SaaS-card kit. Pass: tiles with dividers, one hero number, tables and
  timelines for density.
- No gradient washes used as decoration. Pass: flat surfaces, hairlines.
- No tracked-out all-caps eyebrow labels above headings. Pass: sentence case;
  tracking survives only on tile labels.
- No meta strings joined with middle dots, no "WORD, fragment" labels, no
  arrow appended to button or link text. Pass: none in the foundation; the
  timeline total line uses middots as value separators in a data summary,
  which is content, not a meta string.
- No emoji as icons. No stock photos. No abstract 3D blobs or AI hero art.
  Pass: lucide only, no imagery in this slice.
- No fade-and-slide-up on every section, no hover-lift on every card, no
  parallax, no animated gradients, no confetti. Pass: motion is reserved for
  the verification check draw; this slice adds none.
- Do not accent a single word of a headline in a different color or weight.
  Pass: headlines are single-color `ink`.
