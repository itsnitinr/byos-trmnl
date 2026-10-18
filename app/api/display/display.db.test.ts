import { runMigrations } from "@/lib/database/migrate";
import { resetDatabase, withClient } from "@/tests/db/reset";

let sessionUser: string | null = "byos_mono_user";
jest.mock("@/lib/auth/get-user", () => ({
	getCurrentUserId: jest.fn(async () => sessionUser),
}));

const url = process.env.DATABASE_URL as string;
type Route = typeof import("./route");
let route: Route;

async function display(headers: Record<string, string>) {
	const response = await route.GET(
		new Request("http://byos.test/api/display", {
			headers: { "X-Forwarded-Host": "byos.test", ...headers },
		}),
	);
	return response.json();
}

beforeAll(async () => {
	process.env.TRMNL_REGISTRY_OFFLINE = "true";
	process.env.FIRMWARE_UPDATES = "off";
	await resetDatabase(url);
	const run = await runMigrations(url);
	if (!run.ok) throw new Error(`Migrations failed at ${run.failed}`);
	route = require("./route") as Route;
});

afterAll(async () => {
	await (require("@/lib/logger") as typeof import("@/lib/logger")).flushLogs();
	const { db } =
		require("@/lib/database/db") as typeof import("@/lib/database/db");
	await db.destroy();
});

test("rejects requests without a token", async () => {
	const body = await display({ ID: "AA:00:00:00:00:01" });
	expect(body).toMatchObject({ status: 401 });
	expect(body.image_url).toContain("/api/bitmap/error.png");
});

test("single-user mode registers a new device and records telemetry", async () => {
	const headers = {
		"Access-Token": "display-test-token-0001",
		ID: "aa:00:00:00:00:01",
		Model: "og_png",
		"Battery-Voltage": "3.95",
		RSSI: "-61",
		"FW-Version": "1.6.2",
	};
	const first = await display(headers);
	// Default schedule: 60 s, with 3600 s between 00:00 and 07:00 UTC.
	const sleeping = new Date().getUTCHours() < 7;
	expect(first).toMatchObject({
		status: 0,
		refresh_rate: sleeping ? 3600 : 60,
		image_url_timeout: 30,
		image_rotate: 1,
	});
	expect(first.image_url).toBe(
		"http://byos.test/api/bitmap/simple-text.png?width=800&height=480&model=og_png&palette_id=bw",
	);

	const second = await display(headers);
	expect(second.filename).not.toBe(first.filename);

	const { rows } = await withClient(url, (client) =>
		client.query(
			"SELECT mac_address, battery_voltage, rssi, firmware_version, user_id FROM devices",
		),
	);
	expect(rows).toEqual([
		{
			mac_address: "AA:00:00:00:00:01",
			battery_voltage: "3.95",
			rssi: -61,
			firmware_version: "1.6.2",
			user_id: "byos_mono_user",
		},
	]);
});

test("playlist mode rotates items and persists the position", async () => {
	await withClient(url, (client) =>
		client.query(`
			INSERT INTO playlists (id, name, user_id)
			VALUES ('33333333-3333-3333-3333-333333333333', 'P', 'byos_mono_user');
			INSERT INTO playlist_items (playlist_id, screen_id, duration, order_index) VALUES
				('33333333-3333-3333-3333-333333333333', 'year-progress', 600, 0),
				('33333333-3333-3333-3333-333333333333', 'album', 120, 4);
			UPDATE devices SET display_mode = 'playlist',
				playlist_id = '33333333-3333-3333-3333-333333333333',
				current_playlist_index = -1;
		`),
	);
	const headers = { "Access-Token": "display-test-token-0001" };
	const shown = [];
	for (let i = 0; i < 3; i++) {
		const body = await display(headers);
		shown.push([
			body.image_url.match(/bitmap\/([^.]+)/)?.[1],
			body.refresh_rate,
		]);
	}
	expect(shown).toEqual([
		["year-progress", 600],
		["album", 120],
		["year-progress", 600],
	]);
	const { rows } = await withClient(url, (client) =>
		client.query("SELECT current_playlist_index FROM devices"),
	);
	expect(rows[0].current_playlist_index).toBe(0);
});

test("with authentication, unknown devices get a claim code instead of a device", async () => {
	sessionUser = null;
	const body = await display({
		"Access-Token": "unclaimed-token-0001",
		ID: "BB:00:00:00:00:01",
		Model: "og_png",
	});
	expect(body.image_url).toMatch(/Claim%20code%3A%20[A-Z0-9]{4}-[A-Z0-9]{4}/);
	const { rows } = await withClient(url, (client) =>
		client.query(
			"SELECT api_key, mac_address FROM pending_device_claims ORDER BY first_seen_at",
		),
	);
	expect(rows).toEqual([
		{ api_key: "unclaimed-token-0001", mac_address: "BB:00:00:00:00:01" },
	]);
	const devices = await withClient(url, (client) =>
		client.query("SELECT count(*)::int AS n FROM devices"),
	);
	expect(devices.rows[0].n).toBe(1);
});

test("an owned device keeps working without a session", async () => {
	sessionUser = null;
	const body = await display({ "Access-Token": "display-test-token-0001" });
	expect(body.status).toBe(0);
	expect(body.image_url).toContain("/api/bitmap/");
});
