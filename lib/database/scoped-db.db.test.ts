import { sql } from "kysely";
import { resetDatabase, withClient } from "@/tests/db/reset";
import { runMigrations } from "./migrate";

jest.mock("@/lib/auth/get-user", () => ({
	getCurrentUserId: jest.fn(async () => "tenant-a"),
}));

const url = process.env.DATABASE_URL as string;

type DbModule = typeof import("./db");
type ScopedModule = typeof import("./scoped-db");
let database: DbModule;
let scoped: ScopedModule;

async function connectionState(conn: DbModule["db"]) {
	const { rows } = await sql<{
		role: string;
		user_id: string;
		api_key: string;
	}>`SELECT current_user AS role,
		coalesce(current_setting('app.current_user_id', true), '') AS user_id,
		coalesce(current_setting('app.device_api_key', true), '') AS api_key`.execute(
		conn,
	);
	return rows[0];
}

describe("RLS scoping helpers (Postgres)", () => {
	beforeAll(async () => {
		await resetDatabase(url);
		const run = await runMigrations(url);
		if (!run.ok) throw new Error(`Migrations failed at ${run.failed}`);
		await withClient(url, async (client) => {
			await client.query(`
				INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES
					('tenant-a', 'A', 'a@example.test', true, now(), now()),
					('tenant-b', 'B', 'b@example.test', true, now(), now());
				INSERT INTO devices (friendly_id, name, mac_address, api_key, user_id) VALUES
					('A1', 'a', 'AA:00:00:00:00:01', 'key-a', 'tenant-a'),
					('B1', 'b', 'BB:00:00:00:00:01', 'key-b', 'tenant-b');
			`);
		});
		// One pooled connection, so every helper reuses the same session and leaked
		// settings would be observable by the next query.
		process.env.DATABASE_POOL_MAX = "1";
		database = require("./db") as DbModule;
		scoped = require("./scoped-db") as ScopedModule;
	});

	afterAll(async () => {
		await database.db.destroy();
	});

	it("shows a tenant only its own devices and resets the connection", async () => {
		const devices = await scoped.withExplicitUserScope("tenant-a", (conn) =>
			conn.selectFrom("devices").select("friendly_id").execute(),
		);
		expect(devices.map((d) => d.friendly_id)).toEqual(["A1"]);
		expect(await connectionState(database.db)).toEqual({
			role: "postgres",
			user_id: "",
			api_key: "",
		});
	});

	it("blocks cross-tenant writes", async () => {
		const result = await scoped.withExplicitUserScope("tenant-a", (conn) =>
			conn
				.updateTable("devices")
				.set({ name: "hijacked" })
				.where("friendly_id", "=", "B1")
				.executeTakeFirst(),
		);
		expect(Number(result.numUpdatedRows)).toBe(0);
	});

	it("exposes exactly one device by access token", async () => {
		const devices = await scoped.withDeviceApiKey("key-b", (conn) =>
			conn.selectFrom("devices").select(["friendly_id", "user_id"]).execute(),
		);
		expect(devices).toEqual([{ friendly_id: "B1", user_id: "tenant-b" }]);
		// The key must not leak into a later user scope on the same connection.
		const visible = await scoped.withExplicitUserScope("tenant-a", (conn) =>
			conn.selectFrom("devices").select("friendly_id").execute(),
		);
		expect(visible.map((d) => d.friendly_id)).toEqual(["A1"]);
	});

	it("resets the connection when the callback throws", async () => {
		await expect(
			scoped.withExplicitUserScope("tenant-a", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await connectionState(database.db)).toEqual({
			role: "postgres",
			user_id: "",
			api_key: "",
		});
	});

	it("scopes transactions to the session user and resets on commit", async () => {
		const names = await scoped.withUserScopeTransaction(async (trx) => {
			await trx
				.updateTable("devices")
				.set({ name: "renamed" })
				.where("friendly_id", "=", "A1")
				.execute();
			return trx.selectFrom("devices").select("name").execute();
		});
		expect(names).toEqual([{ name: "renamed" }]);
		expect(await connectionState(database.db)).toEqual({
			role: "postgres",
			user_id: "",
			api_key: "",
		});
	});
});
