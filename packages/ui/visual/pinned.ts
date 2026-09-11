import { type Exclusion, type PinnedEntry } from './coverage.js';

/**
 * The pinned screenshot subjects — `W12-T16` §4.2.
 *
 * Curated on purpose, and *complete* by assertion: `tests/visual-coverage.test.ts` fails when a
 * story is in neither this list nor `EXCLUSIONS`, when an entry names a story that no longer
 * exists, and when an exclusion carries no reason. Adding a component therefore cannot quietly add
 * an unwatched story — the choice is forced on the pull request that adds it.
 *
 * **The matrix.** Every entry below is shot once, at `default` / `light` / `es-ES` (spec §10 Q5).
 * What a per-combination screenshot would catch is a component stylesheet holding a colour literal,
 * and `boundaries.test.ts` AC18 already fails that on the pull request; `tokens.test.ts` AC3/AC6
 * resolve *and measure* all four theme × scheme combinations. `Foundations/Themes → Matrix` builds
 * its four panels itself, from its own `COMBINATIONS` array rather than from the toolbar, so one
 * image of it covers all four palettes — which is why no entry here needs a `matrix` override. The
 * override exists (and is tested) for the first subject that does.
 */
export const PINNED: readonly PinnedEntry[] = [
  { id: 'foundations-themes--long-text' },
  { id: 'foundations-themes--matrix' },
  { id: 'patterns-authwall--as-subsection' },
  { id: 'patterns-authwall--contact-provider' },
  { id: 'patterns-authwall--provider-registration' },
  { id: 'patterns-card--at-heading-level-two' },
  { id: 'patterns-card--default' },
  { id: 'patterns-card--linked' },
  { id: 'patterns-card--linked-focused' },
  { id: 'patterns-card--long-text' },
  { id: 'patterns-card--numbered' },
  { id: 'patterns-card--with-children' },
  { id: 'patterns-emptystate--empty' },
  { id: 'patterns-emptystate--error' },
  { id: 'patterns-emptystate--with-filters' },
  { id: 'patterns-pagination--has-more' },
  { id: 'patterns-pagination--last-page' },
  { id: 'patterns-resultrow--default' },
  { id: 'patterns-resultrow--focused' },
  { id: 'patterns-resultrow--long-name' },
  { id: 'patterns-resultrow--quote-only' },
  { id: 'patterns-resultrow--unlinked' },
  { id: 'patterns-resultrow--unrated' },
  { id: 'patterns-resultrow--with-badges' },
  { id: 'patterns-searchbar--filters' },
  { id: 'patterns-searchbar--header-collapsed' },
  { id: 'patterns-searchbar--header-expanded' },
  { id: 'patterns-searchbar--hero' },
  { id: 'patterns-searchbar--hero-answered' },
  { id: 'patterns-searchbar--long-text' },
  { id: 'patterns-searchbar--pending' },
  { id: 'patterns-searchbar--suggestions-loading' },
  { id: 'patterns-searchbar--with-errors' },
  { id: 'primitives-button--danger' },
  { id: 'primitives-button--default' },
  { id: 'primitives-button--disabled' },
  { id: 'primitives-button--disclosure' },
  { id: 'primitives-button--focused' },
  { id: 'primitives-button--long-text' },
  { id: 'primitives-button--pending' },
  { id: 'primitives-button--secondary' },
  { id: 'primitives-combobox--default' },
  { id: 'primitives-combobox--disabled' },
  { id: 'primitives-combobox--empty' },
  { id: 'primitives-combobox--focused' },
  { id: 'primitives-combobox--loading' },
  { id: 'primitives-combobox--long-text' },
  { id: 'primitives-combobox--with-error' },
  { id: 'primitives-dialog--default' },
  { id: 'primitives-dialog--long-text' },
  { id: 'primitives-dialog--not-dismissable' },
  { id: 'primitives-dialog--open' },
  { id: 'primitives-dialog--with-footer' },
  { id: 'primitives-field--default' },
  { id: 'primitives-field--long-text' },
  { id: 'primitives-field--required' },
  { id: 'primitives-field--with-description' },
  { id: 'primitives-field--with-error' },
  { id: 'primitives-popover--default' },
  { id: 'primitives-popover--long-text' },
  { id: 'primitives-popover--open' },
  { id: 'primitives-popover--top' },
  { id: 'primitives-select--default' },
  { id: 'primitives-select--disabled' },
  { id: 'primitives-select--focused' },
  { id: 'primitives-select--long-text' },
  { id: 'primitives-select--selected' },
  { id: 'primitives-select--with-error' },
  { id: 'primitives-textinput--default' },
  { id: 'primitives-textinput--disabled' },
  { id: 'primitives-textinput--focused' },
  { id: 'primitives-textinput--long-text' },
  { id: 'primitives-textinput--with-description' },
  { id: 'primitives-textinput--with-error' },
];

/**
 * Empty, and that is the finding rather than an oversight.
 *
 * The expected exclusions were the animated ones — `primitives-button--pending`,
 * `patterns-searchbar--suggestions-loading`, `primitives-combobox--loading`. They do not need
 * excluding: the only `@keyframes` in the package is `Button.module.css`'s spinner, and it is
 * already `animation: none` under `prefers-reduced-motion: reduce`, which the runner forces
 * (`playwright.config.ts`). A spinner that is not spinning is a deterministic subject.
 *
 * The overlay stories (`primitives-dialog--open`, `primitives-popover--open`) are portalled to
 * `document.body`, which a full-page screenshot captures — and they are exactly the states worth
 * watching, so excluding them would have been the wrong instinct twice over.
 *
 * Keep it empty if you can. An exclusion is a subject nobody is watching, and `MEM-2026-09-11-13`
 * is what happens when a gate's blind spot is where the interesting state lives.
 */
export const EXCLUSIONS: readonly Exclusion[] = [];
