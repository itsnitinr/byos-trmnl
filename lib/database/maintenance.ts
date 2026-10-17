import { sql } from "kysely";
import { prunePendingDeviceClaims } from "@/lib/device/pending-device-claims";
import { db } from "./db";
import { checkDbConnection } from "./utils";

/** Opt-in retention; each run deletes bounded batches instead of locking a large log table. */
export async function pruneExpiredLogs(): Promise<void> {
	const days = Number(process.env.LOG_RETENTION_DAYS ?? 0);
	if (!Number.isInteger(days) || days < 1 || days > 3650) return;
	const cutoff = new Date(Date.now() - days * 86_400_000);
	for (const table of ["system_logs", "logs"] as const) {
		await sql`DELETE FROM ${sql.table(table)} WHERE id IN (
			SELECT id FROM ${sql.table(table)} WHERE created_at < ${cutoff}
			ORDER BY created_at LIMIT 1000
		)`.execute(db);
	}
}

/** Hourly housekeeping. Each task is independent; one failing does not skip the rest. */
export async function runMaintenance(): Promise<void> {
	if (!process.env.DATABASE_URL) return;
	if (!(await checkDbConnection()).ready) return;
	const tasks: [string, () => Promise<unknown>][] = [
		["log retention", pruneExpiredLogs],
		["pending device claims", prunePendingDeviceClaims],
	];
	for (const [name, task] of tasks) {
		try {
			await task();
		} catch (error) {
			console.error(`[maintenance] ${name} failed:`, error);
		}
	}
}

const state = globalThis as typeof globalThis & {
	byosMaintenanceTimer?: ReturnType<typeof setInterval>;
};

export function startMaintenance(): void {
	if (state.byosMaintenanceTimer || !process.env.DATABASE_URL) return;
	let running = false;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			await runMaintenance();
		} finally {
			running = false;
		}
	};
	state.byosMaintenanceTimer = setInterval(
		() => {
			void run();
		},
		60 * 60 * 1000,
	);
	state.byosMaintenanceTimer.unref();
	void run();
}
