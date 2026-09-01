import { unstable_cache } from "next/cache";

// Live data — always fetch fresh.
export const dynamic = "force-dynamic";

export type AqiStandard = "us" | "european";

export interface AqiHour {
	/** Hour label, e.g. "4 PM". Only rendered on tick positions. */
	label: string;
	aqi: number;
}

export interface Pollutant {
	name: string;
	value: string;
	/** True when this pollutant drives the headline index. */
	dominant: boolean;
}

export interface AirQualityData {
	locationName: string;
	dateLabel: string;
	standard: AqiStandard;
	aqi: number;
	category: string;
	dominantPollutant: string;
	/** Change against three hours ago; positive means worsening. */
	trend: number;
	hours: AqiHour[];
	/** Index value the chart's reference line is drawn at. */
	threshold: number;
	scaleMax: number;
	bestWindow: string;
	bestWindowAqi: number;
	peakLabel: string;
	peakAqi: number;
	pollutants: Pollutant[];
	error?: string;
}

type AirQualityParams = {
	location?: string;
	latitude?: number;
	longitude?: number;
	standard?: string;
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

/** Concentration keys we surface in the pollutant strip, in display order. */
const POLLUTANTS = [
	{ key: "pm2_5", name: "PM2.5", index: "pm2_5" },
	{ key: "pm10", name: "PM10", index: "pm10" },
	{ key: "ozone", name: "O3", index: "ozone" },
	{ key: "nitrogen_dioxide", name: "NO2", index: "nitrogen_dioxide" },
] as const;

/** US EPA breakpoints. Upper bound is inclusive. */
const US_CATEGORIES: Array<[number, string]> = [
	[50, "GOOD"],
	[100, "MODERATE"],
	[150, "SENSITIVE"],
	[200, "UNHEALTHY"],
	[300, "VERY UNHEALTHY"],
	[Number.POSITIVE_INFINITY, "HAZARDOUS"],
];

/** European Environment Agency bands. */
const EU_CATEGORIES: Array<[number, string]> = [
	[20, "GOOD"],
	[40, "FAIR"],
	[60, "MODERATE"],
	[80, "POOR"],
	[100, "VERY POOR"],
	[Number.POSITIVE_INFINITY, "EXTREME"],
];

/**
 * The index value above which the air is no longer comfortable for everyone.
 * Drawn as the reference line on the forecast chart.
 */
const THRESHOLDS: Record<AqiStandard, number> = { us: 100, european: 60 };

/** Chart never compresses below this, so calm days keep believably short bars. */
const MIN_SCALE: Record<AqiStandard, number> = { us: 120, european: 70 };

/** Rounds the chart ceiling up to a readable number for the axis label. */
function niceCeiling(value: number): number {
	const step = value <= 150 ? 50 : value <= 500 ? 100 : 250;
	return Math.ceil(value / step) * step;
}

function categoryFor(aqi: number, standard: AqiStandard): string {
	const bands = standard === "european" ? EU_CATEGORIES : US_CATEGORIES;
	for (const [limit, label] of bands) {
		if (aqi <= limit) return label;
	}
	return bands[bands.length - 1][1];
}

export function normalizeStandard(value?: string): AqiStandard {
	return value?.toLowerCase() === "european" ? "european" : "us";
}

/** "2026-08-06T22:00" -> "10 PM". Parsed by hand: the string is zone-local. */
function hourLabel(isoLocal: string): string {
	const hour = Number(isoLocal.slice(11, 13));
	const suffix = hour < 12 ? "AM" : "PM";
	const twelve = hour % 12 === 0 ? 12 : hour % 12;
	return `${twelve} ${suffix}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
 * would reinterpret it in the server's timezone.
 */
function dateLabelFrom(isoLocal: string): string {
	const year = Number(isoLocal.slice(0, 4));
	const month = Number(isoLocal.slice(5, 7)) - 1;
	const day = Number(isoLocal.slice(8, 10));
	const weekday = WEEKDAYS[new Date(Date.UTC(year, month, day)).getUTCDay()];
	return `${weekday} ${day} ${MONTHS[month]} · ${hourLabel(isoLocal)}`;
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
	const subIndices = POLLUTANTS.map((p) => `${prefix}_${p.index}`).join(",");
	const concentrations = POLLUTANTS.map((p) => p.key).join(",");

	const search = new URLSearchParams({
		latitude: String(latitude),
		longitude: String(longitude),
		current: `${prefix},${concentrations},${subIndices}`,
		hourly: prefix,
		timezone: "auto",
		past_hours: "3",
		forecast_hours: "24",
	});

	return `https://air-quality-api.open-meteo.com/v1/air-quality?${search}`;
}

/**
 * Finds the calmest three-hour block in the forecast — the answer to "when
 * should I open the windows / go for a run".
 */
function findBestWindow(
	values: number[],
	times: string[],
): { label: string; aqi: number } {
	const WINDOW = 3;
	if (values.length < WINDOW) {
		return { label: "—", aqi: values[0] ?? 0 };
	}

	let bestStart = 0;
	let bestMean = Number.POSITIVE_INFINITY;

	for (let start = 0; start + WINDOW <= values.length; start++) {
		const mean =
			values.slice(start, start + WINDOW).reduce((sum, v) => sum + v, 0) /
			WINDOW;
		if (mean < bestMean) {
			bestMean = mean;
			bestStart = start;
		}
	}

	const from = hourLabel(times[bestStart]);
	const to = hourLabel(times[bestStart + WINDOW - 1]);
	return { label: `${from}–${to}`, aqi: Math.round(bestMean) };
}

async function fetchAirQuality(
	latitude: number,
	longitude: number,
	locationName: string,
	standard: AqiStandard,
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
	const aqi = Number(current?.[prefix]);
	if (!current || !Number.isFinite(aqi)) {
		throw new Error("No current air quality reading available");
	}

	const times = data.hourly?.time ?? [];
	const series = (data.hourly?.[prefix] ?? []) as Array<number | null>;
	if (times.length === 0) {
		throw new Error("No hourly air quality forecast available");
	}

	// past_hours=3 means the request window opens three hours before now, so
	// the current hour sits at index 3 — unless the API trimmed the history.
	const nowIndex = Math.min(3, times.length - 1);
	const threeHoursAgo = series[0];
	const trend =
		typeof threeHoursAgo === "number" ? Math.round(aqi - threeHoursAgo) : 0;

	// Gaps in the series are carried forward rather than dropped, so bar
	// positions stay aligned with their hour labels.
	let lastKnown = aqi;
	const forecast = times.slice(nowIndex).map((time, index) => {
		const raw = series[nowIndex + index];
		if (typeof raw === "number") lastKnown = raw;
		return { time, aqi: Math.round(lastKnown) };
	});

	const values = forecast.map((hour) => hour.aqi);
	const peakIndex = values.indexOf(Math.max(...values));
	const best = findBestWindow(
		values,
		forecast.map((hour) => hour.time),
	);

	const dominant = POLLUTANTS.reduce((leader, pollutant) => {
		const value = Number(current[`${prefix}_${pollutant.index}`]);
		const leaderValue = Number(current[`${prefix}_${leader.index}`]);
		return Number.isFinite(value) && value > (leaderValue || 0)
			? pollutant
			: leader;
	}, POLLUTANTS[0]);

	return {
		locationName,
		dateLabel: dateLabelFrom(String(current.time)),
		standard,
		aqi: Math.round(aqi),
		category: categoryFor(aqi, standard),
		dominantPollutant: dominant.name,
		trend,
		hours: forecast.map((hour) => ({
			label: hourLabel(hour.time),
			aqi: hour.aqi,
		})),
		threshold: THRESHOLDS[standard],
		scaleMax: niceCeiling(Math.max(...values, MIN_SCALE[standard])),
		bestWindow: best.label,
		bestWindowAqi: best.aqi,
		peakLabel: hourLabel(forecast[peakIndex].time),
		peakAqi: values[peakIndex],
		pollutants: POLLUTANTS.map((pollutant) => {
			const value = Number(current[pollutant.key]);
			return {
				name: pollutant.name,
				value: Number.isFinite(value) ? value.toFixed(1) : "—",
				dominant: pollutant.name === dominant.name,
			};
		}),
	};
}

function emptyData(
	locationName: string,
	standard: AqiStandard,
	error: string,
): AirQualityData {
	return {
		locationName,
		dateLabel: "",
		standard,
		aqi: 0,
		category: "",
		dominantPollutant: "",
		trend: 0,
		hours: [],
		threshold: THRESHOLDS[standard],
		scaleMax: niceCeiling(MIN_SCALE[standard]),
		bestWindow: "",
		bestWindowAqi: 0,
		peakLabel: "",
		peakAqi: 0,
		pollutants: [],
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
	const requestedName =
		typeof params?.location === "string" && params.location.trim() !== ""
			? params.location.trim()
			: undefined;

	const latitude = finiteNumber(params?.latitude);
	const longitude = finiteNumber(params?.longitude);

	// Coordinates are authoritative when both are set. The header must never
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
		return emptyData(name, standard, `Could not find "${name}"`);
	}

	const cacheKey = `${resolved.latitude.toFixed(4)},${resolved.longitude.toFixed(4)},${standard}`;

	try {
		// Throwing inside the cached function keeps failures out of the cache.
		const cached = unstable_cache(
			() =>
				fetchAirQuality(
					resolved.latitude,
					resolved.longitude,
					resolved.locationName,
					standard,
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
			"Air quality unavailable",
		);
	}
}
