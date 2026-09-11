import { storyNameFromExport, toId } from 'storybook/internal/csf';

/**
 * Deriving the set of screenshot subjects from the story modules.
 *
 * `W12-T16` spec §4.1 originally named `storybook-static/index.json` as the single enumeration
 * source, on the grounds that one artefact cannot disagree with itself. It is still the shooter's
 * source — but the *completeness* gate has to run per pull request (§4.2), and requiring a
 * 30-second Storybook build inside the `unit` project to answer "is this story pinned?" is a cost
 * paid on every PR in the repo forever.
 *
 * So the subjects are derived twice, from the modules here and from the index in the nightly, and
 * `index-check.ts` asserts the two sets are equal where the index is free. Two derivations of one
 * set is precisely how they drift; the answer is to assert they agree, not to pretend there is one.
 *
 * The id is built with Storybook's **own** `toId` and `storyNameFromExport`, imported rather than
 * reimplemented. `LongText` → "Long Text" → `patterns-card--long-text` is three rules deep, and a
 * local copy of them is a copy that stops matching on a minor upgrade without saying so.
 */
export interface Subject {
  /** The Storybook id — what the iframe URL takes and what a baseline file is named for. */
  readonly id: string;
  readonly title: string;
  readonly exportName: string;
  readonly name: string;
}

/** The shape of a story module, narrowed to what the derivation actually reads. */
export interface StoryModule {
  readonly default?: { readonly title?: string };
  readonly [exportName: string]: unknown;
}

/**
 * Storybook treats any named export as a story unless the meta excludes it. CSF3 stories are
 * objects, so a function (`renderLink`) or a string constant is not one — narrowing this way rather
 * than by name keeps a helper from being shot as a subject that does not exist.
 *
 * `__namedExportsOrder` is Storybook's own compiler artefact and is an array, which is an object.
 */
function isStory(exportName: string, value: unknown): boolean {
  if (exportName === 'default' || exportName === '__namedExportsOrder') return false;
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function storyIdsFrom(modules: Record<string, StoryModule>): Subject[] {
  const subjects: Subject[] = [];

  for (const path of Object.keys(modules).sort()) {
    const module = modules[path];
    const title = module?.default?.title;

    // Every meta in this package sets an explicit `title`. Autotitle — deriving one from the file
    // path — depends on the Storybook `stories` glob and would make an id change when a file moves,
    // so a module without a title is a mistake to report rather than a case to support.
    if (module === undefined || title === undefined) {
      throw new Error(`${path}: story module has no default export with a \`title\`.`);
    }

    for (const [exportName, value] of Object.entries(module)) {
      if (!isStory(exportName, value)) continue;

      const explicit = (value as { name?: unknown }).name;
      const name = typeof explicit === 'string' ? explicit : storyNameFromExport(exportName);

      subjects.push({ id: toId(title, name), title, exportName, name });
    }
  }

  return subjects;
}
