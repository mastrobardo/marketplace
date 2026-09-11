// @vitest-environment node
//
// ADR-011's "enforcement, because a convention that is not a gate does not survive a deadline".
//
// Two halves, and both are necessary. `RuleTester` proves each rule reports what it should and
// stays quiet where the ADR allows the code — a rule that fires inside an effect is a rule someone
// turns off within a week. The second half lints through `apps/web`'s *real* configuration, because
// a rule that is written and not wired to a glob is the `database`-job failure in a new costume:
// green, and measuring nothing (`memory/repo/gotchas.md`).
import { describe, expect, it } from 'vitest';
import { ESLint, RuleTester } from 'eslint';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rules } from '../eslint/route-rules.js';

const appsWeb = fileURLToPath(new URL('..', import.meta.url));

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    globals: { document: 'readonly', window: 'readonly', fetch: 'readonly' },
  },
});

describe('AC11 — R2: no browser global at module scope', () => {
  it('reports module scope and allows effects and handlers', () => {
    ruleTester.run('no-module-scope-browser-global', rules['no-module-scope-browser-global'], {
      valid: [
        // The ADR's own wording: "inside an effect or an event handler only".
        { code: 'export function Component() { useEffect(() => { document.title = "x"; }); }' },
        { code: 'export function Component() { return () => window.scrollTo(0, 0); }' },
        // A local of the same name is not the global.
        { code: 'export function loader({ document }) { return document.id; }' },
        // A property that happens to share the name.
        { code: 'export const meta = { window: 1 };' },
      ],
      invalid: [
        {
          code: 'const width = document.body.clientWidth;\nexport function Component() {}',
          errors: [{ messageId: 'browserGlobal' }],
        },
        {
          code: 'export const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;',
          errors: [{ messageId: 'browserGlobal' }],
        },
        {
          code: 'if (navigator.onLine) { console.error("online"); }',
          errors: [{ messageId: 'browserGlobal' }],
        },
      ],
    });
  });
});

describe('AC12 — R5: no module-scope mutable cache', () => {
  it('reports let, var and collection caches, and allows constants', () => {
    ruleTester.run('no-module-scope-mutable', rules['no-module-scope-mutable'], {
      valid: [
        { code: 'const NAV = ["home", "search"];' },
        { code: 'const LIMITS = { page: 20 };' },
        { code: 'export function Component() { let count = 0; return count; }' },
        { code: 'export function loader() { const seen = new Map(); return seen.size; }' },
      ],
      invalid: [
        { code: 'let hits = 0;', errors: [{ messageId: 'mutableBinding' }] },
        { code: 'var current;', errors: [{ messageId: 'mutableBinding' }] },
        { code: 'const cache = new Map();', errors: [{ messageId: 'moduleCache' }] },
        { code: 'const seen = new WeakSet();', errors: [{ messageId: 'moduleCache' }] },
      ],
    });
  });
});

describe('AC13 — R3: data comes from the loader', () => {
  it('reports fetch in a component or hook and allows it in a loader', () => {
    ruleTester.run('no-fetch-in-component', rules['no-fetch-in-component'], {
      valid: [
        { code: 'export async function loader() { return fetch("/api/x"); }' },
        { code: 'export async function action({ request }) { return fetch(request.url); }' },
        { code: 'export const loader = async () => fetch("/api/x");' },
      ],
      invalid: [
        {
          code: 'export function Component() { useEffect(() => { fetch("/api/x"); }); }',
          errors: [{ messageId: 'fetchOutsideLoader' }],
        },
        {
          code: 'function useThings() { return fetch("/api/x"); }',
          errors: [{ messageId: 'fetchOutsideLoader' }],
        },
      ],
    });
  });
});

// One file, three violations, linted twice through the configuration that actually ships.
const OFFENDING = [
  'const cache = new Map();',
  'const width = document.body.clientWidth;',
  'export function Component() {',
  '  void fetch("/api/things");',
  '  return width + cache.size;',
  '}',
].join('\n');

async function ruleIdsFor(filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: appsWeb });
  const [result] = await eslint.lintText(OFFENDING, { filePath: join(appsWeb, filePath) });
  return (result?.messages ?? [])
    .map((message) => message.ruleId ?? '')
    .filter((ruleId) => ruleId.startsWith('mp/'));
}

describe('AC14 — the rules are wired to the paths ADR-011 names', () => {
  it('applies all three inside src/routes', async () => {
    expect((await ruleIdsFor('src/routes/probe.tsx')).sort()).toEqual([
      'mp/no-fetch-in-component',
      'mp/no-module-scope-browser-global',
      'mp/no-module-scope-mutable',
    ]);
  });

  it('applies all three inside src/features, which does not exist yet', async () => {
    // Pre-emptive on purpose: the glob costs nothing today and is already true for the first slice
    // agent who creates the directory.
    expect((await ruleIdsFor('src/features/discovery/probe.tsx')).length).toBe(3);
  });

  it('applies none of them outside those two trees', async () => {
    expect(await ruleIdsFor('src/i18n/probe.ts')).toEqual([]);
    expect(await ruleIdsFor('src/shared/probe.tsx')).toEqual([]);
  });
});
