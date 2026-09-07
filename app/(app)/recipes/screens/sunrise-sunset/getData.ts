import { recipeFetch as fetch } from "@/lib/recipes/runtime/fetch-context";
import { recipeSourceCache as unstable_cache } from "@/lib/recipes/runtime/source-cache";

// The whole screen moves with the clock, so it is never prerendered.
export const dynamic = "force-dynamic";

export interface SunriseSunsetData {
	locationName: string;
	/** IANA zone every printed time is read in. */
	timezone: string;
	/** Clock times, or "None" on a day the event does not happen at all. */
	sunrise: string;
	sunset: string;
	dawn: string;
	solarNoon: string;
	dusk: string;
	/** Sun elevation in degrees, sampled evenly across the charted window. */
	samples: number[];
	/** Where dawn, dusk and the current moment sit in that window, 0 to 1. */
	dawnFraction: number | null;
	duskFraction: number | null;
	nowFraction: number;
	error?: string;
}

type SunriseSunsetParams = {
	location?: string;
	latitude?: number;
	longitude?: number;
	timezone?: string;
	timeFormat?: string;
};

interface GeocodingResponse {
	results?: Array<{
		name: string;
		country: string;
		latitude: number;
		longitude: number;
		timezone?: string;
	}>;
}

/**
 * Elevation of the sun's upper limb at sunrise and sunset: half a degree of
 * disc plus about a third of a degree of atmospheric refraction, which is why
 * the sun is already visible while its centre is still below the horizon.
 */
const SUNRISE_ELEVATION = -0.833;
/** Civil twilight. Bright enough to read outside without a lamp. */
const CIVIL_ELEVATION = -6;

/** Points on the drawn curve — one every five minutes of the day. */
const SAMPLE_COUNT = 289;
/** Resolution the crossing scan runs at. Crossings are then interpolated. */
const SCAN_STEP_MS = 60_000;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Used when neither a location name nor coordinates have been configured. */
const FALLBACK_LOCATION = "Bengaluru";
const FALLBACK_TIMEZONE = "Asia/Kolkata";

/**
 * Printed in place of a time inside the polar circles, where a day can hold no
 * sunrise, no sunset and no twilight at all. Which of the two it is — sun up
 * for the whole window or down for it — is what the arc itself shows.
 */
const NO_EVENT = "None";

const DEG = Math.PI / 180;

/**
 * Sun declination (degrees) and the equation of time (minutes) for an instant,
 * from the NOAA solar position equations. Good to well under a minute of
 * sunrise time for any year this screen will plausibly run in.
 */
