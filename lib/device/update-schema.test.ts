import { normalizeRefreshSchedule } from "./defaults";
import { deviceUpdateSchema, isValidTimeZone } from "./update-schema";

const uuid = "4f6c2a1e-8a1b-4c5d-9e0f-123456789abc";

test("turns 'None' selections into NULL instead of an invalid UUID", () => {
	const result = deviceUpdateSchema.parse({
		id: 3,
		playlist_id: "",
		mixup_id: uuid,
		model: "",
		screen_orientation: "",
	});
	expect(result).toMatchObject({
		playlist_id: null,
		mixup_id: uuid,
		model: null,
		screen_orientation: null,
	});
});

test("stores refresh rates as numbers", () => {
	const result = deviceUpdateSchema.parse({
		id: 3,
		refresh_schedule: { default_refresh_rate: "900" },
	});
	expect(result.refresh_schedule).toEqual({
		default_refresh_rate: 900,
		time_ranges: [],
	});
});

test("rejects values the runtime cannot use", () => {
	for (const input of [
		{ id: 3, timezone: "Mars/Olympus" },
		{ id: 3, playlist_id: "not-a-uuid" },
		{ id: 3, screen_width: 99999 },
		{ id: 3, refresh_schedule: { default_refresh_rate: 0 } },
		{
			id: 3,
			refresh_schedule: {
				default_refresh_rate: 60,
				time_ranges: [
					{ start_time: "25:00", end_time: "07:00", refresh_rate: 60 },
				],
			},
		},
		{ id: 3, api_key: "has space in it" },
		{ id: 3, display_mode: "carousel" },
	]) {
		expect(deviceUpdateSchema.safeParse(input).success).toBe(false);
	}
});

test("validates IANA timezones", () => {
	expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
	expect(isValidTimeZone("Nowhere/Special")).toBe(false);
});

test("reads schedules saved with numeric strings", () => {
	expect(
		normalizeRefreshSchedule({
			default_refresh_rate: "900",
			time_ranges: [
				{ start_time: "00:00", end_time: "07:00", refresh_rate: "3600" },
				{ start_time: "", end_time: "07:00", refresh_rate: 60 },
			],
		}),
	).toEqual({
		default_refresh_rate: 900,
		time_ranges: [
			{ start_time: "00:00", end_time: "07:00", refresh_rate: 3600 },
		],
	});
	expect(normalizeRefreshSchedule({ default_refresh_rate: "soon" })).toBeNull();
});
