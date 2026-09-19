/**
 * `W3-T01` — the taxonomy seeder, asserted without a database.
 *
 * The seeder is handed a transaction client, so a recorder satisfies the shape in a few lines and
 * every claim about *what the taxonomy is* — twenty leaves, two roots, five gated trades, four
 * adopted uuids — is checkable in CI's `unit` job rather than behind `STACK_LIVE`.
 * `categories-live.test.ts` asserts the half that needs Postgres.
 *
 * **AC17 and AC18 are listed under "live" in §7 and are asserted here instead.** Both are pure
 * assertions over a recorder and an array — no database can make them truer, and unit placement
 * means a registry reorder fails the fast job rather than only the `database` one. The operator
 * approved the move on 2026-09-18. AC20 and AC21 are asserted in both places: here over the
 * constant, live over the rows, because the criterion is about what is *in the database*.
 *
 * Spec: `docs/specs/S3/W3-T01-category-tree.md` §3.6, §8.3, §8.4, §8.5.
 */
import { describe, expect, it } from 'vitest';
import { type Prisma } from '@prisma/client';
import { CATEGORY_SLUG } from '@marketplace/contracts';

import { TAXONOMY, categoryTaxonomy } from '../prisma/seed/categories.js';
import { demoProviders } from '../prisma/seed/demo-providers.js';
import { seeders } from '../prisma/seed/registry.js';

/** §8.3's ruling, as the compliance query would answer it (`BD-07`, resolved 2026-09-18). */
const GATED = ['climatizacion', 'electricidad', 'gas', 'placas-solares', 'telecomunicaciones'];

/** The fixed uuids `demo-providers.ts` created and this seeder adopts (§3.6, `MEM-2026-09-18-1`). */
const ADOPTED: Record<string, string> = {
  fontaneria: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
  electricidad: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002',
  cerrajeria: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003',
  climatizacion: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004',
};

const roots = () => TAXONOMY.filter((row) => row.parent === null);
const leaves = () => TAXONOMY.filter((row) => row.parent !== null);

interface Written {
  readonly model: string;
  readonly op: 'create' | 'upsert';
  /** The `create` half of an upsert — what the row looks like the first time. */
  readonly data: Record<string, unknown>;
  /** The `update` half. What it *omits* is load-bearing: see the `isActive` criterion below. */
  readonly update?: Record<string, unknown>;
  readonly where?: Record<string, unknown>;
}

/**
 * A transaction client that records instead of writing, and can answer a read.
 *
 * `rows` seeds the category table the seeder under test is allowed to *find*. The taxonomy seeder
 * runs against an empty one; `demo-providers.ts` runs against a full one, which is the whole point
 * of §3.6 — it resolves slugs it no longer creates.
 */
function recorder(rows: { id: string; slug: string }[] = []) {
  const written: Written[] = [];

  const category = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      written.push({ model: 'category', op: 'create', data });
      return Promise.resolve(data);
    },
    upsert: ({
      where,
      create,
      update,
    }: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      written.push({ model: 'category', op: 'upsert', data: create, update, where });
      // Postgres generates one when the row does not name its own, and the seeder reads it back to
      // parent the next level. A double that returned no `id` would make every child unparentable.
      const id = create['id'] ?? `generated-${String(where['slug'])}`;
      return Promise.resolve({ ...create, id });
    },
    // Both read shapes are answered, so this asserts the *property* — that the four slugs are
    // resolved rather than created — instead of pinning which Prisma call green reaches for.
    findMany: ({ select }: { select?: Record<string, unknown> } = {}) =>
      Promise.resolve(rows.map((row) => (select === undefined ? row : { ...row }))),
    findUnique: ({ where }: { where: { slug?: string } }) =>
      Promise.resolve(rows.find((row) => row.slug === where.slug) ?? null),
    findUniqueOrThrow: ({ where }: { where: { slug?: string } }) => {
      const found = rows.find((row) => row.slug === where.slug);
      if (found === undefined)
        return Promise.reject(new Error(`No seeded category "${String(where.slug)}"`));
      return Promise.resolve(found);
    },
  };

  const model = (name: string) => ({
    create: ({ data }: { data: Record<string, unknown> }) => {
      written.push({ model: name, op: 'create', data });
      return Promise.resolve(data);
    },
  });

  const db = {
    category,
    user: model('user'),
    address: model('address'),
    providerProfile: model('providerProfile'),
    providerCategory: model('providerCategory'),
  };

  return { written, db: db as unknown as Prisma.TransactionClient };
}

