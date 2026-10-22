import { quietHoursAt } from "./quiet-hours";

const settings = {
	sleep_mode_enabled: true,
	sleep_start_time: 23 * 60,
	sleep_end_time: 7 * 60,
	timezone: "UTC",
};

test.each([
	["2026-10-22T22:59:30Z", false, 30],
	["2026-10-22T23:00:00Z", true, 28800],
	["2026-10-23T02:00:00Z", true, 18000],
	["2026-10-23T06:59:59.100Z", true, 1],
	["2026-10-23T07:00:00Z", false, 57600],
] as const)("overnight boundary at %s", (iso, active, secondsUntilBoundary) => {
	expect(quietHoursAt(settings, new Date(iso))).toEqual({
		active,
		secondsUntilBoundary,
	});
});

test("same-day windows use the device timezone, including fractional UTC offsets", () => {
	expect(
		quietHoursAt(
			{
				...settings,
				timezone: "Asia/Kolkata",
				sleep_start_time: 12 * 60,
				sleep_end_time: 14 * 60,
			},
			new Date("2026-10-22T07:00:00Z"),
		),
	).toEqual({ active: true, secondsUntilBoundary: 5400 });
});

test.each([
	["2026-03-08T04:00:00Z", 25200], // 23:00 -> 07:00, spring forward
	["2026-11-01T03:00:00Z", 32400], // 23:00 -> 07:00, fall back
] as const)("DST changes actual sleep duration at %s", (iso, secondsUntilBoundary) => {
	expect(
		quietHoursAt({ ...settings, timezone: "America/New_York" }, new Date(iso)),
	).toEqual({ active: true, secondsUntilBoundary });
});

test("a skipped end time wakes at the spring clock jump", () => {
	expect(
		quietHoursAt(
			{ ...settings, timezone: "America/New_York", sleep_end_time: 150 },
			new Date("2026-03-08T06:00:00Z"),
		),
	).toEqual({ active: true, secondsUntilBoundary: 3600 });
});

test("a repeated end time wakes at its next occurrence", () => {
	expect(
		quietHoursAt(
			{ ...settings, timezone: "America/New_York", sleep_end_time: 90 },
			new Date("2026-11-01T04:00:00Z"),
		),
	).toEqual({ active: true, secondsUntilBoundary: 5400 });
});

test.each([
	{ sleep_mode_enabled: false },
	{ sleep_start_time: null },
	{ sleep_end_time: null },
	{ sleep_end_time: 23 * 60 },
	{ sleep_start_time: -1 },
	{ sleep_end_time: 1440 },
	{ sleep_start_time: 0.5 },
])("disabled or unusable windows do not change refreshes: %j", (override) => {
	expect(quietHoursAt({ ...settings, ...override })).toBeNull();
});
