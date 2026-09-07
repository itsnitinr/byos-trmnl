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
	const {
		element: _element,
		cookies: _cookies,
		snapshot: _snapshot,
		freshness,
		...identity
	} = options;
	const key = cacheKey({
		...identity,
		content,
		staleAt: freshness?.stale ? freshness.updatedAt : null,
		renderer: getRendererType(),
	});
	const seconds = options.renderSettings?.cacheSeconds ?? 30;
	const lifetime = Number.isFinite(seconds)
		? Math.min(86_400, Math.max(0, seconds)) * 1000
		: 30_000;
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
			lifetime,
			async () => {
				const image = await measureRenderStage("raster", () =>
					rasterize(options),
				);
				if (!image.png?.length)
					throw new Error("Renderer produced an empty image");
				return freshness?.stale
					? {
							...image,
							png: await stampStaleImage(image.png, freshness.updatedAt),
						}
					: image;
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
