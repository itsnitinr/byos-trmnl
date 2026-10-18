/**
 * Render a device's next frame shortly before it wakes.
 *
 * `/api/display` renders inline so it can name images by content; when the
 * recipe's data has expired, the device waits (Wi-Fi on, battery draining)
 * while the server fetches it. The server knows when the device will wake and
 * what it will show, so it fetches and renders a little ahead of time; the
 * wake then hits warm data and frame caches.
 *
 * One timer per device, replaced on every visit. Timers live in this process
 * and are lost on restart, which only costs one cold render.
 */

const MIN_DELAY_MS = 30_000;
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
/** How early to render; frames stay in the frame cache for 30 s by default. */
const MAX_LEAD_MS = 20_000;
const MAX_TIMERS = 5_000;

type WarmupState = { timers: Map<string, ReturnType<typeof setTimeout>> };
const state = globalThis as typeof globalThis & { byosWarmups?: WarmupState };
state.byosWarmups ??= { timers: new Map() };
const timers = state.byosWarmups.timers;

/** Milliseconds from now until the warm-up should run, or null to skip it. */
export function warmupDelayMs(wakeInSeconds: number): number | null {
	const wakeMs = wakeInSeconds * 1000;
	const delay = wakeMs - Math.min(MAX_LEAD_MS, wakeMs / 4);
	// Short intervals keep caches warm on their own; very long ones are not
	// worth holding a timer for.
	return delay >= MIN_DELAY_MS && delay <= MAX_DELAY_MS ? delay : null;
}

/**
 * Run `warm(leadMs)` `leadMs` before the device wakes; `leadMs` is how far
 * ahead of the wake the render happens.
 */
export function scheduleWarmup(
	deviceKey: string,
	wakeInSeconds: number,
	warm: (leadMs: number) => Promise<unknown>,
): boolean {
	cancelWarmup(deviceKey);
	const delay = warmupDelayMs(wakeInSeconds);
	if (delay === null) return false;
	const leadMs = wakeInSeconds * 1000 - delay;
	if (timers.size >= MAX_TIMERS) return false;
	const timer = setTimeout(() => {
		timers.delete(deviceKey);
		warm(leadMs).catch((error) => {
			console.warn(
				`[warmup] ${deviceKey}:`,
				error instanceof Error ? error.message : error,
			);
		});
	}, delay);
	timer.unref?.();
	timers.set(deviceKey, timer);
	return true;
}

export function cancelWarmup(deviceKey: string): void {
	const existing = timers.get(deviceKey);
	if (existing) clearTimeout(existing);
	timers.delete(deviceKey);
}

export function pendingWarmups(): number {
	return timers.size;
}
