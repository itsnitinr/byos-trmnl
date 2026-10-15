import { definition, paramsSchema } from "./generative-print";

// This test covers edition identity, not Next's font compilation or rasterization.
jest.mock("@/utils/pre-satori", () => ({ PreSatori: () => null }));

test("daily cache identity changes at local midnight while pinned editions stay fixed", () => {
	jest.useFakeTimers();
	try {
		const daily = paramsSchema.parse({ timezone: "Europe/Berlin" });
		const pinned = paramsSchema.parse({
			timezone: "Europe/Berlin",
			date: "2026-10-15",
		});
		jest.setSystemTime(new Date("2026-10-15T21:59:59Z"));
		expect(definition.getRenderCacheKey?.(daily, daily)).toBe("2026-10-15");
		jest.setSystemTime(new Date("2026-10-15T22:00:00Z"));
		expect(definition.getRenderCacheKey?.(daily, daily)).toBe("2026-10-16");
		expect(definition.getRenderCacheKey?.(pinned, pinned)).toBe("2026-10-15");
	} finally {
		jest.useRealTimers();
	}
});
