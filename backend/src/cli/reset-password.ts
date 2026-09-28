/**
 * Break-glass admin recovery: sets a new random password for a user (by email), clears lockout,
 * forces a password change and signs the user out. Usage: npm run reset-password -w backend -- <email>
 */
import { eq, sql } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { randomToken } from '../lib/crypto.js';
import { audit } from '../services/audit.js';
import { hashPassword } from '../services/auth.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run reset-password -w backend -- <email>');
  process.exit(2);
}
const config = loadConfig();
const database = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
await database.migrate();
const [user] = await database.db
  .select()
  .from(users)
  .where(sql`lower(${users.email}) = lower(${email})`);
if (!user) {
  console.error(`No user with email ${email}.`);
  await database.close();
  process.exit(1);
}
const password = randomToken(12);
await database.db
  .update(users)
  .set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, disabled: false })
  .where(eq(users.id, user.id));
await database.db.delete(sessions).where(eq(sessions.userId, user.id));
await audit(database, { userId: null, ip: 'cli' }, { action: 'user.password_reset_cli', targetType: 'user', targetId: user.id });
console.log(`Temporary password for ${user.email}: ${password}`);
console.log('The user must change it at next sign-in.');
await database.close();
