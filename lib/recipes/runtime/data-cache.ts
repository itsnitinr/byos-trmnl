import { AsyncLocalStorage } from "node:async_hooks";
import { BoundedCache, cacheKey } from "@/lib/cache/bounded-cache";
import { measureRenderStage } from "@/lib/render/diagnostics";

export type DataFreshness = { updatedAt: number; stale: boolean };
const dataCache = new BoundedCache<Record<string, unknown>>(
	16 * 1024 * 1024,
	256,
);

const freshnessMargin = new AsyncLocalStorage<number>();

/**
 * Run `work` treating cached data that expires within `marginMs` as already
 * expired. Used when warming a device's next frame: data that would go stale
 * before the device wakes is fetched now rather than while it waits.
 */
export function withFreshnessMargin<T>(
	marginMs: number,
	work: () => Promise<T>,
): Promise<T> {
	return freshnessMargin.run(Math.max(0, marginMs), work);
}

export async function resolveCachedData(
	key: string,
	fetchData: () => Promise<Record<string, unknown>>,
	ttlMs = 30_000,
): Promise<{ data: Record<string, unknown>; freshness: DataFreshness }> {
	try {
		const result = await dataCache.get(
			key,
			Math.max(0, ttlMs - (freshnessMargin.getStore() ?? 0)),
			() => measureRenderStage("fetch", fetchData),
			(value) => Buffer.byteLength(JSON.stringify(value)),
		);
		return {
			data: result.value,
			freshness: { updatedAt: result.createdAt, stale: false },
		};
	} catch (error) {
		const previous = dataCache.peek(key);
		if (!previous || Date.now() - previous.createdAt > 86_400_000) throw error;
		return {
			data: previous.value,
			freshness: { updatedAt: previous.createdAt, stale: true },
		};
	}
}

export function recipeDataKey(
	userId: string | null | undefined,
	slug: string,
	identity: unknown,
): string {
	return `${cacheKey([userId ?? null, slug])}:${cacheKey(identity)}`;
}
export function invalidateRecipeData(userId: string, slug: string): void {
	dataCache.invalidatePrefix(`${cacheKey([userId, slug])}:`);
}
