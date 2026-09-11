/**
 * React Testing Library keeps rendered trees in the document between tests unless told otherwise,
 * and a stale dialog in the DOM makes the *next* test's `getByRole('dialog')` ambiguous — which
 * reads as a bug in the component rather than in the harness.
 *
 * The three shims below are jsdom gaps, not React Aria bugs: overlays measure themselves to decide
 * where to sit, and listboxes scroll the focused option into view. Both are real behaviour in a
 * real browser and neither exists here. `W12-T03` runs these same stories in an actual browser
 * through `@storybook/addon-vitest`, which is the point of doing it — these shims are the cost of
 * jsdom being a document without a layout.
 *
 * Guarded: `setupFiles` runs for every suite, including the ones pinned to the node environment.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (typeof Element !== 'undefined' && Element.prototype.scrollIntoView === undefined) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (typeof globalThis.DOMRect === 'undefined') {
  globalThis.DOMRect = class DOMRectShim {
    constructor(
      readonly x = 0,
      readonly y = 0,
      readonly width = 0,
      readonly height = 0,
    ) {}
    get top(): number {
      return this.y;
    }
    get left(): number {
      return this.x;
    }
    get right(): number {
      return this.x + this.width;
    }
    get bottom(): number {
      return this.y + this.height;
    }
    toJSON(): object {
      return { ...this };
    }
    static fromRect(other?: DOMRectInit): DOMRectShim {
      return new DOMRectShim(other?.x, other?.y, other?.width, other?.height);
    }
  } as unknown as typeof DOMRect;
}

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
