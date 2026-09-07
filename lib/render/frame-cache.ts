import { BoundedCache, cacheKey } from "@/lib/cache/bounded-cache";
import type {
	RasterizeOptions,
	RasterizeResults,
} from "@/lib/recipes/render/rasterize";
import { getRendererType, rasterize } from "@/lib/recipes/render/rasterize";
import { measureRenderStage, recordCacheStatus } from "./diagnostics";
import { stampStaleImage } from "./stale-image";

const lastGood = new BoundedCache<RasterizeResults>(32 * 1024 * 1024);
const frames = new BoundedCache<RasterizeResults>(64 * 1024 * 1024);

export async function cachedRasterize(
	options: RasterizeOptions,
	content: unknown,
): Promise<RasterizeResults> {
	const { element: _element, cookies: _cookies, ...identity } = options;
	const key = cacheKey({ ...identity, content, renderer: getRendererType() });
	const fallbackKey = cacheKey({
		slug: options.slug,
		userId: options.userId,
		width: options.imageWidth,
		height: options.imageHeight,
		profile: options.profile,
		settings: options.renderSettings,
		params:
			typeof content === "string"
				? content
				: (content as { params?: unknown })?.params,
	});
	try {
		const result = await frames.get(
			key,
			30_000,
			async () => {
				const image = await measureRenderStage("raster", () =>
					rasterize(options),
				);
				if (!image.png?.length)
					throw new Error("Renderer produced an empty image");
				return image;
			},
			(image) => image.png?.length ?? 0,
		);
		recordCacheStatus("raster", result.status);
		if (result.value.png && !options.freshness?.stale) {
			await lastGood.get(
				fallbackKey,
				0,
				async () => result.value,
				(image) => image.png?.length ?? 0,
			);
		}
		if (options.freshness?.stale && result.value.png)
			return {
				...result.value,
				png: await stampStaleImage(
					result.value.png,
					options.freshness.updatedAt,
				),
				cacheStatus: result.status,
			};
		return { ...result.value, cacheStatus: result.status };
	} catch (error) {
		const previous = lastGood.peek(fallbackKey);
		if (!previous?.value.png || Date.now() - previous.createdAt > 86_400_000)
			throw error;
		return {
			...previous.value,
			png: await stampStaleImage(previous.value.png, previous.createdAt),
		};
	}
}