function solarCoordinates(ms: number): {
	declination: number;
	equationOfTime: number;
} {
	// Julian centuries since J2000.0.
	const t = (ms / DAY_MS + 2440587.5 - 2451545) / 36525;

	const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
	const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
	const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

	const center =
		Math.sin(meanAnomaly * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
		Math.sin(2 * meanAnomaly * DEG) * (0.019993 - 0.000101 * t) +
		Math.sin(3 * meanAnomaly * DEG) * 0.000289;

	// Apparent longitude: true longitude corrected for nutation and aberration.
	const apparentLongitude =
		meanLongitude +
		center -
		0.00569 -
		0.00478 * Math.sin((125.04 - 1934.136 * t) * DEG);

	const meanObliquity =
		23 +
		(26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
	const obliquity =
		meanObliquity + 0.00256 * Math.cos((125.04 - 1934.136 * t) * DEG);

	const declination =
		Math.asin(Math.sin(obliquity * DEG) * Math.sin(apparentLongitude * DEG)) /
		DEG;

	const y = Math.tan((obliquity / 2) * DEG) ** 2;
	const equationOfTime =
		(4 *
			(y * Math.sin(2 * meanLongitude * DEG) -
				2 * eccentricity * Math.sin(meanAnomaly * DEG) +
				4 *
					eccentricity *
					y *
					Math.sin(meanAnomaly * DEG) *
					Math.cos(2 * meanLongitude * DEG) -
				0.5 * y * y * Math.sin(4 * meanLongitude * DEG) -
				1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * DEG))) /
		DEG;

	return { declination, equationOfTime };
}

/** Geometric elevation of the sun above the horizon, in degrees. */
export function solarElevation(
	ms: number,
	latitude: number,
	longitude: number,
): number {
	const { declination, equationOfTime } = solarCoordinates(ms);

	// True solar time: UTC clock time carried to the meridian the observer
	// stands on (4 minutes per degree) and corrected by the equation of time.
	const utcMinutes = (((ms / 60_000) % 1440) + 1440) % 1440;
	const trueSolarTime =
		(((utcMinutes + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440;
	const hourAngle = trueSolarTime / 4 - 180;

	const cosZenith =
		Math.sin(latitude * DEG) * Math.sin(declination * DEG) +
		Math.cos(latitude * DEG) *
			Math.cos(declination * DEG) *
			Math.cos(hourAngle * DEG);

	return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / DEG;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(instant));
	const value = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value);

	const asUtc = Date.UTC(
		value("year"),
		value("month") - 1,
		value("day"),
		value("hour"),
		value("minute"),
		value("second"),
	);
	return asUtc - Math.floor(instant / 1000) * 1000;
}

function zonedDate(
	instant: number,
	timeZone: string,
): { year: number; month: number; day: number } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(instant));
	const value = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value);
	return { year: value("year"), month: value("month"), day: value("day") };
}

/**
 * Instant at which the given local date starts in `timeZone`. The offset has to
 * be read at the answer rather than at the guess, so it is applied twice: once
 * to land in the right day, once to settle a DST change inside it.
 */
function zonedMidnight(
	timeZone: string,
	date: { year: number; month: number; day: number },
): number {
	const guess = Date.UTC(date.year, date.month - 1, date.day);
	const first = guess - zoneOffsetMs(guess, timeZone);
	return guess - zoneOffsetMs(first, timeZone);
}

function safeTimezone(value: string | undefined, fallback: string): string {
	const timezone = value?.trim();
	if (!timezone) return fallback;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
		return timezone;
	} catch {
		return fallback;
	}
}

function formatClock(
	instant: number | null,
	timeZone: string,
	hour12: boolean,
): string {
	if (instant === null) return NO_EVENT;
	// Intl truncates to the minute; a crossing at 06:47:50 reads better as 06:48.
	const rounded = Math.round(instant / 60_000) * 60_000;
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: hour12 ? "h12" : "h23",
		hour: hour12 ? "numeric" : "2-digit",
		minute: "2-digit",
	}).format(new Date(rounded));
}

/** Instant at which a straight line between two scan samples crosses `level`. */
function crossingInstant(
	before: { ms: number; elevation: number },
	after: { ms: number; elevation: number },
	level: number,
): number {
	const span = after.elevation - before.elevation;
	if (span === 0) return before.ms;
	const ratio = (level - before.elevation) / span;
	return before.ms + ratio * (after.ms - before.ms);
}

type Crossings = { rise: number | null; set: number | null };

/**
 * Scans a window minute by minute and returns when the sun first climbs past
 * `level` and last drops back below it. Both are null on a day that never
 * crosses — a polar summer or winter, or a twilight that never ends.
 */
function findCrossings(
	from: number,
	to: number,
	latitude: number,
	longitude: number,
	level: number,
): Crossings {
	let rise: number | null = null;
	let set: number | null = null;
	let previous = {
		ms: from,
		elevation: solarElevation(from, latitude, longitude),
	};

	for (let ms = from + SCAN_STEP_MS; ms <= to; ms += SCAN_STEP_MS) {
		const current = { ms, elevation: solarElevation(ms, latitude, longitude) };
		if (previous.elevation < level && current.elevation >= level) {
			rise ??= crossingInstant(previous, current, level);
		} else if (previous.elevation >= level && current.elevation < level) {
			set = crossingInstant(previous, current, level);
		}
		previous = current;
	}

	return { rise, set };
}

