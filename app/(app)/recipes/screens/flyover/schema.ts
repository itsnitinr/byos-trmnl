import { z } from "zod";

export const paramsSchema = z.object({
	location: z
		.string()
		.max(40)
		.default("Bengaluru")
		.meta({ title: "Your location" }),
	latitude: z.number().min(-90).max(90).default(12.9716),
	longitude: z.number().min(-180).max(180).default(77.5946),
	view: z
		.enum(["iss", "place", "sun"])
		.default("iss")
		.describe("Follow the ISS, look toward your location, or face the Sun")
		.meta({ title: "Globe view" }),
	units: z.enum(["km", "miles"]).default("km"),
	clouds: z
		.boolean()
		.default(true)
		.describe("Use yesterday's NASA satellite mosaic when available"),
});

export const dataSchema = z.object({
	updatedAt: z.number(),
	epoch: z.string(),
	globe: z.string(),
	camera: z.object({ latitude: z.number(), longitude: z.number() }),
	station: z.object({
		latitude: z.number(),
		longitude: z.number(),
		altitude: z.number(),
		speed: z.number(),
	}),
	track: z.array(z.tuple([z.number(), z.number()])),
	distance: z.number(),
	above: z.string(),
	cloudDate: z.string().nullable(),
});
export type FlyoverParams = z.infer<typeof paramsSchema>;
export type FlyoverData = z.infer<typeof dataSchema>;
