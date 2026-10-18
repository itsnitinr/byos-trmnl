import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { databasePoolConfig } from "./connection";
import type { DB } from "./db.d";

const state = globalThis as typeof globalThis & { byosDbPool?: Pool };

/**
 * One pool per process. Dev-mode module reloads would otherwise leak a new
 * pool (and its connections) on every edit.
 */
state.byosDbPool ??= new Pool(databasePoolConfig());
export const pool = state.byosDbPool;

// Idle clients can error when the server drops them (restart, failover). Without
// a listener that error is unhandled and takes the process down.
if (pool.listenerCount("error") === 0) {
	pool.on("error", (error) => {
		console.error("[db] Idle client error:", error.message);
	});
}

export const db = new Kysely<DB>({
	dialect: new PostgresDialect({ pool }),
});
