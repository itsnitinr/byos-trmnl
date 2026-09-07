jest.mock("next/cache", () => ({
	unstable_cache: () => async () => "legacy cache",
}));

import { withRecipeDeadline } from "./fetch-context";
import { recipeSourceCache } from "./source-cache";

test("runtime refresh intervals bypass legacy provider caches", async () => {
	const source = recipeSourceCache(async () => "fresh source");
	expect(await source()).toBe("legacy cache");
	expect(await withRecipeDeadline(() => source())).toBe("fresh source");
});
