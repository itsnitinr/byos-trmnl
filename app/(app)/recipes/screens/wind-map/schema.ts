import { z } from "zod";

/** Odd so the centre sample sits exactly on the observer. */
export const GRID_SIZE = 7;
export const FORECAST_STEPS = 6;
export const FORECAST_STEP_HOURS = 2;

export const paramsSchema = z.object({
	location: z
		.string()
		.max(60)
		.default("Bengaluru")
		.describe("Display label for the centre of the map")
		.meta({ title: "Location label" }),
	latitude: z
		.number()
		.min(-85)
		.max(85)
		.default(12.9716)
		.describe("Map centre latitude in decimal degrees"),
	longitude: z
		.number()
		.min(-180)
		.max(180)
		.default(77.5946)
		.describe("Map centre longitude in decimal degrees"),
	spanKm: z
		.number()
		.min(40)
		.max(1500)
		.default(300)
		.describe(
			"Width of the area sampled around the centre. Wider areas show fronts and pressure systems",
		)
		.meta({ title: "Map span (km)" }),
	unit: z
		.enum(["kmh", "mph", "kn", "ms"])
		.default("kmh")
		.describe("Unit for wind speeds")
		.meta({ title: "Speed unit" }),
});

const sampleSchema = z.object({
	/** Speed in km/h; display units are converted at render time. */
	speed: z.number().min(0),
	/** Meteorological direction the wind blows from, in degrees. */
	direction: z.number(),
});
export const dataSchema = z.object({
	location: z.string().default("Your location"),
	spanKm: z.number().default(300),
	unit: z.enum(["kmh", "mph", "kn", "ms"]).default("kmh"),
	/** Zone-local ISO time of the current reading, e.g. "2026-10-16T13:30". */
	updated: z.string().default(""),
	/** Row-major from the north-west corner, GRID_SIZE × GRID_SIZE samples. */
	grid: z.array(sampleSchema).default([]),
	gusts: z.number().nullable().default(null),
	forecast: z.array(sampleSchema.extend({ time: z.string() })).default([]),
});

export type WindSample = z.infer<typeof sampleSchema>;
export type WindParams = z.infer<typeof paramsSchema>;
export type WindData = z.infer<typeof dataSchema>;
export type SpeedUnit = WindParams["unit"];