/** Instant of the day's highest sun, refined between the minute samples. */
function findSolarNoon(
	from: number,
	to: number,
	latitude: number,
	longitude: number,
): number {
	let best = from;
	let bestElevation = Number.NEGATIVE_INFINITY;
	for (let ms = from; ms <= to; ms += SCAN_STEP_MS) {
		const elevation = solarElevation(ms, latitude, longitude);
		if (elevation > bestElevation) {
			bestElevation = elevation;
			best = ms;
		}
	}

	// The elevation curve is locally a parabola, so three samples around the
	// peak place it to the second rather than to the scan step.
	const before = solarElevation(best - SCAN_STEP_MS, latitude, longitude);
	const after = solarElevation(best + SCAN_STEP_MS, latitude, longitude);
	const curvature = before - 2 * bestElevation + after;
	if (curvature === 0) return best;
	const shift = (0.5 * (before - after)) / curvature;
	return best + Math.max(-1, Math.min(1, shift)) * SCAN_STEP_MS;
}

function fractionOf(instant: number | null, from: number, to: number) {
	if (instant === null) return null;
	const fraction = (instant - from) / (to - from);
	return fraction >= 0 && fraction <= 1 ? fraction : null;
}

/**
 * Builds the day around solar noon rather than around midnight, so the arc sits
 * centred in the frame and the window holds exactly the one sunrise and sunset
 * the screen prints.
 */
function buildSunDay({
	now,
	latitude,
	longitude,
	timezone,
	locationName,
	hour12,
}: {
	now: number;
	latitude: number;
	longitude: number;
	timezone: string;
	locationName: string;
	hour12: boolean;
}): SunriseSunsetData {
	const today = zonedDate(now, timezone);
	const dayStart = zonedMidnight(timezone, today);
	// 36 hours after local midnight is always midday of the next local date,
	// whatever the day's length did across a DST change.
	const dayEnd = zonedMidnight(
		timezone,
		zonedDate(dayStart + 36 * HOUR_MS, timezone),
	);

	const solarNoon = findSolarNoon(dayStart, dayEnd, latitude, longitude);

	// Shifted, not stretched, when the current moment falls outside: in the hour
	// either side of local midnight the window slides to keep the sun on screen
	// while staying a full 24 hours long.
	let windowStart = solarNoon - DAY_MS / 2;
	const margin = 10 * 60_000;
	if (now < windowStart + margin) windowStart = now - margin;
	if (now > windowStart + DAY_MS - margin) windowStart = now - DAY_MS + margin;
	const windowEnd = windowStart + DAY_MS;

	const sun = findCrossings(
		windowStart,
		windowEnd,
		latitude,
		longitude,
		SUNRISE_ELEVATION,
	);
	const civil = findCrossings(
		windowStart,
		windowEnd,
		latitude,
		longitude,
		CIVIL_ELEVATION,
	);

	const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
		const ms = windowStart + (DAY_MS * index) / (SAMPLE_COUNT - 1);
		return Math.round(solarElevation(ms, latitude, longitude) * 100) / 100;
	});

	return {
		locationName,
		timezone,
		sunrise: formatClock(sun.rise, timezone, hour12),
		sunset: formatClock(sun.set, timezone, hour12),
		dawn: formatClock(civil.rise, timezone, hour12),
		solarNoon: formatClock(solarNoon, timezone, hour12),
		dusk: formatClock(civil.set, timezone, hour12),
		samples,
		dawnFraction: fractionOf(civil.rise, windowStart, windowEnd),
		duskFraction: fractionOf(civil.set, windowStart, windowEnd),
		nowFraction: Math.max(
			0,
			Math.min(1, (now - windowStart) / (windowEnd - windowStart)),
		),
	};
}

/**
 * fetch() rejects during prerendering, which is expected rather than a fault.
 */
