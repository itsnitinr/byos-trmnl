import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { CacheStatus } from "@/lib/cache/bounded-cache";

export type RenderDiagnostic = {
	id: string;
	recipe: string;
	startedAt: string;
	totalMs: number;
	stages: Partial<Record<"fetch" | "raster" | "encode", number>>;
	cache: Partial<Record<"raster" | "encode", CacheStatus>>;
	width: number;
	height: number;
	bytes?: number;
	fallback?: boolean;
	status: "ok" | "error";
};
const current = new AsyncLocalStorage<RenderDiagnostic>();
const state = globalThis as typeof globalThis & {
	byosRenderHistory?: Map<string, RenderDiagnostic[]>;
};
state.byosRenderHistory ??= new Map();
const history = state.byosRenderHistory;

export async function measureRenderStage<T>(
	stage: keyof RenderDiagnostic["stages"],
	work: () => Promise<T>,
): Promise<T> {
	const trace = current.getStore();
	if (!trace) return work();
	const start = performance.now();
	try {
		return await work();
	} finally {
		trace.stages[stage] =
			(trace.stages[stage] ?? 0) + performance.now() - start;
	}
}
export function recordCacheStatus(
	stage: keyof RenderDiagnostic["cache"],
	status: CacheStatus,
): void {
	const trace = current.getStore();
	if (trace) trace.cache[stage] = status;
}

export async function diagnoseRender<
	T extends { buffer: Buffer; fallback?: boolean } | null,
>(
	userId: string | null | undefined,
	recipe: string,
	width: number,
	height: number,
	work: () => Promise<T>,
): Promise<{ image: T; trace: RenderDiagnostic }> {
	const trace: RenderDiagnostic = {
		id: randomUUID(),
		recipe,
		startedAt: new Date().toISOString(),
		totalMs: 0,
		stages: {},
		cache: {},
		width,
		height,
		status: "error",
	};
	const start = performance.now();
	try {
		const image = await current.run(trace, work);
		trace.status = image ? "ok" : "error";
		trace.bytes = image?.buffer.length;
		trace.fallback = image?.fallback;
		return { image, trace };
	} finally {
		trace.totalMs = performance.now() - start;
		if (userId) {
			const records = history.get(userId) ?? [];
			history.delete(userId);
			history.set(userId, [trace, ...records].slice(0, 50));
			if (history.size > 100) {
				const oldest = history.keys().next().value;
				if (oldest) history.delete(oldest);
			}
		}
	}
}
export function getRenderDiagnostics(userId: string): RenderDiagnostic[] {
	return history.get(userId) ?? [];
}
export function renderTimingHeader(trace: RenderDiagnostic): string {
	return [
		...Object.entries(trace.stages).map(
			([name, ms]) => `${name};dur=${ms.toFixed(1)}`,
		),
		`total;dur=${trace.totalMs.toFixed(1)}`,
	].join(", ");
}
