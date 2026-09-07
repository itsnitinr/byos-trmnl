import { BoundedCache, cacheKey } from "@/lib/cache/bounded-cache";

export type DataFreshness = { updatedAt: number; stale: boolean };
const dataCache = new BoundedCache<Record<string, unknown>>(
	16 * 1024 * 1024,
	256,
);

export async function resolveCachedData(
	key: string,
	fetchData: () => Promise<Record<string, unknown>>,
	ttlMs = 30_000,
): Promise<{ data: Record<string, unknown>; freshness: DataFreshness }> {
	try {
		const result = await dataCache.get(key, ttlMs, fetchData, (value) =>
			Buffer.byteLength(JSON.stringify(value)),
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
