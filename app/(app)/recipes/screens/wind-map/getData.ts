import { z } from "zod";
import { recipeFetch as fetch } from "@/lib/recipes/runtime/fetch-context";
import {
	FORECAST_STEP_HOURS,
	FORECAST_STEPS,
	GRID_SIZE,
	paramsSchema,
	type WindData,
	type WindParams,
} from "./schema";

const KM_PER_DEGREE = 111.32;

const pointSchema = z.object({
	current: z.object({
		time: z.string(),
		wind_speed_10m: z.number(),
		wind_direction_10m: z.number(),
		wind_gusts_10m: z.number().nullish(),
	}),
	hourly: z
		.object({
			time: z.array(z.string()),
			wind_speed_10m: z.array(z.number().nullable()),
			wind_direction_10m: z.array(z.number().nullable()),
		})
		.optional(),
});
// Open-Meteo returns a bare object for one location and an array for several.
const responseSchema = z.union([
	z.array(pointSchema),
	pointSchema.transform((point) => [point]),
]);

/** Sample coordinates, row-major from the north-west corner. */
export function gridPoints(
	latitude: number,
	longitude: number,
	spanKm: number,
) {
	const last = GRID_SIZE - 1;
	const latStep = spanKm / last / KM_PER_DEGREE;
	const lonStep =
		spanKm /
		last /
		(KM_PER_DEGREE * Math.max(0.05, Math.cos((latitude * Math.PI) / 180)));
	return Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
		const row = Math.floor(index / GRID_SIZE);
		const column = index % GRID_SIZE;
		const lat = Math.max(
			-89.9,
			Math.min(89.9, latitude + (last / 2 - row) * latStep),
		);
		const lon = ((longitude + (column - last / 2) * lonStep + 540) % 360) - 180;
		return {
			latitude: Number(lat.toFixed(4)),
			longitude: Number(lon.toFixed(4)),
		};
	});
}

export default async function getWindData(
	input: WindParams,
	context?: { signal: AbortSignal },
): Promise<WindData> {
	const params = paramsSchema.parse(input);
	const points = gridPoints(params.latitude, params.longitude, params.spanKm);
	const query = new URLSearchParams({
		latitude: points.map((point) => point.latitude).join(","),
		longitude: points.map((point) => point.longitude).join(","),
		current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
		hourly: "wind_speed_10m,wind_direction_10m",
		forecast_hours: String(FORECAST_STEPS * FORECAST_STEP_HOURS + 1),
		wind_speed_unit: "kmh",
		timezone: "auto",
	});
	const response = await fetch(
		`https://api.open-meteo.com/v1/forecast?${query}`,
		{
			signal: context?.signal,
			headers: { Accept: "application/json" },
			next: { revalidate: 900 },
		},
	);
	if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
	const samples = responseSchema.parse(await response.json());
	if (samples.length !== points.length)
		throw new Error("Open-Meteo returned an incomplete wind grid");

	// Throwing above lets the runtime keep showing the last good map.
	const centre = samples[Math.floor(samples.length / 2)];
	const hourly = centre.hourly;
	const forecast = hourly
		? Array.from({ length: FORECAST_STEPS }, (_, step) => {
				const index = (step + 1) * FORECAST_STEP_HOURS;
				const speed = hourly.wind_speed_10m[index];
				const direction = hourly.wind_direction_10m[index];
				const time = hourly.time[index];
				return speed == null || direction == null || !time
					? []
					: [{ time, speed, direction }];
			}).flat()
		: [];

	return {
		location: params.location,
		spanKm: params.spanKm,
		unit: params.unit,
		updated: centre.current.time,
		grid: samples.map(({ current }) => ({
			speed: Math.max(0, current.wind_speed_10m),
			direction: current.wind_direction_10m,
		})),
		gusts: centre.current.wind_gusts_10m ?? null,
		forecast,
	};
}
