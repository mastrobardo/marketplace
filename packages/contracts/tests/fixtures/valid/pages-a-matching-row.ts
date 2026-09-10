// W1-T02 AC23, positive half. It lives in the `valid` project rather than one of its own because
// each fixture project is another cold `tsc` in a parallel turbo run (MEM-2026-09-10-05), and this
// project already compiles the whole of `src`.
import {
  fetchLimit,
  keysetPredicate,
  listQuery,
  pageOf,
  paginationQuery,
  type SortSpec,
} from '../../../src/index.js';
import { z } from 'zod';

type Job = { id: string; createdAt: string; priceCents: number };

const sort: SortSpec<'createdAt' | 'priceCents'> = [
  { field: 'createdAt', direction: 'desc' },
  { field: 'id', direction: 'asc' },
];

const rows: Job[] = [{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z', priceCents: 100 }];

// Every sort field is a property of the row, so this is the shape `pageOf` is meant to accept.
export const page = pageOf(rows, { limit: fetchLimit(20) - 1, sort });
export const predicate = keysetPredicate(sort, { v: ['2026-01-01T00:00:00.000Z'], id: 'a' });

export const jobsQuery = listQuery({
  sortable: ['createdAt', 'priceCents'],
  defaultSort: '-createdAt',
  filters: { status: z.enum(['OPEN', 'AWARDED']) },
});

export const bare = paginationQuery({ sortable: ['createdAt'], defaultSort: 'createdAt' });
