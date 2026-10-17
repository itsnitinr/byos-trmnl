import { runMigrations } from "@/lib/database/migrate";
import { resetDatabase, withClient } from "@/tests/db/reset";

let sessionUser: string | null = null;
jest.mock("@/lib/auth/get-user", () => ({
	getCurrentUserId: jest.fn(async () => sessionUser),
}));
jest.mock("next/server", () => ({
	...jest.requireActual("next/server"),
	connection: jest.fn(async () => undefined),
}));

const url = process.env.DATABASE_URL as string;
type Route = typeof import("./route");
let route: Route;

function setup(headers: Record<string, string>) {
	return route
		.GET(new Request("http://localhost/api/setup", { headers }))
		.then(async (response) => ({
			status: response.status,
			body: await response.json(),
		}));
}

beforeAll(async () => {
	await resetDatabase(url);
	const run = await runMigrations(url);
	if (!run.ok) throw new Error(`Migrations failed at ${run.failed}`);
	await withClient(url, (client) =>
		client.query(`
			INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES
				('owner-a', 'A', 'a@example.test', true, now(), now()),
				('owner-b', 'B', 'b@example.test', true, now(), now());
		`),
	);
	route = require("./route") as Route;
});

afterAll(async () => {
	await (require("@/lib/logger") as typeof import("@/lib/logger")).flushLogs();
	const { db } =
		require("@/lib/database/db") as typeof import("@/lib/database/db");
	await db.destroy();
});

test("refuses setup when no owner can be determined", async () => {
	sessionUser = null;
	const result = await setup({ ID: "aa:00:00:00:00:01", Model: "og_png" });
	expect(result.status).toBe(403);
	expect(result.body.api_key).toBeNull();
});

test("registers a new device for the owner and returns the same key again", async () => {
	sessionUser = "owner-a";
	const first = await setup({ ID: "aa:00:00:00:00:01", Model: "og_png" });
	expect(first.status).toBe(200);
	expect(first.body.api_key).toMatch(/^\S{8,}$/);

	const again = await setup({ ID: "AA:00:00:00:00:01", Model: "og_png" });
	expect(again.body).toMatchObject({
		status: 200,
		api_key: first.body.api_key,
		friendly_id: first.body.friendly_id,
	});
});

test("a device's token moves it to a new MAC without a session", async () => {
	sessionUser = null;
	const { rows } = await withClient(url, (client) =>
		client.query(
			"SELECT api_key, friendly_id FROM devices WHERE user_id = 'owner-a'",
		),
	);
	const moved = await setup({
		ID: "AA:00:00:00:00:99",
		Model: "og_png",
		"Access-Token": rows[0].api_key,
	});
	expect(moved.body).toMatchObject({
		status: 200,
		api_key: rows[0].api_key,
		friendly_id: rows[0].friendly_id,
	});
	const mac = await withClient(url, (client) =>
		client.query("SELECT mac_address FROM devices WHERE api_key = $1", [
			rows[0].api_key,
		]),
	);
	expect(mac.rows[0].mac_address).toBe("AA:00:00:00:00:99");
});

test("another owner cannot obtain or take over a known MAC", async () => {
	sessionUser = "owner-b";
	const result = await setup({ ID: "AA:00:00:00:00:99", Model: "og_png" });
	expect(result.status).not.toBe(200);
	expect(result.body.api_key ?? null).toBeNull();
	const owners = await withClient(url, (client) =>
		client.query(
			"SELECT user_id FROM devices WHERE mac_address = 'AA:00:00:00:00:99'",
		),
	);
	expect(owners.rows).toEqual([{ user_id: "owner-a" }]);
});
