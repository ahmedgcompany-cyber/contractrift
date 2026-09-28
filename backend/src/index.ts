import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { Jobs } from './jobs/jobs.js';
import { closeHttpAgents } from './lib/http-client.js';

async function main() {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const database = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
  await database.migrate();
  const { app, ctx } = await buildApp(config, database);
  app.log.info({ driver: database.driver, allowPrivateTargets: config.allowPrivateTargets }, 'database ready, migrations applied');
  if (database.driver === 'pglite' && config.nodeEnv === 'production') {
    app.log.warn('Running production on embedded PGlite. Set DATABASE_URL to a PostgreSQL server for multi-instance or high-volume use.');
  }

  const jobs = new Jobs(ctx);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    await jobs.stop();
    await app.close();
    await closeHttpAgents();
    await database.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  // Start background work only once the server is actually serving.
  if (config.schedulerEnabled) jobs.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
