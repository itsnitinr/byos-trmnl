import type { PoolConfig } from "pg";

/**
 * TLS settings shared by every Postgres client the app opens (Kysely pool,
 * better-auth pool, migration runner), so they cannot drift apart.
 *
 * `sslmode` in the connection string still takes precedence inside `pg`;
 * this only decides the default when the URL does not say.
 */
export function databaseSslConfig(
	connectionString = process.env.DATABASE_URL,
): PoolConfig["ssl"] {
	if (connectionString?.includes("sslmode=disable")) return false;
	if (process.env.DATABASE_SSL === "false") return false;
	if (process.env.DATABASE_SSL === "verify")
		return { rejectUnauthorized: true };
	return process.env.NODE_ENV === "production"
		? { rejectUnauthorized: false }
		: false;
}

function positiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Pool settings for request-time queries. Keep statements short; migrations use their own client. */
export function databasePoolConfig(
	connectionString = process.env.DATABASE_URL,
): PoolConfig {
	return {
		connectionString,
		max: positiveInt(process.env.DATABASE_POOL_MAX, 10),
		connectionTimeoutMillis: 5000,
		statement_timeout: positiveInt(
			process.env.DATABASE_STATEMENT_TIMEOUT_MS,
			10_000,
		),
		idleTimeoutMillis: 30_000,
		ssl: databaseSslConfig(connectionString),
	};
}
