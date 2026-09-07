import { z } from "zod";

export const paramsSchema = z.object({
	location: z
		.string()
		.max(60)
		.default("Bengaluru")
		.describe("Display label for your observation point"),
	latitude: z
		.number()
		.min(-90)
		.max(90)
		.default(12.9716)
		.describe("Observer latitude in decimal degrees"),
	longitude: z
		.number()
		.min(-180)
		.max(180)
		.default(77.5946)
		.describe("Observer longitude in decimal degrees"),
	radiusKm: z
		.number()
		.min(1)
		.max(100)
		.default(25)
		.describe("Search radius in kilometres"),
	showLogo: z
		.boolean()
		.default(true)
		.describe("Include an airline identification logo when available"),
	demo: z
		.boolean()
		.default(false)
		.describe(
			"Show a clearly labelled sample flight for previewing the design",
		),
});
export const aircraftSchema = z.object({
	hex: z.string(),
	callsign: z.string(),
	registration: z.string(),
	type: z.string(),
	model: z.string(),
	airline: z.string(),
	logo: z.string().optional(),
	origin: z.string(),
	destination: z.string(),
	originCity: z.string(),
	destinationCity: z.string(),
	altitude: z.number().nullable(),
	speed: z.number().nullable(),
	heading: z.number().nullable(),
	distanceKm: z.number(),
	bearing: z.number(),
});
export const dataSchema = z.object({
	status: z.enum(["live", "empty", "error", "demo"]).default("error"),
	location: z.string().default("Your location"),
	radiusKm: z.number().default(25),
	updated: z.string().default(""),
	count: z.number().default(0),
	aircraft: aircraftSchema.optional(),
});
export type OverheadData = z.infer<typeof dataSchema>;
export type OverheadParams = z.infer<typeof paramsSchema>;
