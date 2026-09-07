import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<{
	signal: AbortSignal;
	failures: number;
}>();

/** Every built-in recipe fetch inherits the enclosing render's cancellation. */
export async function recipeFetch(
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
): Promise<Response> {
	const active = context.getStore();
	const signals = [
		AbortSignal.timeout(10_000),
		active?.signal,
		init?.signal,
	].filter((signal): signal is AbortSignal => Boolean(signal));
	try {
		const response = await globalThis.fetch(input, {
			...init,
			...(active ? { cache: "no-store" as const, next: undefined } : {}),
			signal: AbortSignal.any(signals),
		});
		if (!response.ok && active) active.failures++;
		return response;
	} catch (error) {
		if (active) active.failures++;
		throw error;
	}
}

export async function withRecipeDeadline<T>(
	work: (signal: AbortSignal) => Promise<T>,
	timeoutMs = 10_000,
): Promise<T> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			context.run({ signal: controller.signal, failures: 0 }, async () => {
				const result = await work(controller.signal);
				if (context.getStore()?.failures)
					throw new Error("Recipe source unavailable");
				return result;
			}),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					const error = new Error("Recipe data fetch timeout");
					controller.abort(error);
					reject(error);
				}, timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export function hasRecipeFetchContext(): boolean {
	return Boolean(context.getStore());
}
