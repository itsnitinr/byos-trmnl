import { withExplicitUserScope } from "@/lib/database/scoped-db";
import type { RequestHeaders } from "@/lib/device/request-headers";
import { DeviceDisplayMode } from "@/lib/mixup/constants";
import type { Device } from "@/lib/types";
import {
	calculateRefreshRate,
	clampRefreshSeconds,
	recordDisplayVisit,
} from "./visit";

jest.mock("@/lib/database/db", () => ({ db: {} }));
jest.mock("@/lib/database/scoped-db", () => ({
	withExplicitUserScope: jest.fn(),
}));
jest.mock("@/lib/logger", () => ({ logError: jest.fn(), logInfo: jest.fn() }));

const at = new Date("2026-10-17T12:00:00Z"); // a Saturday

function device(overrides: Partial<Device> = {}): Device {
	return {
		id: 7,
		user_id: "alice",
		timezone: "UTC",
		display_mode: DeviceDisplayMode.SCREEN,
		playlist_id: null,
		current_playlist_index: null,
		refresh_schedule: null,
		friendly_id: "ABC",
		...overrides,
	} as Device;
}

const headers = {
	batteryVoltage: "3.9",
	rssi: "-60",
	fwVersion: "1.6.0",
	supportsTemperatureProfile: true,
} as RequestHeaders;

function fakeConnection(playlistRows: Record<string, unknown>[] = []) {
	const set = jest.fn();
	const update = jest.fn(async () => []);
	const read = jest.fn(async () => playlistRows);
	const conn = {
		selectFrom: () => ({
			selectAll: () => ({
				where: () => ({
					orderBy: () => ({ execute: read }),
				}),
			}),
		}),
		updateTable: () => ({
			set: (values: unknown) => {
				set(values);
				return { where: () => ({ execute: update }) };
			},
		}),
	};
	jest
		.mocked(withExplicitUserScope)
		.mockImplementation(async (_user, work) => work(conn as never));
	return { set, update, read };
}

beforeEach(() => jest.mocked(withExplicitUserScope).mockReset());

test("playlist read and status write share one scoped session", async () => {
	const { set, update } = fakeConnection([
		{ screen_id: "weather", duration: 120, order_index: 0, days_of_week: null },
		{ screen_id: "news", duration: 600, order_index: 3, days_of_week: null },
	]);
	const visit = await recordDisplayVisit(
		device({
			display_mode: DeviceDisplayMode.PLAYLIST,
			playlist_id: "p1",
			current_playlist_index: 0,
		}),
		headers,
		at,
	);
	expect(visit.playlistItem?.screen_id).toBe("news");
	expect(visit.refreshRate).toBe(600);
	expect(withExplicitUserScope).toHaveBeenCalledTimes(1);
	expect(update).toHaveBeenCalledTimes(1);
	expect(set).toHaveBeenCalledWith(
		expect.objectContaining({
			current_playlist_index: 3,
			battery_voltage: 3.9,
			rssi: -60,
			firmware_version: "1.6.0",
			last_refresh_duration: 600,
		}),
	);
});

test("persists playlist index zero", async () => {
	const { set } = fakeConnection([
		{ screen_id: "weather", duration: 60, order_index: 0, days_of_week: null },
	]);
	await recordDisplayVisit(
		device({ display_mode: DeviceDisplayMode.PLAYLIST, playlist_id: "p1" }),
		headers,
		at,
	);
	expect(set).toHaveBeenCalledWith(
		expect.objectContaining({ current_playlist_index: 0 }),
	);
});

test("falls back when no playlist item is eligible", async () => {
	fakeConnection([
		{
			screen_id: "weekday",
			duration: 60,
			order_index: 0,
			days_of_week: JSON.stringify(["monday"]),
		},
	]);
	const visit = await recordDisplayVisit(
		device({ display_mode: DeviceDisplayMode.PLAYLIST, playlist_id: "p1" }),
		headers,
		at,
	);
	expect(visit.playlistItem).toBeNull();
	expect(visit.refreshRate).toBe(180);
});

test("ignores malformed telemetry instead of failing the write", async () => {
	const { set } = fakeConnection();
	await recordDisplayVisit(
		device(),
		{ ...headers, rssi: "strong", batteryVoltage: "n/a" },
		at,
	);
	const values = set.mock.calls[0][0];
	expect(values).not.toHaveProperty("rssi");
	expect(values).not.toHaveProperty("battery_voltage");
});

