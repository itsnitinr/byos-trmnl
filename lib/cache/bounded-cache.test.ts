import { BoundedCache, cacheKey } from "./bounded-cache";

test("deduplicates concurrent work, expires, and retries failures", async () => {
	jest.useFakeTimers();
	const cache = new BoundedCache<string>(20, 2);
	const compute = jest.fn(async () => "frame");
	const [a, b] = await Promise.all([
		cache.get("a", 100, compute, (v) => v.length),
		cache.get("a", 100, compute, (v) => v.length),
	]);
	expect(compute).toHaveBeenCalledTimes(1);
	expect([a.status, b.status]).toEqual(["miss", "shared"]);
	expect((await cache.get("a", 100, compute, (v) => v.length)).status).toBe(
		"hit",
	);
	jest.advanceTimersByTime(101);
	await cache.get("a", 100, compute, (v) => v.length);
	expect(compute).toHaveBeenCalledTimes(2);
	await expect(
		cache.get(
			"b",
			100,
			async () => {
				throw Error("offline");
			},
			() => 0,
		),
	).rejects.toThrow("offline");
	await expect(
		cache.get("b", 100, compute, (v) => v.length),
	).resolves.toMatchObject({ value: "frame" });
	jest.useRealTimers();
});

test("evicts by bytes and entries and separates tenant/config/profile keys", async () => {
	const cache = new BoundedCache<string>(6, 2);
	for (const key of ["a", "b", "c"])
		await cache.get(
			key,
			1000,
			async () => "123",
			(v) => v.length,
		);
	expect(cache.peek("a")).toBeUndefined();
	expect(cache.peek("c")?.value).toBe("123");
	const identity = { userId: "a", params: { city: "London" }, palette: "bw" };
	expect(cacheKey(identity)).not.toBe(cacheKey({ ...identity, userId: "b" }));
	expect(cacheKey(identity)).not.toBe(
		cacheKey({ ...identity, palette: "gray-4" }),
	);
	expect(cacheKey({ a: 1, b: 2 })).toBe(cacheKey({ b: 2, a: 1 }));
});
