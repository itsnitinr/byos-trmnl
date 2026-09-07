import { DISPLAY_FALLBACK_REFRESH_SECONDS } from "@/lib/device/defaults";
import type { PlaylistItem } from "@/lib/types";

const weekdays = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
];

export function localScheduleTime(at: Date, timezone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hourCycle: "h23",
		hour: "2-digit",
		minute: "2-digit",
		weekday: "long",
	}).formatToParts(at);
	const value = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "";
	return {
		time: `${value("hour")}:${value("minute")}`,
		day: value("weekday").toLowerCase(),
	};
}

export function isTimeInRange(
	time: string,
	start: string,
	end: string,
): boolean {
	const t = time.slice(0, 5),
		s = start.slice(0, 5),
		e = end.slice(0, 5);
	return s > e ? t >= s || t < e : t >= s && t < e;
}

export function playlistEligibility(
	item: PlaylistItem,
	at: Date,
	timezone: string,
): string | null {
	const { time, day } = localScheduleTime(at, timezone);
	const start = item.start_time?.slice(0, 5),
		end = item.end_time?.slice(0, 5);
	if (start && end && !isTimeInRange(time, start, end))
		return "Outside time window";
	// The after-midnight part of an overnight window belongs to its starting day.
	const scheduledDay =
		start && end && start > end && time < end
			? weekdays[(weekdays.indexOf(day) + 6) % 7]
			: day;
	if (item.days_of_week && !item.days_of_week.includes(scheduledDay))
		return "Outside selected days";
	return null;
}

export function selectPlaylistItem(
	items: PlaylistItem[],
	currentOrderIndex: number,
	at: Date,
	timezone: string,
): PlaylistItem | null {
	const sorted = [...items].sort((a, b) => a.order_index - b.order_index);
	// Persisted values are order_index, not offsets into an array. Deleted/reordered items may leave gaps.
	let next = sorted.findIndex((item) => item.order_index > currentOrderIndex);
	if (next < 0) next = 0;
	for (let offset = 0; offset < sorted.length; offset++) {
		const item = sorted[(next + offset) % sorted.length];
		if (!playlistEligibility(item, at, timezone)) return item;
	}
	return null;
}

export function simulatePlaylist(
	items: PlaylistItem[],
	at: Date,
	timezone: string,
	currentOrderIndex = -1,
	count = 12,
	fallbackSeconds = DISPLAY_FALLBACK_REFRESH_SECONDS,
) {
	if (!Number.isFinite(at.getTime()))
		throw new Error(
			"Enter a valid ISO date and time, including its UTC offset.",
		);
	localScheduleTime(at, timezone); // Validate the timezone, including for an empty playlist.
	let wake = at.getTime(),
		index = currentOrderIndex;
	return Array.from({ length: Math.min(100, Math.max(0, count)) }, () => {
		const now = new Date(wake);
		const item = selectPlaylistItem(items, index, now, timezone);
		const seconds = item ? Math.max(1, item.duration) : fallbackSeconds;
		const step = {
			at: now.toISOString(),
			item,
			seconds,
			skipped: items
				.filter((entry) => playlistEligibility(entry, now, timezone))
				.map((entry) => ({
					screen: entry.screen_id,
					reason: playlistEligibility(entry, now, timezone),
				})),
		};
		if (item) index = item.order_index;
		wake += seconds * 1000;
		return step;
	});
}
