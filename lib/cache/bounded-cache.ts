import { createHash } from "node:crypto";

export type CacheStatus = "hit" | "miss" | "shared";
export type CachedValue<T> = {
	value: T;
	createdAt: number;
	status: CacheStatus;
};

/** Bounded LRU with single-flight computation. Rejections are never cached. */
export class BoundedCache<T> {
	private entries = new Map<
		string,
		{ value: T; bytes: number; createdAt: number }
	>();
	private pending = new Map<string, Promise<CachedValue<T>>>();
	private bytes = 0;
	constructor(
		private maxBytes: number,
		private maxEntries = 128,
	) {}

	peek(key: string): CachedValue<T> | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return { value: entry.value, createdAt: entry.createdAt, status: "hit" };
	}

	async get(
		key: string,
		ttlMs: number,
		compute: () => Promise<T>,
		sizeOf: (value: T) => number,
	): Promise<CachedValue<T>> {
		const cached = this.peek(key);
		if (cached && Date.now() - cached.createdAt < ttlMs) return cached;
		const pending = this.pending.get(key);
		if (pending) return { ...(await pending), status: "shared" };
		const task = Promise.resolve()
			.then(compute)
			.then((value) => {
				const createdAt = Date.now();
				const bytes = sizeOf(value);
				if (bytes <= this.maxBytes) {
					this.delete(key);
					this.entries.set(key, { value, bytes, createdAt });
					this.bytes += bytes;
					while (
						this.bytes > this.maxBytes ||
						this.entries.size > this.maxEntries
					) {
						const oldest = this.entries.keys().next().value;
						if (oldest === undefined) break;
						this.delete(oldest);
					}
				}
				return { value, createdAt, status: "miss" as const };
			})
			.finally(() => {
				this.pending.delete(key);
			});
		this.pending.set(key, task);
		return task;
	}

	delete(key: string): void {
		const entry = this.entries.get(key);
		if (entry) this.bytes -= entry.bytes;
		this.entries.delete(key);
	}
}

export function cacheKey(value: unknown): string {
	return createHash("sha256")
		.update(
			JSON.stringify(value, (_key, item) => {
				if (item && typeof item === "object" && !Array.isArray(item)) {
					return Object.fromEntries(
						Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
					);
				}
				return item;
			}),
		)
		.digest("hex");
}
