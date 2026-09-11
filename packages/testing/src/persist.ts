/**
 * Persisting factories — a builder, plus the `create` call, plus whatever parent the row needs.
 *
 * The client is a **structural interface**, not `PrismaClient` (spec §4.3 Decision D). That keeps
 * `@prisma/client` out of this package entirely, so `apps/web`'s browser test bundle stays clean
 * and no second entry point is needed; and it means a recording fake satisfies `FactoryClient` in
 * ten lines, so the logic below is tested in CI's `unit` job rather than behind `STACK_LIVE`.
 *
 * The risk it takes on is drift between this interface and Prisma's real shape. `AC14` in
 * `apps/api/tests/factories-live.test.ts` is the criterion that closes it.
 */
import {
  buildAddress,
  buildAuditRecord,
  buildCategory,
  buildClientProfile,
  buildProviderCategory,
  buildProviderProfile,
  buildUser,
  type AddressInput,
  type AuditRecordInput,
  type CategoryInput,
  type ClientProfileInput,
  type ProviderCategoryInput,
  type ProviderProfileInput,
  type UserInput,
} from './builders.js';

export interface CreateDelegate<TInput> {
  create(args: { data: TInput }): Promise<TInput>;
}

export interface FactoryClient {
  user: CreateDelegate<UserInput>;
  clientProfile: CreateDelegate<ClientProfileInput>;
  providerProfile: CreateDelegate<ProviderProfileInput>;
  address: CreateDelegate<AddressInput>;
  category: CreateDelegate<CategoryInput>;
  providerCategory: CreateDelegate<ProviderCategoryInput>;
  auditRecord: CreateDelegate<AuditRecordInput>;
}

export async function createUser(
  client: FactoryClient,
  overrides: Partial<UserInput> = {},
): Promise<UserInput> {
  return client.user.create({ data: buildUser(overrides) });
}

/**
 * Every `create*` below creates the parent it needs unless it was given one (Decision E). The
 * alternative opens every test with three lines of scaffolding, which is the thing this package
 * exists to delete.
 */
async function userIdFor(client: FactoryClient, supplied: string | undefined): Promise<string> {
  if (supplied !== undefined) return supplied;
  const user = await createUser(client);
  return user.id;
}

export async function createClientProfile(
  client: FactoryClient,
  overrides: Partial<ClientProfileInput> = {},
): Promise<ClientProfileInput> {
  const userId = await userIdFor(client, overrides.userId);
  return client.clientProfile.create({ data: buildClientProfile({ ...overrides, userId }) });
}

export async function createProviderProfile(
  client: FactoryClient,
  overrides: Partial<ProviderProfileInput> = {},
): Promise<ProviderProfileInput> {
  const userId = await userIdFor(client, overrides.userId);
  return client.providerProfile.create({ data: buildProviderProfile({ ...overrides, userId }) });
}

export async function createAddress(
  client: FactoryClient,
  overrides: Partial<AddressInput> = {},
): Promise<AddressInput> {
  const userId = await userIdFor(client, overrides.userId);
  return client.address.create({ data: buildAddress({ ...overrides, userId }) });
}

/** The only root: a category needs no parent. A child category takes an explicit `parentId`. */
export async function createCategory(
  client: FactoryClient,
  overrides: Partial<CategoryInput> = {},
): Promise<CategoryInput> {
  return client.category.create({ data: buildCategory(overrides) });
}

export async function createProviderCategory(
  client: FactoryClient,
  overrides: Partial<ProviderCategoryInput> = {},
): Promise<ProviderCategoryInput> {
  const providerProfileId = overrides.providerProfileId ?? (await createProviderProfile(client)).id;
  const categoryId = overrides.categoryId ?? (await createCategory(client)).id;
  return client.providerCategory.create({
    data: buildProviderCategory({ ...overrides, providerProfileId, categoryId }),
  });
}

/**
 * Persist a row of the state-machine ledger.
 *
 * **For a test that needs history to already exist** — an audit view, a page of transitions, an
 * export. A test *of* a transition asserts on what `transition()` wrote, never on a row this
 * fabricated: `W1-T07`'s guarantee is that production code cannot change state without recording
 * it, and a fixture that forges a record proves nothing about that. The law constrains the
 * application, not the setup of a test that needs a ledger to read.
 *
 * No parent is created. `AuditRecord` has no foreign key by design (`W1-T05` §8.2: GDPR erasure
 * must be able to hard-delete a user without erasing what they did), so there is nothing to
 * auto-create and `entityId` points wherever the caller says.
 */
export async function createAuditRecord(
  client: FactoryClient,
  overrides: Partial<AuditRecordInput> = {},
): Promise<AuditRecordInput> {
  return client.auditRecord.create({ data: buildAuditRecord(overrides) });
}
