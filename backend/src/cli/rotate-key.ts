/**
 * Re-encrypts all stored secrets with the current ENCRYPTION_KEY.
 * Rotation: set ENCRYPTION_KEY=<new> and ENCRYPTION_KEY_PREVIOUS=<old>, then run this (the server
 * also does it at startup). Remove ENCRYPTION_KEY_PREVIOUS once "failed" is 0 everywhere.
 *   npm run rotate-key -w backend
 * Exit code 1 if any secret could not be decrypted with any configured key.
 */
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { reencryptAll } from '../services/keys.js';

const config = loadConfig();
const database = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
await database.migrate();
const log = { debug() {}, info() {}, warn: console.warn, error: console.error };
const report = await reencryptAll({ db: database.db, config, log }, { userId: null, ip: 'cli' });
console.log(JSON.stringify(report, null, 2));
await database.close();
process.exitCode = report.monitors.failed || report.channels.failed ? 1 : 0;
