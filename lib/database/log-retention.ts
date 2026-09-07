import { sql } from "kysely";
import { db } from "./db";
import { checkDbConnection } from "./utils";

/** Opt-in retention; each run deletes bounded batches instead of locking a large log table. */
export async function pruneExpiredLogs(): Promise<void> {
	const days = Number(process.env.LOG_RETENTION_DAYS ?? 0);
	if (
		!Number.isInteger(days) ||
		days < 1 ||
		days > 3650 ||
		!process.env.DATABASE_URL
	)
		return;
	if (!(await checkDbConnection()).ready) return;
	const cutoff = new Date(Date.now() - days * 86_400_000);
	for (const table of ["system_logs", "logs"] as const) {
		await sql`DELETE FROM ${sql.table(table)} WHERE id IN (
			SELECT id FROM ${sql.table(table)} WHERE created_at < ${cutoff}
			ORDER BY created_at LIMIT 1000
		)`.execute(db);
	}
}

const state = globalThis as typeof globalThis & {
	byosLogRetentionTimer?: ReturnType<typeof setInterval>;
};
export function startLogRetention(): void {
	if (state.byosLogRetentionTimer || !Number(process.env.LOG_RETENTION_DAYS))
		return;
	let running = false;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			await pruneExpiredLogs();
		} catch (error) {
			console.error("Log retention failed", error);
		} finally {
			running = false;
		}
	};
	state.byosLogRetentionTimer = setInterval(
		() => {
			void run();
		},
		60 * 60 * 1000,
	);
	state.byosLogRetentionTimer.unref();
	void run();
}
