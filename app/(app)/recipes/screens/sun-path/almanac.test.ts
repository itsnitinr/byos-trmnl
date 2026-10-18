import { solarPosition } from "@/lib/recipes/astro/sun";
import { localMidnight, sunAlmanac, zeroShadowDays } from "./almanac";
import { drawSunPlate } from "./plate";

const bengaluru = {
	timeZone: "Asia/Kolkata",
	latitude: 12.9716,
	longitude: 77.5946,
};
const tromso = { timeZone: "Europe/Oslo", latitude: 69.65, longitude: 18.96 };
const minutes = (ms: number | null) => (ms === null ? NaN : ms / 60_000);
const at = (iso: string) => Date.parse(iso);

test("azimuth is measured clockwise from north", () => {
	// Equinox at the equator: due east in the morning, overhead at noon, due west later.
	const morning = solarPosition(at("2026-03-20T06:00:00Z"), 0, 0);
	expect(morning.azimuth).toBeGreaterThan(85);
	expect(morning.azimuth).toBeLessThan(95);
	expect(
		solarPosition(at("2026-03-20T18:00:00Z") - 3_600_000, 0, 0).azimuth,
	).toBeGreaterThan(265);
	// Northern mid-latitudes see the noon sun due south.
	const berlin = {
		timeZone: "Europe/Berlin",
		latitude: 52.52,
		longitude: 13.405,
	};
	const { noon } = sunAlmanac({ ...berlin, date: "2026-10-17", now: 0 });
	expect(
		solarPosition(noon, berlin.latitude, berlin.longitude).azimuth,
	).toBeCloseTo(180, 0);
});

test("Bengaluru day matches published sunrise, sunset and zero-shadow days", () => {
	const day = sunAlmanac({
		...bengaluru,
		date: "2026-10-17",
		now: at("2026-10-17T05:30:00Z"),
	});
	// Published: sunrise 06:10, sunset 17:59–18:00 IST.
	expect(
		Math.abs(minutes(day.rise) - minutes(at("2026-10-17T06:10:00+05:30"))),
	).toBeLessThan(2);
	expect(
		Math.abs(minutes(day.set) - minutes(at("2026-10-17T18:00:00+05:30"))),
	).toBeLessThan(2);
	expect(day.noonElevation).toBeCloseTo(67.6, 0);
	// Days are shortening in October north of the equator.
	expect(day.dayLengthChange).toBeLessThan(0);
	expect(day.zeroShadow).toEqual(["2026-04-24", "2026-08-18"]);
	expect(day.hours.map((hour) => hour.hour)).toEqual([
		7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
	]);
	expect(day.live).toBe(true);
	expect(day.now?.elevation).toBeGreaterThan(55);
	expect(day.shadow).toBeLessThan(1);
});

test("zero-shadow days only exist inside the tropics", () => {
	expect(zeroShadowDays(2026, 52.52, 13.4)).toEqual([]);
	expect(zeroShadowDays(2026, -22.9, -43.2)).toHaveLength(2);
});

test("night shows the next sunrise and no sun on the plate", () => {
	const night = sunAlmanac({
		...bengaluru,
		date: "2026-10-17",
		now: at("2026-10-17T22:00:00+05:30"),
	});
	expect(night.live).toBe(true);
	expect(night.now).toBeNull();
	expect(night.shadow).toBeNull();
	const tomorrow = sunAlmanac({
		...bengaluru,
		date: "2026-10-18",
		now: 0,
	});
	expect(night.nextRise).toBe(tomorrow.rise);
	expect(drawSunPlate(400, night)).not.toContain('r="22"');
});

test("pinned dates draw the day without a live sun", () => {
	const pinned = sunAlmanac({
		...bengaluru,
		date: "2026-06-21",
		now: at("2026-10-17T05:30:00Z"),
	});
	expect(pinned.live).toBe(false);
	expect(pinned.now).toBeNull();
	const svg = drawSunPlate(380, pinned);
	expect(svg).not.toMatch(/NaN|Infinity/);
	expect(svg).toContain('r="6" fill="black"');
});

test("polar day and night", () => {
	const summer = sunAlmanac({ ...tromso, date: "2026-06-21", now: 0 });
	expect(summer.rise).toBeNull();
	expect(summer.dayLength).toBe(86_400_000);
	expect(summer.hours).toHaveLength(24);
	expect(summer.path).toHaveLength(1);
	const winter = sunAlmanac({ ...tromso, date: "2026-12-21", now: 0 });
	expect(winter.dayLength).toBe(0);
	expect(winter.path).toEqual([]);
	expect(winter.hours).toEqual([]);
	expect(drawSunPlate(300, winter)).not.toMatch(/NaN|Infinity/);
});

test("DST changeover days keep hour beads on the local clock", () => {
	const berlin = {
		timeZone: "Europe/Berlin",
		latitude: 52.52,
		longitude: 13.405,
	};
	expect(localMidnight("2026-10-25", "Europe/Berlin")).toBe(
		at("2026-10-24T22:00:00Z"),
	);
	const fallBack = sunAlmanac({ ...berlin, date: "2026-10-25", now: 0 });
	const hours = fallBack.hours.map((hour) => hour.hour);
	expect(new Set(hours).size).toBe(hours.length);
	expect(hours[0]).toBe(7);
	expect(hours.at(-1)).toBe(16);
});
