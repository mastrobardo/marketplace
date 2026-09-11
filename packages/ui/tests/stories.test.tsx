/**
 * AC17. Every story renders, and every primitive has the long-text one.
 *
 * `composeStories` runs a story exactly as Storybook would — args, decorators and `play` included —
 * without a Storybook process. That is what makes `W12-T03` a runner change: these same stories
 * become browser tests with axe attached, and none of them has to be rewritten.
 *
 * Spanish runs 15–20% longer than English, and a fixed-width control is where that surfaces. The
 * long-text story is the one that would otherwise never be written, so its absence is a failure.
 */
import { composeStories } from '@storybook/react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { type ComponentType } from 'react';

/** What `composeStories` hands back: a renderable story that may carry a `play` function. */
type ComposedStory = ComponentType & {
  play?: (context: { canvasElement: HTMLElement }) => Promise<void> | void;
};

const modules = import.meta.glob('../src/primitives/*.stories.tsx', { eager: true });

describe('AC17 — every story renders, in both languages of length', () => {
  it('finds story files at all', () => {
    expect(Object.keys(modules).length, 'no stories found').toBeGreaterThan(0);
  });

  for (const [path, module] of Object.entries(modules)) {
    const name = path.split('/').pop() ?? path;
    const stories = composeStories(module as Parameters<typeof composeStories>[0]);

    it(`${name} ships a LongText story`, () => {
      expect(Object.keys(stories), `${name} has no LongText story`).toContain('LongText');
    });

    for (const [storyName, Story] of Object.entries(stories) as Array<[string, ComposedStory]>) {
      it(`${name} › ${storyName} renders`, async () => {
        const { container } = render(<Story />);
        await Story.play?.({ canvasElement: container });
        expect(container.firstChild, `${storyName} rendered nothing`).not.toBeNull();
      });
    }
  }
});
