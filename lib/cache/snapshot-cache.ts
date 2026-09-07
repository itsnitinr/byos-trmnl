/** Serve bundled/last-known metadata immediately while a single refresh runs after the response. */
export function createSnapshotCache<K, T>({
	snapshot,
	refresh,
	schedule,
	ttlMs,
	retryMs = 60_000,
}: {
	snapshot: (key: K) => Promise<T | null>;
	refresh: (key: K) => Promise<T>;
	schedule: (work: () => Promise<void>) => void;
	ttlMs: number;
	retryMs?: number;
}) {
	const entries = new Map<K, { value: T; refreshAt: number }>();
	const reads = new Map<K, Promise<T | null>>();
	const pending = new Map<K, Promise<T>>();
	const scheduled = new Set<K>();
	function read(key: K) {
		let task = reads.get(key);
		if (!task) {
			task = snapshot(key);
			reads.set(key, task);
			task.catch(() => reads.delete(key));
		}
		return task;
	}
	function update(key: K): Promise<T> {
		const running = pending.get(key);
		if (running) return running;
		const task = Promise.resolve()
			.then(() => refresh(key))
			.then((value) => {
				entries.set(key, { value, refreshAt: Date.now() + ttlMs });
				return value;
			})
			.catch((error) => {
				const previous = entries.get(key);
				if (!previous) throw error;
				previous.refreshAt = Date.now() + retryMs;
				return previous.value;
			})
			.finally(() => pending.delete(key));
		pending.set(key, task);
		return task;
	}
	return {
		async get(key: K, offline = false): Promise<T> {
			if (offline) {
				const value = await read(key);
				if (value === null)
					throw new Error("Missing offline registry snapshot");
				return value;
			}
			let entry = entries.get(key);
			if (!entry) {
				const value = await read(key);
				// Another caller may already have installed newer metadata while we read disk.
				entry = entries.get(key);
				if (!entry && value !== null) {
					entry = { value, refreshAt: 0 };
					entries.set(key, entry);
				}
			}
			if (!entry) return update(key); // No usable snapshot: this is the only blocking case.
			if (
				Date.now() >= entry.refreshAt &&
				!scheduled.has(key) &&
				!pending.has(key)
			) {
				scheduled.add(key);
				try {
					schedule(async () => {
						try {
							await update(key);
						} finally {
							scheduled.delete(key);
						}
					});
				} catch (error) {
					scheduled.delete(key);
					throw error;
				}
			}
			return entry.value;
		},
	};
}
