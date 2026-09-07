import type { PlaylistItem } from "@/lib/types";
import {
	localScheduleTime,
	playlistEligibility,
	selectPlaylistItem,
	simulatePlaylist,
} from "./schedule";

const item = (
	order: number,
	extra: Partial<PlaylistItem> = {},
): PlaylistItem => ({
	id: String(order),
	playlist_id: "p",
	screen_id: `screen-${order}`,
	duration: 900,
	start_time: null,
	end_time: null,
	days_of_week: null,
	order_index: order,
	created_at: null,
	...extra,
});
const monday = new Date("2026-09-07T12:00:00Z");
test("rotation handles gaps, deleted current items, wraparound and initial selection", () => {
	const items = [item(10), item(30), item(50)];
	for (const [current, expected] of [
		[-1, 10],
		[10, 30],
		[20, 30],
		[50, 10],
	])
		expect(selectPlaylistItem(items, current, monday, "UTC")?.order_index).toBe(
			expected,
		);
});
test("midnight is 00:00 and windows are half-open, including SQL time seconds", () => {
	expect(localScheduleTime(new Date("2026-09-08T00:00:00Z"), "UTC").time).toBe(
		"00:00",
	);
	const scheduled = item(0, { start_time: "12:00:00", end_time: "13:00:00" });
	expect(playlistEligibility(scheduled, monday, "UTC")).toBeNull();
	expect(
		playlistEligibility(scheduled, new Date("2026-09-07T13:00:00Z"), "UTC"),
	).toBe("Outside time window");
});
test("overnight windows belong to the selected starting weekday", () => {
	const scheduled = item(0, {
		start_time: "22:00",
		end_time: "02:00",
		days_of_week: ["monday"],
	});
	expect(
		playlistEligibility(scheduled, new Date("2026-09-07T23:00Z"), "UTC"),
	).toBeNull();
	expect(
		playlistEligibility(scheduled, new Date("2026-09-08T01:00Z"), "UTC"),
	).toBeNull();
	expect(
		playlistEligibility(scheduled, new Date("2026-09-07T01:00Z"), "UTC"),
	).toBe("Outside selected days");
});
test("simulation uses absolute elapsed durations across daylight saving transitions", () => {
	const steps = simulatePlaylist(
		[item(0, { duration: 3600 })],
		new Date("2026-11-01T05:30Z"),
		"America/New_York",
		-1,
		3,
	);
	expect(
		steps.map(
			(s) => localScheduleTime(new Date(s.at), "America/New_York").time,
		),
	).toEqual(["01:30", "01:30", "02:30"]);
});
test("simulation reports inactive reasons and progresses through the device fallback interval", () => {
	const steps = simulatePlaylist(
		[item(0, { start_time: "12:03", end_time: "13:00" })],
		monday,
		"UTC",
		-1,
		2,
	);
	expect(steps[0].item).toBeNull();
	expect(steps[0].skipped[0].reason).toBe("Outside time window");
	expect(steps[1].item?.id).toBe("0");
	expect(() => simulatePlaylist([], new Date("bad"), "UTC")).toThrow();
	expect(() => simulatePlaylist([], monday, "not-a-zone")).toThrow();
});