test("a failed playlist write is reported; telemetry-only failure is best effort", async () => {
	jest.mocked(withExplicitUserScope).mockImplementation(async (_user, work) =>
		work({
			selectFrom: () => ({
				selectAll: () => ({
					where: () => ({
						orderBy: () => ({
							execute: async () => [
								{ screen_id: "a", duration: 60, order_index: 1 },
							],
						}),
					}),
				}),
			}),
			updateTable: () => ({
				set: () => ({
					where: () => ({
						execute: async () => {
							throw new Error("database unavailable");
						},
					}),
				}),
			}),
		} as never),
	);
	await expect(
		recordDisplayVisit(
			device({ display_mode: DeviceDisplayMode.PLAYLIST, playlist_id: "p1" }),
			headers,
			at,
		),
	).rejects.toThrow("database unavailable");
	await expect(recordDisplayVisit(device(), headers, at)).resolves.toEqual({
		quietHours: false,
		playlistItem: null,
		playlistItems: [],
		refreshRate: 180,
	});
});

test("uses the device schedule in its timezone outside playlist mode", async () => {
	fakeConnection();
	const visit = await recordDisplayVisit(
		device({
			timezone: "Asia/Kolkata", // 17:30 local
			refresh_schedule: {
				default_refresh_rate: 900,
				time_ranges: [
					{ start_time: "17:00", end_time: "18:00", refresh_rate: 120 },
				],
			},
		}),
		headers,
		at,
	);
	expect(visit.refreshRate).toBe(120);
});

test("refresh helpers clamp and fall back", () => {
	expect(clampRefreshSeconds(0)).toBe(1);
	expect(clampRefreshSeconds(10 ** 9)).toBe(86_400);
	expect(clampRefreshSeconds(Number.NaN)).toBe(180);
	expect(calculateRefreshRate(null, 300)).toBe(300);
	expect(
		calculateRefreshRate(
			{
				default_refresh_rate: 900,
				time_ranges: [
					{ start_time: "22:00", end_time: "06:00", refresh_rate: 3600 },
				],
			},
			300,
			"UTC",
			new Date("2026-10-17T23:30:00Z"),
		),
	).toBe(3600);
});

const modes = Object.values(DeviceDisplayMode);
const overnight = {
	sleep_mode_enabled: true,
	sleep_start_time: 23 * 60,
	sleep_end_time: 7 * 60,
};

test.each(
	modes,
)("%s sleeps until quiet-hours end without advancing the playlist", async (mode) => {
	const { set, read } = fakeConnection([
		{ screen_id: "news", duration: 60, order_index: 1 },
	]);
	const visit = await recordDisplayVisit(
		device({
			...overnight,
			display_mode: mode,
			playlist_id: "p1",
			current_playlist_index: 0,
			refresh_schedule: { default_refresh_rate: 30, time_ranges: [] },
		}),
		headers,
		new Date("2026-10-22T23:30:00Z"),
		{ restartPlaylist: true },
	);
	expect(visit).toEqual({
		quietHours: true,
		playlistItem: null,
		playlistItems: [],
		refreshRate: 27000,
	});
	expect(set.mock.calls[0][0]).toMatchObject({
		next_expected_update: "2026-10-23T07:00:00.000Z",
		last_refresh_duration: 27000,
		battery_voltage: 3.9,
	});
	expect(set.mock.calls[0][0]).not.toHaveProperty("current_playlist_index");
	expect(read).not.toHaveBeenCalled();
});

test.each(
	modes,
)("%s caps long daytime intervals at quiet-hours start", async (mode) => {
	fakeConnection([{ screen_id: "news", duration: 86400, order_index: 1 }]);
	const visit = await recordDisplayVisit(
		device({
			...overnight,
			display_mode: mode,
			playlist_id: "p1",
			refresh_schedule: { default_refresh_rate: 86400, time_ranges: [] },
		}),
		headers,
		new Date("2026-10-22T22:55:00Z"),
	);
	expect(visit.quietHours).toBe(false);
	expect(visit.refreshRate).toBe(300);
});

test("playlist resumes from its saved position exactly at quiet-hours end", async () => {
	const { set } = fakeConnection([
		{ screen_id: "weather", duration: 120, order_index: 0 },
		{ screen_id: "news", duration: 600, order_index: 3 },
	]);
	const visit = await recordDisplayVisit(
		device({
			...overnight,
			display_mode: DeviceDisplayMode.PLAYLIST,
			playlist_id: "p1",
			current_playlist_index: 0,
		}),
		headers,
		new Date("2026-10-23T07:00:00Z"),
	);
	expect(visit.quietHours).toBe(false);
	expect(visit.playlistItem?.screen_id).toBe("news");
	expect(visit.refreshRate).toBe(600);
	expect(set.mock.calls[0][0].current_playlist_index).toBe(3);
});

test("quiet-hours sleep is not truncated to 24 hours on a fall-back day", async () => {
	fakeConnection();
	const visit = await recordDisplayVisit(
		device({
			...overnight,
			timezone: "America/New_York",
			sleep_start_time: 3 * 60,
			sleep_end_time: 179,
		}),
		headers,
		new Date("2026-10-31T07:00:00Z"),
	);
	expect(visit.refreshRate).toBe(89940);
});
