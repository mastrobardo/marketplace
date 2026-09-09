import { type Seeder } from './types.js';

/**
 * Every seeder in the system, in the order they must run.
 *
 * **Empty on purpose.** `W0-T05` ships the pipeline, not the data. A slice appends its own seeder
 * here; `agent-qa` owns demo fixtures (`W7-T01`) and `W0-T20` owns what is safe to put in a
 * non-local environment.
 *
 * Order matters and is the array's order — a seeder that needs categories goes after the one that
 * creates them. Ids are permanent: renaming one makes it run again on every existing database.
 */
export const seeders: readonly Seeder[] = [];
