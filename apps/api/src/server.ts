import { buildApp } from './app.js';
import { ConfigError, getConfig } from './config.js';

/**
 * The process entry point: validate the environment, build the app, listen.
 *
 * Configuration is read before anything is constructed, so an invalid environment can never
 * produce a half-started server that accepts traffic.
 */
async function main(): Promise<void> {
  const config = getConfig();
  const app = buildApp({ config });

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