describe('the taxonomy constant — §8.3', () => {
  it('is two family roots and twenty leaves', () => {
    expect(roots().map((row) => row.slug)).toEqual(['reformas', 'mantenimiento']);
    expect(leaves()).toHaveLength(20);
  });

  it('gives every leaf a parent that is one of the two roots', () => {
    const rootSlugs = new Set(roots().map((row) => row.slug));
    for (const leaf of leaves()) {
      expect(rootSlugs.has(leaf.parent ?? ''), `${leaf.slug} has no real parent`).toBe(true);
    }
  });

  it('AC2 — every slug matches CATEGORY_SLUG and every name pair has content', () => {
    for (const row of TAXONOMY) {
      expect(row.slug, `${row.slug} is not a slug`).toMatch(CATEGORY_SLUG);
      expect(row.nameEs.length, `${row.slug} has no Spanish name`).toBeGreaterThan(0);
      expect(row.nameEn.length, `${row.slug} has no English name`).toBeGreaterThan(0);
    }
  });

  it('keeps the accent out of the slug and in the name — the reason the pair exists', () => {
    const bySlug = new Map(TAXONOMY.map((row) => [row.slug, row]));
    expect(bySlug.get('albanileria')?.nameEs).toBe('Albañilería');
    expect(bySlug.get('carpinteria')?.nameEs).toBe('Carpintería');
  });

  it('has no duplicate slug, because the column is unique', () => {
    const slugs = TAXONOMY.map((row) => row.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('numbers positions 1..n within each sibling set', () => {
    for (const parent of [null, 'reformas', 'mantenimiento']) {
      const siblings = TAXONOMY.filter((row) => row.parent === parent);
      expect(
        siblings.map((row) => row.position).sort((a, b) => a - b),
        `positions under ${parent ?? 'the root level'} are not 1..n`,
      ).toEqual(siblings.map((_unused, index) => index + 1));
    }
  });
});

describe('AC20, AC21 — the licence column carries the operator’s ruling', () => {
  it('AC20 — exactly five trades are gated, and they are the five', () => {
    const gated = TAXONOMY.filter((row) => row.requiresLicence).map((row) => row.slug);
    expect(gated.sort()).toEqual(GATED);
  });

  it('AC21 — reforma-integral is false: a licence attaches to the trade, not the umbrella', () => {
    // §3.5.1, and the most consequential half of `BD-07`'s answer. Marking the umbrella `true`
    // would demand a licence from a tiler.
    const umbrella = TAXONOMY.find((row) => row.slug === 'reforma-integral');
    expect(umbrella?.requiresLicence).toBe(false);
  });

  it('AC21 — no root or parent row carries the flag, ever', () => {
    for (const root of roots()) {
      expect(root.requiresLicence, `${root.slug} gates a whole family`).toBe(false);
    }
  });

  it('fontaneria is false and gas is true, which is the pair worth reading twice', () => {
    const bySlug = new Map(TAXONOMY.map((row) => [row.slug, row]));
    // Plumbing carries no national authorisation; the moment the work touches a gas appliance it is
    // `gas`, which does (§8.3). A reviewer expecting otherwise should find this, not file a bug.
    expect(bySlug.get('fontaneria')?.requiresLicence).toBe(false);
    expect(bySlug.get('gas')?.requiresLicence).toBe(true);
  });

  it('declares the flag on every row rather than defaulting it', () => {
    for (const row of TAXONOMY) {
      expect(typeof row.requiresLicence, `${row.slug} leaves requiresLicence to a default`).toBe(
        'boolean',
      );
    }
  });
});

describe('the seeder — §8.4', () => {
  it('is registered under a permanent, dotted id and is not localOnly', () => {
    expect(categoryTaxonomy.id).toBe('categories.taxonomy');
    // A preview database should hold the real taxonomy: it is the vocabulary the product is written
    // in, not demo content. No credential, no personal data, nothing about a real person.
    expect(categoryTaxonomy.localOnly).not.toBe(true);
    expect(seeders).toContain(categoryTaxonomy);
  });

  it('AC18 — runs before providers.demo-world, asserted rather than assumed', () => {
    const order = seeders.map((seeder) => seeder.id);
    const taxonomy = order.indexOf(categoryTaxonomy.id);
    const demo = order.indexOf(demoProviders.id);

    expect(taxonomy, 'the taxonomy seeder is not registered').toBeGreaterThanOrEqual(0);
    expect(
      taxonomy,
      'providers.demo-world resolves slugs this seeder creates, so a reorder breaks the demo world',
    ).toBeLessThan(demo);
  });

  it('writes every row in the taxonomy', async () => {
    const { written, db } = recorder();
    await categoryTaxonomy.run({ db });

    const slugs = written.filter((row) => row.model === 'category').map((row) => row.data['slug']);
    expect(slugs.sort()).toEqual(TAXONOMY.map((row) => row.slug).sort());
  });

  it('AC16 — upserts on slug rather than creating, so a re-run cannot collide', async () => {
    const { written, db } = recorder();
    await categoryTaxonomy.run({ db });

    const creates = written.filter((row) => row.op === 'create');
    expect(
      creates.map((row) => row.data['slug']),
      'a create would hit category_slug_key',
    ).toEqual([]);
    for (const row of written) {
      expect(row.where, `${String(row.data['slug'])} is not keyed on its slug`).toMatchObject({
        slug: row.data['slug'],
      });
    }
  });

  it('never writes isActive on the update half, so a re-run cannot un-retire a trade', async () => {
    // §3.8 makes `isActive: false` the retirement mechanism. An update carrying `isActive: true`
    // would put every retired trade back on the public wire the next time somebody fixed a typo
    // in this file and re-ran the seeder. Found in review.
    const { written, db } = recorder();
    await categoryTaxonomy.run({ db });

    for (const row of written) {
      expect(
        row.update,
        `${String(row.data['slug'])} resurrects itself on every re-run`,
      ).not.toHaveProperty('isActive');
    }
  });

  it('AC15 — carries the four adopted uuids, so a link in a screenshot still resolves', async () => {
    const { written, db } = recorder();
    await categoryTaxonomy.run({ db });

    const byslug = new Map(written.map((row) => [row.data['slug'], row.data['id']]));
    for (const [slug, id] of Object.entries(ADOPTED)) {
      expect(byslug.get(slug), `${slug} did not adopt its demo uuid`).toBe(id);
    }
  });

  it('writes the roots before the children that point at them', async () => {
    const { written, db } = recorder();
    await categoryTaxonomy.run({ db });

    const order = written.map((row) => String(row.data['slug']));
    for (const leaf of leaves()) {
      expect(
        order.indexOf(leaf.parent ?? ''),
        `${leaf.slug} is written before its parent, which the foreign key refuses`,
      ).toBeLessThan(order.indexOf(leaf.slug));
    }
  });
});

describe('AC17 — demo-providers is decoupled from category creation (§8.5)', () => {
  const seeded = Object.entries(ADOPTED).map(([slug, id]) => ({ id, slug }));

  it('creates no category rows at all', async () => {
    const { written, db } = recorder(seeded);
    await demoProviders.run({ db });

    expect(
      written.filter((row) => row.model === 'category'),
      'the demo seeder still creates categories, which duplicates a unique slug',
    ).toEqual([]);
  });

  it('still links its five providers to the four adopted categories', async () => {
    const { written, db } = recorder(seeded);
    await demoProviders.run({ db });

    const links = written.filter((row) => row.model === 'providerCategory');
    expect(links).toHaveLength(7);

    const ids = new Set(Object.values(ADOPTED));
    for (const link of links) {
      expect(ids.has(String(link.data['categoryId'])), 'a link points at an unseeded row').toBe(
        true,
      );
    }
  });

  it('throws with the slug named when the taxonomy has not run', async () => {
    // The same failure mode the existing `No seeded category "…"` guard has for providers — and the
    // one AC18 exists to prevent reaching anyone.
    const { db } = recorder([]);
    await expect(demoProviders.run({ db })).rejects.toThrow(/fontaneria/);
  });
});
