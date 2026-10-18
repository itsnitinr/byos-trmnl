import { resetDatabase, withClient } from "@/tests/db/reset";
import { runMigrations } from "./migrate";

jest.mock("@/lib/auth/get-user", () => ({
	getCurrentUserId: jest.fn(async () => "byos_mono_user"),
}));

const url = process.env.DATABASE_URL as string;

type MaintenanceModule = typeof import("./maintenance");
let maintenance: MaintenanceModule;

beforeAll(async () => {
	await resetDatabase(url);
	const run = await runMigrations(url);
	if (!run.ok) throw new Error(`Migrations failed at ${run.failed}`);
	maintenance = require("./maintenance") as MaintenanceModule;
});

afterAll(async () => {
	await (require("@/lib/logger") as typeof import("@/lib/logger")).flushLogs();
	const { db } = require("./db") as typeof import("./db");
	await db.destroy();
});

test("prunes abandoned device claims and keeps active ones", async () => {
	await withClient(url, (client) =>
		client.query(`
			INSERT INTO pending_device_claims (claim_hash, api_key, api_key_suffix, last_seen_at) VALUES
				('fresh', 'k1', '0001', now() - interval '1 hour'),
				('stale', 'k2', '0002', now() - interval '3 days');
		`),
	);
	await maintenance.runMaintenance();
	const { rows } = await withClient(url, (client) =>
		client.query("SELECT claim_hash FROM pending_device_claims"),
	);
	expect(rows).toEqual([{ claim_hash: "fresh" }]);
});

test("log retention is opt-in and deletes only old rows", async () => {
	await withClient(url, (client) =>
		client.query(`
			INSERT INTO system_logs (level, message, created_at) VALUES
				('info', 'old', now() - interval '40 days'),
				('info', 'new', now());
		`),
	);
	delete process.env.LOG_RETENTION_DAYS;
	await maintenance.runMaintenance();
	const before = await withClient(url, (client) =>
		client.query("SELECT count(*)::int AS n FROM system_logs"),
	);
	expect(before.rows[0].n).toBe(2);

	process.env.LOG_RETENTION_DAYS = "30";
	await maintenance.runMaintenance();
	const after = await withClient(url, (client) =>
		client.query("SELECT message FROM system_logs"),
	);
	expect(after.rows).toEqual([{ message: "new" }]);
	delete process.env.LOG_RETENTION_DAYS;
});