function isPrerenderRejection(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("prerender") ||
		message.includes("HANGING_PROMISE_REJECTION") ||
		message.includes("prerender is complete")
	);
}

async function geocodeLocation(query: string): Promise<{
	latitude: number;
	longitude: number;
	locationName: string;
	timezone?: string;
} | null> {
	try {
		const response = await fetch(
			`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
			{ headers: { Accept: "application/json" } },
		);

		if (!response.ok) {
			throw new Error(
				`Geocoding API responded with status: ${response.status}`,
			);
		}

		const data: GeocodingResponse = await response.json();
		const result = data.results?.[0];
		if (!result) return null;

		return {
			latitude: result.latitude,
			longitude: result.longitude,
			locationName: result.name,
			timezone: result.timezone,
		};
	} catch (error) {
		if (isPrerenderRejection(error)) return null;
		console.error("Error geocoding location:", error);
		return null;
	}
}

/** A place does not move, so its coordinates are worth keeping for a day. */
function cachedGeocode(query: string) {
	return unstable_cache(
		() => geocodeLocation(query),
		["sunrise-sunset-geocode", query.toLowerCase()],
		{ tags: ["sunrise-sunset", "open-meteo"], revalidate: 86400 },
	)();
}

/** Labels a reading taken from raw coordinates, e.g. "52.00°N, 5.79°E". */
function formatCoordinates(latitude: number, longitude: number): string {
	const ns = `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? "N" : "S"}`;
	const ew = `${Math.abs(longitude).toFixed(2)}°${longitude >= 0 ? "E" : "W"}`;
	return `${ns}, ${ew}`;
}

function finiteNumber(value: unknown): number | undefined {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed)
		? parsed
		: undefined;
}

function emptyData(
	locationName: string,
	timezone: string,
	error: string,
): SunriseSunsetData {
	return {
		locationName,
		timezone,
		sunrise: NO_EVENT,
		sunset: NO_EVENT,
		dawn: NO_EVENT,
		solarNoon: NO_EVENT,
		dusk: NO_EVENT,
		samples: [],
		dawnFraction: null,
		duskFraction: null,
		nowFraction: 0,
		error,
	};
}

export default async function getData(
	params?: SunriseSunsetParams,
): Promise<SunriseSunsetData> {
	const hour12 = params?.timeFormat?.trim().startsWith("12") ?? false;
	const requestedName =
		typeof params?.location === "string" && params.location.trim() !== ""
			? params.location.trim()
			: undefined;

	const latitude = finiteNumber(params?.latitude);
	const longitude = finiteNumber(params?.longitude);
	// A pair of literal zeroes is the unset default rather than a request for
	// the Gulf of Guinea, so it falls through to the location name.
	const hasCoordinates =
		latitude !== undefined &&
		longitude !== undefined &&
		(latitude !== 0 || longitude !== 0);

	const resolved = hasCoordinates
		? {
				latitude: latitude as number,
				longitude: longitude as number,
				locationName:
					requestedName ??
					formatCoordinates(latitude as number, longitude as number),
				timezone: undefined as string | undefined,
			}
		: await cachedGeocode(requestedName ?? FALLBACK_LOCATION);

	if (!resolved) {
		const name = requestedName ?? FALLBACK_LOCATION;
		return emptyData(
			name,
			safeTimezone(params?.timezone, FALLBACK_TIMEZONE),
			`Could not find "${name}"`,
		);
	}

	// An explicit timezone wins; otherwise the zone the place is actually in.
	const timezone = safeTimezone(
		params?.timezone,
		safeTimezone(resolved.timezone, FALLBACK_TIMEZONE),
	);

	try {
		return buildSunDay({
			now: Date.now(),
			latitude: resolved.latitude,
			longitude: resolved.longitude,
			timezone,
			locationName: resolved.locationName,
			hour12,
		});
	} catch (error) {
		console.error(
			`Error computing sun times for ${resolved.locationName}:`,
			error,
		);
		return emptyData(resolved.locationName, timezone, "Sun times unavailable");
	}
}
