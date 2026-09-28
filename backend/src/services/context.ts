import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';

type LogFn = (obj: object | string, msg?: string) => void;
export type Logger = { debug: LogFn; info: LogFn; warn: LogFn; error: LogFn };

/** Everything business logic needs; deliberately free of HTTP framework types. */
export type Ctx = { db: Db; config: AppConfig; log: Logger };

export type Actor = { userId: string | null; ip?: string | undefined };
