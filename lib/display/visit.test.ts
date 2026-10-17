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
	const conn = {
		selectFrom: () => ({
			selectAll: () => ({
				where: () => ({
					orderBy: () => ({ execute: async () => playlistRows }),
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
	return { set, update };
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
		playlistItem: null,
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
