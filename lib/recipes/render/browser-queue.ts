export class RenderQueue {
	private active = 0;
	private waiting: Array<() => void> = [];
	constructor(
		private concurrency = 2,
		private maxWaiting = 8,
	) {}
	async run<T>(
		work: (signal: AbortSignal) => Promise<T>,
		timeoutMs = 30_000,
	): Promise<T> {
		if (this.active >= this.concurrency) {
			if (this.waiting.length >= this.maxWaiting)
				throw new Error("Render queue is full; retry shortly");
			await new Promise<void>((resolve, reject) => {
				const grant = () => {
					clearTimeout(timer);
					resolve();
				};
				const timer = setTimeout(() => {
					this.waiting = this.waiting.filter((entry) => entry !== grant);
					reject(new Error("Render queue wait timed out"));
				}, 10_000);
				this.waiting.push(grant);
			});
		} else this.active++;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const task = Promise.resolve()
			.then(() => work(controller.signal))
			.finally(() => {
				const next = this.waiting.shift();
				if (next) next();
				else this.active--;
			});
		try {
			return await Promise.race([
				task,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						const error = new Error("Browser render deadline exceeded");
						controller.abort(error);
						reject(error);
					}, timeoutMs);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}
}
export const browserQueue = new RenderQueue();
