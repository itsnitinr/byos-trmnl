import { unstable_cache } from "next/cache";
import { hasRecipeFetchContext } from "./fetch-context";

/** The recipe runtime owns freshness; legacy source caches remain available to direct callers. */
export function recipeSourceCache<Args extends unknown[], Result>(
	callback: (...args: Args) => Promise<Result>,
	keyParts?: string[],
	options?: Parameters<typeof unstable_cache>[2],
): (...args: Args) => Promise<Result> {
	const cached = unstable_cache(callback, keyParts, options);
	return (...args: Args) =>
		hasRecipeFetchContext() ? callback(...args) : cached(...args);
}
