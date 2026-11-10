import sharp from "sharp";
import { camera, shade } from "@/lib/recipes/flyover/earthface";
import { groundDistance, regionBelow } from "@/lib/recipes/flyover/geography";
import { currentElements } from "@/lib/recipes/flyover/orbit";
import * as terra from "@/lib/recipes/flyover/terra";
import {
	baseTextures,
	cloudDay,
	cloudTexture,
} from "@/lib/recipes/flyover/textures";
import { type FlyoverData, type FlyoverParams, paramsSchema } from "./schema";

export default async function getData(
	input: FlyoverParams,
	context?: { signal: AbortSignal },
): Promise<FlyoverData> {
	const params = paramsSchema.parse(input);
	const day = cloudDay(Date.now());
	const [elements, textures, live] = await Promise.all([
		currentElements(context?.signal),
		baseTextures(),
		params.clouds ? cloudTexture(day, context?.signal) : Promise.resolve(null),
	]);
	context?.signal.throwIfAborted();
	const now = Date.now();
	const orbit = terra.prepare(elements);
	const position = terra.iss(orbit, now);
	const sun = terra.subsolar(now);
	const target =
		params.view === "sun"
			? {
					latitude: (sun.lat * 180) / Math.PI,
					longitude: (sun.lon * 180) / Math.PI,
				}
			: params.view === "place"
				? { latitude: params.latitude, longitude: params.longitude }
				: { latitude: position.lat, longitude: position.lon };
	// A fixed high-resolution texture is downsampled to the logical hero. The
	// shared device encoder dithers to the actual screen's palette afterward.
	const { L, size } = shade(
		{ ...textures, live },
		camera(target.latitude, target.longitude),
		sun,
		440,
		{ nightBase: 0.12, lights: 1.5 },
	);
	// Transparent space lets the naturally shaded globe sit on the light canvas.
	// Feather the silhouette over one pixel rather than retaining the dark halo.
	const pixels = Buffer.alloc(L.length * 4);
	for (let i = 0; i < L.length; i++) {
		const gray = Math.round(255 * Math.max(0, Math.min(1, L[i])) ** (1 / 1.3));
		const x = (i % size) + 0.5 - size / 2;
		const y = Math.floor(i / size) + 0.5 - size / 2;
		const alpha = Math.max(0, Math.min(1, 440.5 - Math.hypot(x, y)));
		const p = i * 4;
		pixels[p] = pixels[p + 1] = pixels[p + 2] = gray;
		pixels[p + 3] = Math.round(alpha * 255);
	}
	const png = await sharp(pixels, {
		raw: { width: size, height: size, channels: 4 },
	})
		.png()
		.toBuffer();
	return {
		updatedAt: now,
		epoch: elements.epoch,
		globe: `data:image/png;base64,${png.toString("base64")}`,
		camera: target,
		station: {
			latitude: position.lat,
			longitude: position.lon,
			altitude: position.alt,
			speed: terra.speed(orbit, now) * 3600,
		},
		track: terra
			.track(orbit, now, now + 52 * 60_000, 30_000)
			.map(([lat, lon]) => [lat, lon]),
		distance: groundDistance(
			params.latitude,
			params.longitude,
			position.lat,
			position.lon,
		),
		above: regionBelow(position.lat, position.lon, textures.alb),
		cloudDate: live ? day : null,
	};
}
