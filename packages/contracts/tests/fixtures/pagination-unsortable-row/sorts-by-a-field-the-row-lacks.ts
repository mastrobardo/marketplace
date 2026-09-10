// W1-T02 AC23, negative half. `tsc` must fail on this file. No `@ts-expect-error` anywhere near
// it: MEM-2026-09-09-09 records a comment that merely *began* with the directive suppressing the
// very error the fixture existed to prove.
import { pageOf, type SortSpec } from '../../../src/index.js';

type Job = { id: string; createdAt: string };

// `rating` is not a property of `Job`, so the row cannot supply the cursor value this sort needs.
const sort: SortSpec<'rating'> = [
  { field: 'rating', direction: 'desc' },
  { field: 'id', direction: 'asc' },
];

const rows: Job[] = [{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }];

export const page = pageOf(rows, { limit: 20, sort });
