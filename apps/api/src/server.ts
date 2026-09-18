import { buildApp } from './app.js';
import { buildAuth } from './auth/auth.js';
import { createMailer } from './auth/mail.js';
import { ConfigError, getConfig } from './config.js';
import { getPrismaClient } from './db/client.js';
import { createSearchRepository } from './modules/search/repository.js';
import { createProviderRepository } from './modules/providers/repository.js';
import {
  createProviderOwnRepository,
  createProviderWriter,
} from './modules/providers/write-repository.js';

/**
 * The process entry point: validate the environment, build the app, listen.
 *
 * Configuration is read before anything is constructed, so an invalid environment can never
 * produce a half-started server that accepts traffic.
 */
async function main(): Promise<void> {
  const config = getConfig();

  // `buildApp` stays usable with no database — `/health` and every existing test depend on that —
  // so the client, the mailer and better-auth are assembled here, at the one place that already
  // knows it is a real process talking to a real environment.
  const prisma = getPrismaClient(config);
  const auth = buildAuth({ config, prisma, mailer: createMailer({ config }) });
  const search = createSearchRepository(prisma);
  const providers = createProviderRepository(prisma);
  const providerOwn = createProviderOwnRepository(prisma);
  const providerWriter = createProviderWriter(prisma);

  const app = buildApp({
    config,
    auth,
    search,
    providers,
    providerOwn,
    providerWriter,
    prisma,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    // No logger yet — configuration is what the logger is built from. stderr is the only channel.
    console.error(`\n${error.message}\n`);
    process.exit(78); // EX_CONFIG
  }
  console.error(error);
  process.exit(1);
});
