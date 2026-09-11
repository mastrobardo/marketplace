/**
 * AC17's structural half: every primitive ships the long-text story.
 *
 * The *rendering* half moved to the `storybook` project in `W12-T03` — it renders every story in a
 * real Chromium, with its `play` function, which is strictly better than this file was doing in
 * jsdom. What stays here is the assertion a browser cannot make: that a story which was never
 * written is missing. Spanish runs 15–20% longer than English, and the long-text case is the one
 * that would otherwise quietly never exist.
 */
import { describe, expect, it } from 'vitest';

const modules = import.meta.glob('../src/primitives/*.stories.tsx', { eager: true });

describe('AC17 — every primitive is proven at Spanish length', () => {
  it('finds story files at all', () => {
    expect(Object.keys(modules).length, 'no stories found').toBeGreaterThan(0);
  });

  for (const [path, module] of Object.entries(modules)) {
    const name = path.split('/').pop() ?? path;

    it(`${name} ships a LongText story`, () => {
      expect(Object.keys(module as object), `${name} has no LongText story`).toContain('LongText');
    });
  }
});
