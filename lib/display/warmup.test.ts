import { cancelWarmup, scheduleWarmup, warmupDelayMs } from "./warmup";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("warms 20 s before long waits and a quarter early for short ones", () => {
	expect(warmupDelayMs(900)).toBe(880_000);
	expect(warmupDelayMs(60)).toBe(45_000);
	expect(warmupDelayMs(30)).toBeNull(); // caches stay warm on their own
	expect(warmupDelayMs(2 * 86_400)).toBeNull();
});

test("runs once per device, replacing an earlier schedule", async () => {
	const warm = jest.fn(async (_leadMs: number) => undefined);
	expect(scheduleWarmup("device-1", 900, warm)).toBe(true);
	expect(scheduleWarmup("device-1", 300, warm)).toBe(true);
	jest.advanceTimersByTime(280_000);
	expect(warm).toHaveBeenCalledTimes(1);
	expect(warm).toHaveBeenCalledWith(20_000);
	jest.advanceTimersByTime(900_000);
	expect(warm).toHaveBeenCalledTimes(1);
});

test("can be cancelled and swallows warm-up failures", async () => {
	const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
	const failing = jest.fn(async () => {
		throw new Error("upstream down");
	});
	scheduleWarmup("device-2", 120, failing);
	cancelWarmup("device-2");
	jest.advanceTimersByTime(200_000);
	expect(failing).not.toHaveBeenCalled();

	scheduleWarmup("device-2", 120, failing);
	jest.advanceTimersByTime(200_000);
	await Promise.resolve();
	expect(failing).toHaveBeenCalledTimes(1);
	warn.mockRestore();
});
