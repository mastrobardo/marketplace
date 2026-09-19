import { authDemoUsers } from './auth-demo-users.js';
import { categoryTaxonomy } from './categories.js';
import { demoProviders } from './demo-providers.js';
import { type Seeder } from './types.js';

/**
 * Every seeder in the system, in the order they must run.
 *
 * `W0-T05` shipped the pipeline, not the data. A slice appends its own seeder here; `agent-qa`
 * owns demo fixtures (`W7-T01`) and `W0-T20` owns what is safe to put in a non-local environment.
 *
 * Order matters and is the array's order — a seeder that needs categories goes after the one that
 * creates them. Ids are permanent: renaming one makes it run again on every existing database.
 *
 * **`W3-T01` made that sentence load-bearing rather than cautionary.** `providers.demo-world`
 * resolves four slugs that `categories.taxonomy` writes; put them the other way round and the demo
 * seeder throws. `apps/api/tests/categories-seed.test.ts` AC18 asserts the two indices, so a
 * reorder fails a test instead of a `pnpm db:seed` on somebody's laptop.
 */
export const seeders: readonly Seeder[] = [authDemoUsers, categoryTaxonomy, demoProviders];
