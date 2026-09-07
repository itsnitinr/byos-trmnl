import type { DbStatus } from "@/lib/types";

export function createReadinessCache(check: () => Promise<DbStatus>) {
	let cached: { status: DbStatus; expires: number } | undefined;
	let pending: Promise<DbStatus> | undefined;
	let generation = 0;
	return {
		invalidate() {
			cached = undefined;
			pending = undefined;
			generation++;
		},
		async get(): Promise<DbStatus> {
			if (cached && cached.expires > Date.now()) return cached.status;
			if (pending) return pending;
			const started = generation;
			pending = check()
				.then((status) => {
					if (started === generation)
						cached = {
							status,
							expires: Date.now() + (status.ready ? 30_000 : 1000),
						};
					return status;
				})
				.finally(() => {
					if (started === generation) pending = undefined;
				});
			return pending;
		},
	};
}
