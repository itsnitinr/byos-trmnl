import { createHash } from "node:crypto";
import { Client } from "pg";
import { databaseSslConfig } from "./connection";
import { SQL_STATEMENTS } from "./sql-statements";

/**
 * Applies `migrations/*.sql` (compiled into SQL_STATEMENTS) in order.
 *
 * - Each migration runs in its own transaction together with its ledger row,
 *   so a failure leaves no half-applied migration behind.
 * - Applied migrations are verified by checksum and never re-run.
 * - A session advisory lock serializes concurrent runners (two browser tabs,
 *   several replicas booting with AUTO_MIGRATE=true).
 * - Uses a dedicated client: request pool statement timeouts would abort long
 *   index builds.
 */

export type MigrationKey = keyof typeof SQL_STATEMENTS;

export type MigrationResult = {
	status: "success" | "error";
	result: Record<string, unknown>[];
	notices: Record<string, unknown>[];
	error?: string;
	executionTime?: number;
};

export type MigrationRunResult = {
	ok: boolean;
	results: Partial<Record<MigrationKey, MigrationResult>>;
	failed?: MigrationKey;
};

const LEDGER_MIGRATION = "0012_create_schema_migrations" as const;
// Arbitrary app-wide constants; they only need to be unique among this app's advisory locks.
const MIGRATION_LOCK_NAMESPACE = 20261017;
const MIGRATION_LOCK_KEY = 1;

/**
 * Migrations whose file content changed after release. Databases that applied
 * an older revision are still considered up to date.
 */
const CHECKSUM_COMPATIBILITY: Partial<
	Record<MigrationKey, { current: string; historical: readonly string[] }>
> = {
	"0018_remove_mixup_recipe_slug": {
		current: "5ac29d4283f03370ce3fb9379d669339165b01ab7dc0a487c53f50f236f6924e",
		historical: [
			"0437f4ac2c2ad1daefe09f2e263f858e083443b149882fc35c5a718682224688",
			"5e78a1102c5d925559435d5141d085c756f5f25ffa34033030f8345475afc99e",
		],
	},
};

export function checksumSql(sql: string): string {
	return createHash("sha256").update(sql).digest("hex");
}

export function isAcceptedChecksum(
	migration: MigrationKey,
	appliedChecksum: string,
	currentChecksum: string,
): boolean {
	if (appliedChecksum === currentChecksum) return true;
	const compatibility = CHECKSUM_COMPATIBILITY[migration];
	return (
		compatibility?.current === currentChecksum &&
		compatibility.historical.includes(appliedChecksum)
	);
}

/** Every migration key in apply order, ledger first. */
export function migrationOrder(): MigrationKey[] {
	const rest = (Object.keys(SQL_STATEMENTS) as MigrationKey[])
		.filter((key) => key !== "validate_schema" && key !== LEDGER_MIGRATION)
		.sort();
	return [LEDGER_MIGRATION, ...rest];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function appliedMigrations(client: Client): Promise<Map<string, string>> {
	const { rows } = await client.query<{ name: string; checksum: string }>(
		"SELECT name, checksum FROM schema_migrations",
	);
	return new Map(rows.map((row) => [row.name, row.checksum]));
}

export async function runMigrations(
	connectionString = process.env.DATABASE_URL,
	options: { log?: (message: string) => void } = {},
): Promise<MigrationRunResult> {
	if (!connectionString) throw new Error("DATABASE_URL is not set");
	const log = options.log ?? (() => {});
	const results: MigrationRunResult["results"] = {};
	let notices: Record<string, unknown>[] = [];

	const client = new Client({
		connectionString,
		ssl: databaseSslConfig(connectionString),
		connectionTimeoutMillis: 10_000,
	});
	client.on("notice", (notice) => {
		notices.push({ message: notice.message, severity: notice.severity });
	});
	await client.connect();

	try {
		await client.query("SELECT pg_advisory_lock($1, $2)", [
			MIGRATION_LOCK_NAMESPACE,
			MIGRATION_LOCK_KEY,
		]);

		let applied = new Map<string, string>();
		for (const key of migrationOrder()) {
			notices = [];
			const statement = SQL_STATEMENTS[key];
			const checksum = checksumSql(statement.sql);

			try {
				if (key === LEDGER_MIGRATION) {
					// The ledger table must exist before it can be consulted.
					await client.query(statement.sql);
					applied = await appliedMigrations(client);
				}

				const appliedChecksum = applied.get(key);
				if (appliedChecksum) {
					if (!isAcceptedChecksum(key, appliedChecksum, checksum)) {
						throw new Error(
							`Migration ${key} was already applied with a different checksum`,
						);
					}
					results[key] = {
						status: "success",
						result: [{ skipped: true, reason: "Already applied" }],
						notices,
					};
					continue;
				}

				const started = performance.now();
				await client.query("BEGIN");
				try {
					if (key !== LEDGER_MIGRATION) await client.query(statement.sql);
					await client.query(
						"INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
						[key, checksum],
					);
					await client.query("COMMIT");
				} catch (error) {
					await client.query("ROLLBACK").catch(() => undefined);
					throw error;
				}
				applied.set(key, checksum);
				log(`[migrate] applied ${key}`);
				results[key] = {
					status: "success",
					result: [{ applied: true }],
					notices,
					executionTime: Math.round(performance.now() - started),
				};
			} catch (error) {
				log(`[migrate] ${key} failed: ${errorMessage(error)}`);
				results[key] = {
					status: "error",
					result: [],
					notices,
					error: errorMessage(error),
				};
				results.validate_schema = {
					status: "error",
					result: [],
					notices: [],
					error: `Skipped schema validation because migration ${key} failed`,
				};
				return { ok: false, results, failed: key };
			}
		}

		const started = performance.now();
		const { rows } = await client.query<Record<string, unknown>>(
			SQL_STATEMENTS.validate_schema.sql,
		);
		results.validate_schema = {
			status: rows.length === 0 ? "success" : "error",
			result: rows,
			notices: [],
			error:
				rows.length === 0
					? undefined
					: "Schema validation found missing tables",
			executionTime: Math.round(performance.now() - started),
		};
		return { ok: rows.length === 0, results };
	} finally {
		// Closing the session releases the advisory lock as well.
		await client.end().catch(() => undefined);
	}
}
