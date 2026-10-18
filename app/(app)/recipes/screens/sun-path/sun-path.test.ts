import { definition, paramsSchema } from "./sun-path";

// This test covers frame identity, not Next's font compilation or rasterization.
jest.mock("@/utils/pre-satori", () => ({ PreSatori: () => null }));

test("live frames advance every ten minutes while pinned dates stay fixed", () => {
	jest.useFakeTimers();
	try {
		const live = paramsSchema.parse({ timezone: "Asia/Kolkata" });
		const pinned = paramsSchema.parse({ date: "2026-06-21" });
		const key = () => definition.getRenderCacheKey?.(live, live);
		jest.setSystemTime(new Date("2026-10-17T06:00:00Z"));
		const first = key();
		jest.setSystemTime(new Date("2026-10-17T06:09:59Z"));
		expect(key()).toBe(first);
		jest.setSystemTime(new Date("2026-10-17T06:10:00Z"));
		expect(key()).not.toBe(first);
		expect(key()).toMatch(/^2026-10-17:/);
		expect(definition.getRenderCacheKey?.(pinned, pinned)).toBe("2026-06-21");
	} finally {
		jest.useRealTimers();
	}
});
