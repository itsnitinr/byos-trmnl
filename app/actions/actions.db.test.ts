import { runMigrations } from "@/lib/database/migrate";
import { resetDatabase, withClient } from "@/tests/db/reset";

let currentUser = "tenant-a";
jest.mock("@/lib/auth/get-user", () => ({
	getCurrentUserId: jest.fn(async () => currentUser),
	BYOS_MONO_USER_ID: "byos_mono_user",
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
// Single-user mode: system logs are readable without an admin session.
jest.mock("@/lib/auth/auth", () => ({ auth: null }));

const url = process.env.DATABASE_URL as string;

type DeviceActions = typeof import("./device");
type PlaylistActions = typeof import("./playlist");
let devices: DeviceActions;
let playlists: PlaylistActions;
let deviceId: number;

beforeAll(async () => {
	await resetDatabase(url);
	const run = await runMigrations(url);
	if (!run.ok) throw new Error(`Migrations failed at ${run.failed}`);
	await withClient(url, async (client) => {
		await client.query(`
			INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES
				('tenant-a', 'A', 'a@example.test', true, now(), now()),
				('tenant-b', 'B', 'b@example.test', true, now(), now());
		`);
		const { rows } = await client.query<{ id: string }>(`
			INSERT INTO devices (friendly_id, name, mac_address, api_key, user_id)
			VALUES ('AAAAAA', 'a', 'AA:00:00:00:00:01', 'key-aaaaaaaaaaaaaaaaaaaa', 'tenant-a')
			RETURNING id`);
		deviceId = Number(rows[0].id);
	});
	devices = require("./device") as DeviceActions;
	playlists = require("./playlist") as PlaylistActions;
});

afterAll(async () => {
	await (require("@/lib/logger") as typeof import("@/lib/logger")).flushLogs();
	const { db } =
		require("@/lib/database/db") as typeof import("@/lib/database/db");
	await db.destroy();
});

beforeEach(() => {
	currentUser = "tenant-a";
});

test("saving a device with 'None' selections and string rates succeeds", async () => {
	const result = await devices.updateDevice({
		id: deviceId,
		name: "Kitchen",
		playlist_id: "",
		mixup_id: "",
		refresh_schedule: {
			default_refresh_rate: "900" as unknown as number,
			time_ranges: [
				{ start_time: "00:00", end_time: "07:00", refresh_rate: 3600 },
			],
		},
	});
	expect(result).toEqual({ success: true });

	const device = await devices.fetchDeviceByFriendlyId("AAAAAA");
	expect(device).toMatchObject({
		name: "Kitchen",
		playlist_id: null,
		mixup_id: null,
		refresh_schedule: {
			default_refresh_rate: 900,
			time_ranges: [
				{ start_time: "00:00", end_time: "07:00", refresh_rate: 3600 },
			],
		},
	});
});

test("device updates are validated and limited to the owner", async () => {
	expect(
		await devices.updateDevice({ id: deviceId, timezone: "Mars/Base" }),
	).toEqual({ success: false, error: "timezone: Unknown timezone" });

	currentUser = "tenant-b";
	expect(
		await devices.updateDevice({ id: deviceId, name: "Mine now" }),
	).toEqual({ success: false, error: "Device not found" });
});

test("playlists are validated, saved, scoped and deletable while in use", async () => {
	expect(
		await playlists.savePlaylistWithItems({
			name: "Bad",
			items: [{ screen_id: "weather", duration: 0, order_index: 0 }],
		}),
	).toMatchObject({
		success: false,
		error: expect.stringContaining("duration"),
	});

	const saved = await playlists.savePlaylistWithItems({
		name: "Morning",
		items: [
			{
				screen_id: "weather",
				duration: 120,
				order_index: 0,
				start_time: "",
				days_of_week: ["monday", "friday"],
			},
			{ screen_id: "news", duration: 300, order_index: 1 },
		],
	});
	expect(saved.success).toBe(true);
	const playlistId = saved.playlistId as string;

	const loaded = await playlists.fetchPlaylistWithItems(playlistId);
	expect(loaded.items.map((item) => item.screen_id)).toEqual([
		"weather",
		"news",
	]);
	expect(loaded.items[0]).toMatchObject({
		start_time: null,
		days_of_week: ["monday", "friday"],
	});

	currentUser = "tenant-b";
	expect(
		await playlists.savePlaylistWithItems({
			id: playlistId,
			name: "Hijacked",
			items: [],
		}),
	).toEqual({ success: false, error: "Playlist not found" });
	expect(
		(await playlists.fetchPlaylistWithItems(playlistId)).playlist,
	).toBeNull();

	currentUser = "tenant-a";
	await devices.updateDevice({
		id: deviceId,
		display_mode: "playlist" as never,
		playlist_id: playlistId,
	});
	expect(await playlists.deletePlaylist(playlistId)).toEqual({ success: true });
	expect(
		(await devices.fetchDeviceByFriendlyId("AAAAAA"))?.playlist_id,
	).toBeNull();
});

describe("log queries", () => {
	type SystemActions = typeof import("./system");
	let system: SystemActions;

	beforeAll(async () => {
		system = require("./system") as SystemActions;
		await withClient(url, (client) =>
			client.query(`
				INSERT INTO logs (friendly_id, log_data) VALUES
					('AAAAAA', '{"message":"battery 100% ok"}'),
					('AAAAAA', '{"message":"battery 1000 ok"}'),
					('AAAAAA', '{"message":"wifi failed"}');
				INSERT INTO system_logs (level, message, source, metadata) VALUES
					('info', 'Display request successful', 'api/display', '{"deviceId":"AAAAAA"}'),
					('info', 'Display request successful', 'api/display', '{"deviceId":"BBBBBB"}'),
					('error', 'Render failed', 'api/bitmap', '{"deviceId":"AAAAAA"}');
			`),
		);
	});

	test("device log search treats % literally and filters by type", async () => {
		const percent = await devices.fetchDeviceLogsWithFilters({
			page: 1,
			perPage: 10,
			search: "100%",
		});
		expect(percent.total).toBe(1);

		const errors = await devices.fetchDeviceLogsWithFilters({
			page: 1,
			perPage: 10,
			type: "error",
		});
		expect(errors.logs.map((log) => log.log_data)).toEqual([
			'{"message":"wifi failed"}',
		]);

		currentUser = "tenant-b";
		expect(
			(await devices.fetchDeviceLogsWithFilters({ page: 1, perPage: 10 }))
				.total,
		).toBe(0);
	});

	test("device system logs match the device and narrow by search", async () => {
		const all = await system.fetchDeviceSystemLogs({
			page: 1,
			perPage: 10,
			friendlyId: "AAAAAA",
		});
		expect(all.total).toBe(2);

		const searched = await system.fetchDeviceSystemLogs({
			page: 1,
			perPage: 10,
			friendlyId: "AAAAAA",
			search: "Render",
		});
		expect(searched.logs.map((log) => log.message)).toEqual(["Render failed"]);
		expect(searched.uniqueSources).toEqual(["api/bitmap", "api/display"]);
	});
});
