import { BoundedCache, cacheKey } from "@/lib/cache/bounded-cache";
import type {
	RasterizeOptions,
	RasterizeResults,
} from "@/lib/recipes/render/rasterize";
import { getRendererType, rasterize } from "@/lib/recipes/render/rasterize";

const frames = new BoundedCache<RasterizeResults>(64 * 1024 * 1024);

export async function cachedRasterize(
	options: RasterizeOptions,
	content: unknown,
): Promise<RasterizeResults> {
	const { element: _element, cookies: _cookies, ...identity } = options;
	const key = cacheKey({ ...identity, content, renderer: getRendererType() });
	const result = await frames.get(
		key,
		30_000,
		async () => {
			const image = await rasterize(options);
			if (!image.png?.length)
				throw new Error("Renderer produced an empty image");
			return image;
		},
		(image) => image.png?.length ?? 0,
	);
	return { ...result.value, cacheStatus: result.status };
}
