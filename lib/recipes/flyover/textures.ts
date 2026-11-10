import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BoundedCache } from "@/lib/cache/bounded-cache";
import { recipeFetch } from "@/lib/recipes/runtime/fetch-context";
import type { Texture } from "./earthface";

export async function decodeTexture(
	input: Buffer,
	mosaic = false,
): Promise<Texture> {
	const { data, info } = await sharp(input, { limitInputPixels: 8_000_000 })
		.removeAlpha()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	const a = new Uint8Array(info.width * info.height);
	for (let i = 0; i < a.length; i++) {
		const p = i * info.channels;
		const max = Math.max(data[p], data[p + 1], data[p + 2]);
		a[i] =
			mosaic && max < 12
				? 0
				: Math.max(
						3,
						(data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8,
					);
	}
	const texture: Texture = { w: info.width, h: info.height, a };
	if (mosaic) {
		// Blend away from black gaps in the daily satellite swaths. Keeping the
		// hole itself at zero avoids painting the polar night with missing data.
		const mask = Buffer.from(Uint8Array.from(a, (value) => (value ? 255 : 0)));
		const blurred = await sharp(mask, {
			raw: { width: info.width, height: info.height, channels: 1 },
		})
			.blur(6)
			.greyscale()
			.raw()
			.toBuffer();
		texture.m = {
			w: info.width,
			h: info.height,
			a: Uint8Array.from(a, (value, i) => (value ? blurred[i] : 0)),
		};
	}
	return texture;
}

let local: Promise<{ alb: Texture; lights: Texture }> | undefined;
export function baseTextures() {
	if (!local) {
		local = Promise.all(
			["albedo", "lights"].map(async (name) =>
				decodeTexture(
					await readFile(
						path.join(
							process.cwd(),
							"public",
							"vendor",
							"flyover",
							`${name}-2k.webp`,
						),
					),
				),
			),
		)
			.then(([alb, lights]) => ({ alb, lights }))
			.catch((error) => {
				local = undefined;
				throw error;
			});
	}
	return local;
}

const clouds = new BoundedCache<Texture | null>(4 * 1024 * 1024, 2);
export function cloudDay(now: number) {
	return new Date(now - 30 * 3600_000).toISOString().slice(0, 10);
}
export async function cloudTexture(day: string, signal?: AbortSignal) {
	const result = await clouds.get(
		day,
		3600_000,
		async () => {
			try {
				const query = new URLSearchParams({
					SERVICE: "WMS",
					REQUEST: "GetMap",
					VERSION: "1.1.1",
					LAYERS: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
					STYLES: "",
					SRS: "EPSG:4326",
					BBOX: "-180,-90,180,90",
					WIDTH: "1024",
					HEIGHT: "512",
					FORMAT: "image/jpeg",
					TIME: day,
				});
				const response = await recipeFetch(
					`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${query}`,
					{
						optional: true,
						signal: AbortSignal.any([
							AbortSignal.timeout(2500),
							...(signal ? [signal] : []),
						]),
					},
				);
				if (!response.ok) return null;
				return await decodeTexture(
					Buffer.from(await response.arrayBuffer()),
					true,
				);
			} catch {
				return null;
			}
		},
		(texture) => (texture ? texture.a.byteLength * 2 : 1),
	);
	return result.value;
}
