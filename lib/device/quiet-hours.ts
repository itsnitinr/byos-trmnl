import type { Device } from "@/lib/types";

type QuietHoursSettings = Pick<
	Device,
	"sleep_mode_enabled" | "sleep_start_time" | "sleep_end_time" | "timezone"
>;

/**
 * Start inclusive, end exclusive; equal or incomplete times disable the window.
 * Walk real minutes rather than subtracting local clock times: DST can skip or
 * repeat an hour. A skipped boundary takes effect at the clock jump, and a
 * repeated boundary takes effect at its first occurrence after `at`.
 */
export function quietHoursAt(
	device: QuietHoursSettings,
	at = new Date(),
): { active: boolean; secondsUntilBoundary: number } | null {
	const start = device.sleep_start_time;
	const end = device.sleep_end_time;
	if (
		!device.sleep_mode_enabled ||
		start == null ||
		end == null ||
		!Number.isInteger(start) ||
		!Number.isInteger(end) ||
		start < 0 ||
		start >= 1440 ||
		end < 0 ||
		end >= 1440 ||
		start === end ||
		!Number.isFinite(at.getTime())
	) {
		return null;
	}
	const formatter = new Intl.DateTimeFormat("en-GB", {
		timeZone: device.timezone || "UTC",
		hourCycle: "h23",
		hour: "2-digit",
		minute: "2-digit",
	});
	const isQuiet = (time: number) => {
		const parts = formatter.formatToParts(time);
		const hour = Number(parts.find((part) => part.type === "hour")?.value);
		const minute = Number(parts.find((part) => part.type === "minute")?.value);
		const local = hour * 60 + minute;
		return start < end
			? local >= start && local < end
			: local >= start || local < end;
	};
	const now = at.getTime();
	const active = isQuiet(now);
	// Bounded search includes a 25-hour fall-back day. Reuse one formatter so
	// the hot path does not construct an Intl object for every minute.
	const nextMinute = Math.floor(now / 60_000) * 60_000 + 60_000;
	for (
		let boundary = nextMinute;
		boundary <= now + 26 * 3600_000;
		boundary += 60_000
	) {
		if (isQuiet(boundary) !== active) {
			return {
				active,
				secondsUntilBoundary: Math.ceil((boundary - now) / 1000),
			};
		}
	}
	return null;
}
