import { resolveCachedData } from "./data-cache";
import { withRecipeDeadline } from "./fetch-context";

test("retains good data on failure without crossing tenant/config keys", async () => {
	jest.useFakeTimers();
	await resolveCachedData(
		"tenant-a:weather:london",
		async () => ({ temperature: 20 }),
		10,
	);
	jest.advanceTimersByTime(20);
	const failing = async () => {
		throw Error("offline");
	};
	expect(
		await resolveCachedData("tenant-a:weather:london", failing, 10),
	).toMatchObject({ data: { temperature: 20 }, freshness: { stale: true } });
	await expect(
		resolveCachedData("tenant-b:weather:london", failing),
	).rejects.toThrow("offline");
	jest.useRealTimers();
});

test("deadline cancels underlying work and clears successful timers", async () => {
	jest.useFakeTimers();
	let signal: AbortSignal | undefined;
	const work = withRecipeDeadline(async (s) => {
		signal = s;
		return new Promise(() => {});
	}, 10);
	const assertion = expect(work).rejects.toThrow("timeout");
	await jest.advanceTimersByTimeAsync(11);
	await assertion;
	expect(signal?.aborted).toBe(true);
	await withRecipeDeadline(async () => 42);
	expect(jest.getTimerCount()).toBe(0);
	jest.useRealTimers();
});
