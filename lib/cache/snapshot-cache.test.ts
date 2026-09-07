import { createSnapshotCache } from "./snapshot-cache";

test("cold and stale reads immediately serve snapshots and schedule only one refresh", async () => {
	jest.useFakeTimers();
	const jobs: (() => Promise<void>)[] = [];
	const snapshot = jest.fn(async () => "bundled");
	const refresh = jest.fn(async () => "fresh");
	const cache = createSnapshotCache({
		snapshot,
		refresh,
		schedule: (job) => jobs.push(job),
		ttlMs: 1000,
	});
	expect(await Promise.all([cache.get("models"), cache.get("models")])).toEqual(
		["bundled", "bundled"],
	);
	expect(snapshot).toHaveBeenCalledTimes(1);
	expect(refresh).not.toHaveBeenCalled();
	expect(jobs).toHaveLength(1);
	await jobs.shift()?.();
	expect(await cache.get("models")).toBe("fresh");
	jest.advanceTimersByTime(1001);
	refresh.mockRejectedValueOnce(new Error("offline"));
	expect(await cache.get("models")).toBe("fresh");
	await jobs.shift()?.();
	expect(await cache.get("models")).toBe("fresh");
	expect(jobs).toHaveLength(0);
	jest.useRealTimers();
});
test("offline reads never fetch; missing-snapshot reads share the necessary upstream request", async () => {
	const refresh = jest.fn(async () => "upstream");
	const schedule = jest.fn();
	const cache = createSnapshotCache({
		snapshot: async () => null,
		refresh,
		schedule,
		ttlMs: 1000,
	});
	await expect(cache.get("missing", true)).rejects.toThrow("Missing offline");
	expect(refresh).not.toHaveBeenCalled();
	expect(await Promise.all([cache.get("models"), cache.get("models")])).toEqual(
		["upstream", "upstream"],
	);
	expect(refresh).toHaveBeenCalledTimes(1);
});
