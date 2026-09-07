import { createReadinessCache } from "./readiness-cache";

test("coalesces readiness checks, expires failures quickly, and invalidates after migrations", async () => {
	jest.useFakeTimers();
	const check = jest
		.fn()
		.mockResolvedValueOnce({ ready: false })
		.mockResolvedValue({ ready: true });
	const cache = createReadinessCache(check);
	await Promise.all([cache.get(), cache.get(), cache.get()]);
	expect(check).toHaveBeenCalledTimes(1);
	jest.advanceTimersByTime(1001);
	expect(await cache.get()).toEqual({ ready: true });
	jest.advanceTimersByTime(10_000);
	await cache.get();
	expect(check).toHaveBeenCalledTimes(2);
	cache.invalidate();
	await cache.get();
	expect(check).toHaveBeenCalledTimes(3);
	jest.useRealTimers();
});
