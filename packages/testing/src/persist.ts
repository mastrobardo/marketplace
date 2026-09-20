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
  buildJob,
  buildJobCategory,
  type JobInput,
  type JobCategoryInput,
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
  job: CreateDelegate<JobInput>;
  jobCategory: CreateDelegate<JobCategoryInput>;
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

/**
 * The base address is composed when none is given, the way `createProviderCategory` composes its
 * parents below — `W3-T02` made `base_address_id` `NOT NULL`, so a profile is not a row that can
 * be written on its own. The address belongs to the **same user**, because `address.user_id` is a
 * foreign key and a provider's operating centre is their own row.
 */
export async function createProviderProfile(
  client: FactoryClient,
  overrides: Partial<ProviderProfileInput> = {},
): Promise<ProviderProfileInput> {
  const userId = await userIdFor(client, overrides.userId);
  const baseAddressId = overrides.baseAddressId ?? (await createAddress(client, { userId })).id;
  return client.providerProfile.create({
    data: buildProviderProfile({ ...overrides, userId, baseAddressId }),
  });
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

/**
 * Persist a job — `W4-T01`.
 *
 * Creates the owning user unless given one, like every other factory here. It deliberately creates
 * **no category**: an empty `DRAFT` is a legal row and the common case, and a factory that attached
 * a trade would make every job fixture publishable, which is the one thing `W4-T01` says a bare
 * draft is not.
 */
export async function createJob(
  client: FactoryClient,
  overrides: Partial<JobInput> = {},
): Promise<JobInput> {
  const clientId = overrides.clientId ?? (await createUser(client)).id;
  return client.job.create({ data: buildJob({ ...overrides, clientId }) });
}

/** Link a job to a trade, creating either side that was not supplied. */
export async function createJobCategory(
  client: FactoryClient,
  overrides: Partial<JobCategoryInput> = {},
): Promise<JobCategoryInput> {
  const jobId = overrides.jobId ?? (await createJob(client)).id;
  const categoryId = overrides.categoryId ?? (await createCategory(client)).id;
  return client.jobCategory.create({ data: buildJobCategory({ ...overrides, jobId, categoryId }) });
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
