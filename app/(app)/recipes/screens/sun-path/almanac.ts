import { solarPosition } from "@/lib/recipes/astro/sun";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const STEP_MS = 5 * 60_000;
/** Upper limb on the horizon, with standard refraction. */
const HORIZON = -0.833;
/** Earth's axial tilt: the sun only stands overhead between these latitudes. */
const TROPIC = 23.44;

export type SkyPoint = { elevation: number; azimuth: number };
type Sample = SkyPoint & { ms: number };

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffset(instant: number, timeZone: string): number {
	let format = offsetFormatters.get(timeZone);
	if (!format) {
		format = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
		});
		offsetFormatters.set(timeZone, format);
	}
	const part = Object.fromEntries(
		format
			.formatToParts(new Date(instant))
			.map((p) => [p.type, Number(p.value)]),
	);
	const asUtc = Date.UTC(
		part.year,
		part.month - 1,
		part.day,
		part.hour,
		part.minute,
		part.second,
	);
	return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Instant a local `YYYY-MM-DD` begins in `timeZone`, settled across DST changes. */
export function localMidnight(date: string, timeZone: string): number {
	const guess = Date.parse(`${date}T00:00:00Z`);
	return guess - zoneOffset(guess - zoneOffset(guess, timeZone), timeZone);
}

export function shiftDate(date: string, days: number): string {
	return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS)
		.toISOString()
		.slice(0, 10);
}

function sampleDay(
	date: string,
	timeZone: string,
	latitude: number,
	longitude: number,
): Sample[] {
	const start = localMidnight(date, timeZone);
	const end = localMidnight(shiftDate(date, 1), timeZone);
	const samples: Sample[] = [];
	for (let ms = start; ms <= end; ms += STEP_MS)
		samples.push({ ms, ...solarPosition(ms, latitude, longitude) });
	return samples;
}

/** Linear crossing of the horizon between two samples. */
function crossing(before: Sample, after: Sample): number {
	const ratio =
		(HORIZON - before.elevation) / (after.elevation - before.elevation);
	return before.ms + ratio * (after.ms - before.ms);
}

function events(samples: Sample[]) {
	let rise: number | null = null;
	let set: number | null = null;
	let peak = 0;
	for (let i = 1; i < samples.length; i++) {
		const [a, b] = [samples[i - 1], samples[i]];
		if (a.elevation < HORIZON && b.elevation >= HORIZON)
			rise ??= crossing(a, b);
		if (a.elevation >= HORIZON && b.elevation < HORIZON) set = crossing(a, b);
		if (b.elevation > samples[peak].elevation) peak = i;
	}
	// The elevation curve is a parabola near its top: refine noon between samples.
	const [l, m, r] = [peak - 1, peak, peak + 1].map(
		(i) => samples[Math.max(0, Math.min(samples.length - 1, i))].elevation,
	);
	const curvature = l - 2 * m + r;
	const shift =
		curvature === 0
			? 0
			: Math.max(-1, Math.min(1, (0.5 * (l - r)) / curvature));
	const noon = samples[peak].ms + shift * STEP_MS;
	const noonElevation = samples[peak].elevation;
	const dayLength =
		rise !== null && set !== null && set > rise
			? set - rise
			: rise === null && set === null
				? noonElevation > HORIZON
					? DAY_MS
					: 0
				: rise !== null
					? samples[samples.length - 1].ms - rise
					: (set as number) - samples[0].ms;
	return { rise, set, noon, noonElevation, dayLength };
}

/** Visible arc of the sun, as runs of points above the horizon. */
function arcs(samples: Sample[]): SkyPoint[][] {
	const runs: SkyPoint[][] = [];
	let run: SkyPoint[] = [];
	for (const sample of samples) {
		if (sample.elevation >= HORIZON)
			run.push({ elevation: sample.elevation, azimuth: sample.azimuth });
		else if (run.length) {
			runs.push(run);
			run = [];
		}
	}
	if (run.length) runs.push(run);
	return runs.filter((r) => r.length > 1);
}

/**
 * Days of the year when the noon sun passes straight overhead and upright
 * objects cast no shadow. Only exists inside the tropics.
 */
export function zeroShadowDays(
	year: number,
	latitude: number,
	longitude: number,
): string[] {
	if (Math.abs(latitude) > TROPIC) return [];
	// Declination at local solar noon is close enough to pick the day.
	const gap = (day: number) =>
		solarPosition(
			Date.UTC(year, 0, 1 + day, 12) - (longitude / 15) * HOUR_MS,
			latitude,
			longitude,
		).declination - latitude;
	const days: string[] = [];
	const length =
		new Date(Date.UTC(year, 11, 31)).getUTCDate() === 31 ? 366 : 365;
	for (let day = 1; day < length; day++) {
		const [before, after] = [gap(day - 1), gap(day)];
		if (Math.sign(before) !== Math.sign(after))
			days.push(
				new Date(
					Date.UTC(
						year,
						0,
						1 + (Math.abs(before) < Math.abs(after) ? day - 1 : day),
					),
				)
					.toISOString()
					.slice(0, 10),
			);
	}
	return days;
}

export function sunAlmanac({
	date,
	timeZone,
	latitude,
	longitude,
	now,
}: {
	date: string;
	timeZone: string;
	latitude: number;
	longitude: number;
	now: number;
}) {
	const samples = sampleDay(date, timeZone, latitude, longitude);
	const today = events(samples);
	const yesterday = events(
		sampleDay(shiftDate(date, -1), timeZone, latitude, longitude),
	);
	const year = Number(date.slice(0, 4));
	const solstice = (monthDay: string) =>
		arcs(sampleDay(`${year}-${monthDay}`, timeZone, latitude, longitude));

	// Bead every whole local hour the sun is up; offsets are read per hour for DST days.
	const hours = samples.slice(0, -1).flatMap((sample) => {
		const local = sample.ms + zoneOffset(sample.ms, timeZone);
		return local % HOUR_MS === 0 && sample.elevation > 0
			? [{ ...sample, hour: Math.round((local % DAY_MS) / HOUR_MS) % 24 }]
			: [];
	});

	const start = samples[0].ms;
	const end = samples[samples.length - 1].ms;
	const live = now >= start && now < end;
	const current = live ? solarPosition(now, latitude, longitude) : null;
	const up = current !== null && current.elevation > HORIZON;
	let nextRise: number | null = null;
	if (live && !up)
		nextRise =
			today.rise !== null && now < today.rise
				? today.rise
				: events(sampleDay(shiftDate(date, 1), timeZone, latitude, longitude))
						.rise;

	return {
		...today,
		dayLengthChange: today.dayLength - yesterday.dayLength,
		path: arcs(samples),
		hours,
		solstices: [solstice("06-21"), solstice("12-21")],
		now: current && up ? current : null,
		/** Shadow length as a multiple of the object's height. */
		shadow:
			current && current.elevation > 0.5
				? 1 / Math.tan((current.elevation * Math.PI) / 180)
				: null,
		nextRise,
		live,
		zeroShadow: zeroShadowDays(year, latitude, longitude),
	};
}

export type SunAlmanac = ReturnType<typeof sunAlmanac>;
