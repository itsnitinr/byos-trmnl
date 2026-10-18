import { resetDatabase, withClient } from "@/tests/db/reset";
import { migrationOrder, runMigrations } from "./migrate";

const url = process.env.DATABASE_URL as string;

describe("runMigrations (Postgres)", () => {
	beforeAll(async () => {
		await resetDatabase(url);
	});

	it("applies every migration once and validates the schema", async () => {
		const first = await runMigrations(url);
		expect(first.failed).toBeUndefined();
		expect(first.ok).toBe(true);
		for (const key of migrationOrder()) {
			expect(first.results[key]).toMatchObject({
				status: "success",
				result: [{ applied: true }],
			});
		}

		const second = await runMigrations(url);
		expect(second.ok).toBe(true);
		for (const key of migrationOrder()) {
			expect(second.results[key]?.result).toEqual([
				{ skipped: true, reason: "Already applied" },
			]);
		}
	});

	it("serializes concurrent runners", async () => {
		await resetDatabase(url);
		const runs = await Promise.all([
			runMigrations(url),
			runMigrations(url),
			runMigrations(url),
		]);
		expect(runs.every((run) => run.ok)).toBe(true);
		const ledger = await withClient(url, (client) =>
			client.query("SELECT count(*)::int AS n FROM schema_migrations"),
		);
		expect(ledger.rows[0].n).toBe(migrationOrder().length);
	});

	it("rejects a migration whose recorded checksum differs", async () => {
		await withClient(url, (client) =>
			client.query(
				"UPDATE schema_migrations SET checksum = 'tampered' WHERE name = '0003_add_playlists'",
			),
		);
		const run = await runMigrations(url);
		expect(run.ok).toBe(false);
		expect(run.failed).toBe("0003_add_playlists");
		expect(run.results["0003_add_playlists"]?.error).toMatch(/checksum/);
		await resetDatabase(url);
		expect((await runMigrations(url)).ok).toBe(true);
	});
});

describe("schema behaviour after migrations (Postgres)", () => {
	beforeAll(async () => {
		await resetDatabase(url);
		const run = await runMigrations(url);
		if (!run.ok) throw new Error(`Migrations failed at ${run.failed}`);
	});

	async function seed(client: import("pg").Client, suffix: string) {
		const userId = `user-${suffix}`;
		await client.query(
			`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
			 VALUES ($1, 'Test', $2, true, now(), now())`,
			[userId, `${suffix}@example.test`],
		);
		const device = await client.query<{ id: string }>(
			`INSERT INTO devices (friendly_id, name, mac_address, api_key, user_id)
			 VALUES ($1, 'Device', $2, $3, $4) RETURNING id`,
			[`DEV-${suffix}`, `AA:BB:CC:00:00:${suffix}`, `key-${suffix}`, userId],
		);
		await client.query(
			"INSERT INTO logs (friendly_id, log_data) VALUES ($1, '{}'), ($1, '{}')",
			[`DEV-${suffix}`],
		);
		return { userId, deviceId: device.rows[0].id };
	}

	it("deletes a device together with its logs", async () => {
		await withClient(url, async (client) => {
			const { deviceId } = await seed(client, "01");
			await client.query("DELETE FROM devices WHERE id = $1", [deviceId]);
			const logs = await client.query(
				"SELECT 1 FROM logs WHERE friendly_id = 'DEV-01'",
			);
			expect(logs.rowCount).toBe(0);
		});
	});

	it("keeps logs attached when a device's friendly id changes", async () => {
		await withClient(url, async (client) => {
			const { deviceId } = await seed(client, "02");
			await client.query(
				"UPDATE devices SET friendly_id = 'RENAMED-02' WHERE id = $1",
				[deviceId],
			);
			const logs = await client.query(
				"SELECT 1 FROM logs WHERE friendly_id = 'RENAMED-02'",
			);
			expect(logs.rowCount).toBe(2);
		});
	});

	it("deletes a user with devices that have logs", async () => {
		await withClient(url, async (client) => {
			const { userId } = await seed(client, "03");
			await client.query('DELETE FROM "user" WHERE id = $1', [userId]);
			const devices = await client.query(
				"SELECT 1 FROM devices WHERE user_id = $1",
				[userId],
			);
			expect(devices.rowCount).toBe(0);
		});
	});

	it("clears device assignments when a playlist or mixup is deleted", async () => {
		await withClient(url, async (client) => {
			const { userId, deviceId } = await seed(client, "04");
			const playlist = await client.query<{ id: string }>(
				"INSERT INTO playlists (name, user_id) VALUES ('P', $1) RETURNING id",
				[userId],
			);
			const mixup = await client.query<{ id: string }>(
				"INSERT INTO mixups (name, layout_id, user_id) VALUES ('M', 'quarters', $1) RETURNING id",
				[userId],
			);
			await client.query(
				"UPDATE devices SET playlist_id = $1, mixup_id = $2 WHERE id = $3",
				[playlist.rows[0].id, mixup.rows[0].id, deviceId],
			);
			await client.query("DELETE FROM playlists WHERE id = $1", [
				playlist.rows[0].id,
			]);
			await client.query("DELETE FROM mixups WHERE id = $1", [
				mixup.rows[0].id,
			]);
			const device = await client.query(
				"SELECT playlist_id, mixup_id FROM devices WHERE id = $1",
				[deviceId],
			);
			expect(device.rows[0]).toEqual({ playlist_id: null, mixup_id: null });
		});
	});

	it("leaves byos_app without login or access to auth tables", async () => {
		await withClient(url, async (client) => {
			const role = await client.query(
				"SELECT rolcanlogin FROM pg_roles WHERE rolname = 'byos_app'",
			);
			expect(role.rows[0].rolcanlogin).toBe(false);
			const privileges = await client.query(`
				SELECT has_table_privilege('byos_app', 'public.session', 'SELECT') AS session,
				       has_table_privilege('byos_app', 'public.devices', 'SELECT') AS devices
			`);
			expect(privileges.rows[0]).toEqual({ session: false, devices: true });
		});
	});
});
