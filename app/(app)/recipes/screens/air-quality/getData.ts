import { unstable_cache } from "next/cache";
import { recipeFetch as fetch } from "@/lib/recipes/runtime/fetch-context";

// Live data — always fetch fresh.
export const dynamic = "force-dynamic";

export type AqiStandard = "us" | "european";
export type PollutantKey = "pm2_5" | "pm10";

export interface AirQualityGauge {
	key: PollutantKey;
	/** Display name, e.g. "PM 2.5". */
	label: string;
	/** Concentration in µg/m³. */
	value: number;
	/** Band the pollutant's own sub-index falls in, e.g. "Good". */
	category: string;
	/** Top of the dial. Chosen so the ticks stay round numbers. */
	scaleMax: number;
}

export interface AirQualitySample {
	/** Zone-local ISO timestamp from the API, e.g. "2026-05-23T05:00". */
	time: string;
	/** Concentration in µg/m³. */
	value: number;
}

export interface AirQualityData {
	locationName: string;
	/** Timestamp of the reading, e.g. "23 May 5:00AM". */
	updatedLabel: string;
	standard: AqiStandard;
	gauges: AirQualityGauge[];
	/** Hourly concentrations for the charted pollutant, past then forecast. */
	series: AirQualitySample[];
	/** Index in `series` of the hour the reading was taken. */
	nowIndex: number;
	/** Display name of the charted pollutant. */
	chartLabel: string;
	error?: string;
}

type AirQualityParams = {
	location?: string;
	latitude?: number;
	longitude?: number;
	standard?: string;
	pollutant?: string;
};

interface GeocodingResponse {
	results?: Array<{
		name: string;
		country: string;
		latitude: number;
		longitude: number;
	}>;
}

interface AirQualityResponse {
	timezone: string;
	current: Record<string, number | string>;
	hourly: {
		time: string[];
	} & Record<string, Array<number | null> | string[]>;
}

/** The two pollutants the screen dials, in display order. */
const GAUGES: Array<{ key: PollutantKey; label: string }> = [
	{ key: "pm2_5", label: "PM 2.5" },
	{ key: "pm10", label: "PM 10" },
];

export const UNIT = "µg/m³";

/** Hours of history charted before the current reading. */
const PAST_HOURS = 6;
/** Hours of forecast charted after it. */
const FORECAST_HOURS = 24;

/**
 * Dial ceilings. Each divides into seven equal steps, so the tick ring reads
 * 0/20/40/… rather than arbitrary fractions, and a smoke event can push the
 * dial onto a coarser scale instead of pinning it at full.
 */
const GAUGE_SCALES = [140, 280, 560, 1120];

/** US EPA breakpoints. Upper bound is inclusive. */
const US_CATEGORIES: Array<[number, string]> = [
	[50, "Good"],
	[100, "Moderate"],
	[150, "Sensitive"],
	[200, "Unhealthy"],
	[300, "Very Unhealthy"],
	[Number.POSITIVE_INFINITY, "Hazardous"],
];

/** European Environment Agency bands. */
const EU_CATEGORIES: Array<[number, string]> = [
	[20, "Good"],
	[40, "Fair"],
	[60, "Moderate"],
	[80, "Poor"],
	[100, "Very Poor"],
	[Number.POSITIVE_INFINITY, "Extreme"],
];

function categoryFor(aqi: number, standard: AqiStandard): string {
	const bands = standard === "european" ? EU_CATEGORIES : US_CATEGORIES;
	for (const [limit, label] of bands) {
		if (aqi <= limit) return label;
	}
	return bands[bands.length - 1][1];
}

function scaleFor(value: number): number {
	return (
		GAUGE_SCALES.find((scale) => value <= scale) ??
		GAUGE_SCALES[GAUGE_SCALES.length - 1]
	);
}

export function normalizeStandard(value?: string): AqiStandard {
	return value?.toLowerCase() === "european" ? "european" : "us";
}

