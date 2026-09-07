import { RenderQueue } from "./browser-queue";

test("caps concurrency and queue depth and releases after errors", async () => {
	const queue = new RenderQueue(1, 1);
	let release!: () => void;
	const first = queue.run(
		() =>
			new Promise<void>((r) => {
				release = r;
			}),
	);
	const second = queue.run(async () => 2);
	await expect(queue.run(async () => 3)).rejects.toThrow("full");
	release();
	await first;
	expect(await second).toBe(2);
	await expect(
		queue.run(async () => {
			throw Error("crash");
		}),
	).rejects.toThrow("crash");
	expect(await queue.run(async () => 4)).toBe(4);
});
