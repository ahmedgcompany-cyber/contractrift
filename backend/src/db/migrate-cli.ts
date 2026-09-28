import { loadConfig } from '../config.js';
import { openDatabase } from './client.js';

const config = loadConfig();
const database = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
await database.migrate();
console.log(`Migrations applied (${database.driver}).`);
await database.close();