export function normalizePollutant(value?: string): PollutantKey {
	const normalized = value?.toLowerCase().replace(/[\s.]/g, "");
	return normalized === "pm10" ? "pm10" : "pm2_5";
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/**
 * Formats the API's zone-local timestamp without going through Date, which
 * would reinterpret it in the server's timezone. "2026-05-23T05:09" is the
 * clock reading where the air was measured, so it is parsed as plain digits.
 */
function readingLabel(isoLocal: string): string {
	const month = MONTHS[Number(isoLocal.slice(5, 7)) - 1] ?? "";
	const day = Number(isoLocal.slice(8, 10));
	const hour = Number(isoLocal.slice(11, 13));
	const minute = isoLocal.slice(14, 16) || "00";
	const suffix = hour < 12 ? "AM" : "PM";
	const twelve = hour % 12 === 0 ? 12 : hour % 12;
	return `${day} ${month} ${twelve}:${minute}${suffix}`;
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
} | null> {
	try {
		const response = await fetch(
			`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
			{ headers: { Accept: "application/json" }, next: { revalidate: 0 } },
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
		};
	} catch (error) {
		if (isPrerenderRejection(error)) return null;
		console.error("Error geocoding location:", error);
		return null;
	}
}

function buildUrl(
	latitude: number,
	longitude: number,
	standard: AqiStandard,
): string {
	const prefix = standard === "european" ? "european_aqi" : "us_aqi";
	const concentrations = GAUGES.map((gauge) => gauge.key).join(",");
	const subIndices = GAUGES.map((gauge) => `${prefix}_${gauge.key}`).join(",");

	const search = new URLSearchParams({
		latitude: String(latitude),
		longitude: String(longitude),
		current: `${concentrations},${subIndices}`,
		hourly: concentrations,
		timezone: "auto",
		past_hours: String(PAST_HOURS),
		forecast_hours: String(FORECAST_HOURS),
	});

	return `https://air-quality-api.open-meteo.com/v1/air-quality?${search}`;
}

async function fetchAirQuality(
	latitude: number,
	longitude: number,
	locationName: string,
	standard: AqiStandard,
	pollutant: PollutantKey,
): Promise<AirQualityData> {
	const response = await fetch(buildUrl(latitude, longitude, standard), {
		headers: { Accept: "application/json" },
		next: { revalidate: 0 },
	});

	if (!response.ok) {
		throw new Error(
			`Open-Meteo air quality API responded with status: ${response.status}`,
		);
	}

	const data: AirQualityResponse = await response.json();
	const prefix = standard === "european" ? "european_aqi" : "us_aqi";
	const current = data.current;
	if (!current) {
		throw new Error("No current air quality reading available");
	}

	const gauges: AirQualityGauge[] = GAUGES.map((gauge) => {
		const value = Number(current[gauge.key]);
		const subIndex = Number(current[`${prefix}_${gauge.key}`]);
		return {
			key: gauge.key,
			label: gauge.label,
			value: Number.isFinite(value) ? Math.round(value * 10) / 10 : 0,
			category: Number.isFinite(subIndex)
				? categoryFor(subIndex, standard)
				: "",
			scaleMax: scaleFor(Number.isFinite(value) ? value : 0),
		};
	});

	if (!gauges.some((gauge) => Number.isFinite(gauge.value))) {
		throw new Error("No particulate readings available");
	}

	const times = data.hourly?.time ?? [];
	const hourly = (data.hourly?.[pollutant] ?? []) as Array<number | null>;
	if (times.length === 0) {
		throw new Error("No hourly air quality forecast available");
	}

	// Gaps are carried forward rather than dropped, so a hole in the feed cannot
	// shift later readings onto the wrong hour of the axis.
	let lastKnown =
		gauges.find((gauge) => gauge.key === pollutant)?.value ??
		Number(hourly.find((value) => typeof value === "number") ?? 0);
	const series: AirQualitySample[] = times.map((time, index) => {
		const raw = hourly[index];
		if (typeof raw === "number") lastKnown = raw;
		return { time, value: Math.round(lastKnown * 10) / 10 };
	});

	// past_hours opens the window before now, so the current hour sits that far
	// in — unless the API trimmed the history it was asked for.
	const currentHour = String(current.time).slice(0, 13);
	const matchedIndex = times.findIndex(
		(time) => time.slice(0, 13) === currentHour,
	);
	const nowIndex =
		matchedIndex >= 0 ? matchedIndex : Math.min(PAST_HOURS, times.length - 1);

	return {
		locationName,
		updatedLabel: readingLabel(String(current.time)),
		standard,
		gauges,
		series,
		nowIndex,
		chartLabel:
			GAUGES.find((gauge) => gauge.key === pollutant)?.label ?? "PM 2.5",
	};
}

function emptyData(
	locationName: string,
	standard: AqiStandard,
	pollutant: PollutantKey,
	error: string,
): AirQualityData {
	return {
		locationName,
		updatedLabel: "",
		standard,
		gauges: [],
		series: [],
		nowIndex: 0,
		chartLabel:
			GAUGES.find((gauge) => gauge.key === pollutant)?.label ?? "PM 2.5",
		error,
	};
}

/** Used when neither a location name nor coordinates have been configured. */
const FALLBACK_LOCATION = "Bengaluru";

/** Labels a reading taken from raw coordinates, e.g. "13.02°N, 77.68°E". */
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

export default async function getData(
	params?: AirQualityParams,
): Promise<AirQualityData> {
	const standard = normalizeStandard(params?.standard);
	const pollutant = normalizePollutant(params?.pollutant);
	const requestedName =
		typeof params?.location === "string" && params.location.trim() !== ""
			? params.location.trim()
			: undefined;

	const latitude = finiteNumber(params?.latitude);
	const longitude = finiteNumber(params?.longitude);

	// Coordinates are authoritative when both are set. The screen must never
	// claim a city we did not actually derive the reading from, so an unnamed
	// coordinate pair is labelled with the coordinates themselves.
	const resolved =
		latitude !== undefined && longitude !== undefined
			? {
					latitude,
					longitude,
					locationName: requestedName ?? formatCoordinates(latitude, longitude),
				}
			: await geocodeLocation(requestedName ?? FALLBACK_LOCATION);

	if (!resolved) {
		const name = requestedName ?? FALLBACK_LOCATION;
		return emptyData(name, standard, pollutant, `Could not find "${name}"`);
	}

	const cacheKey = `${resolved.latitude.toFixed(4)},${resolved.longitude.toFixed(4)},${standard},${pollutant}`;

	try {
		// Throwing inside the cached function keeps failures out of the cache.
		const cached = unstable_cache(
			() =>
				fetchAirQuality(
					resolved.latitude,
					resolved.longitude,
					resolved.locationName,
					standard,
					pollutant,
				),
			["air-quality", cacheKey],
			{
				tags: ["air-quality", "open-meteo"],
				// Hourly source data; half-hour cache keeps it fresh enough.
				revalidate: 1800,
			},
		);
		return await cached();
	} catch (error) {
		if (!isPrerenderRejection(error)) {
			console.error(
				`Error fetching air quality for ${resolved.locationName}:`,
				error,
			);
		}
		return emptyData(
			resolved.locationName,
			standard,
			pollutant,
			"Air quality unavailable",
		);
	}
}
