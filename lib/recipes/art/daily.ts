import { z } from "zod";

export const dailyArtParams = z.object({
	timezone: z
		.string()
		.refine((zone) => {
			try {
				new Intl.DateTimeFormat("en", { timeZone: zone }).format();
				return true;
			} catch {
				return false;
			}
		}, "Use an IANA timezone, such as Asia/Kolkata")
		.default("Asia/Kolkata")
		.describe("Timezone for the daily edition"),
	date: z
		.string()
		.refine(
			(value) =>
				!value ||
				(/^\d{4}-\d{2}-\d{2}$/.test(value) &&
					Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
					new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value),
			"Use YYYY-MM-DD or leave blank for today",
		)
		.default("")
		.describe("Optional fixed edition date (YYYY-MM-DD)"),
});
export function editionDate(
	params: z.infer<typeof dailyArtParams>,
	now = new Date(),
): string {
	if (params.date) return params.date;
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: params.timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}
export function editionLabel(date: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: "UTC",
		day: "2-digit",
		month: "long",
		year: "numeric",
	}).format(new Date(`${date}T12:00:00Z`));
}
export function dailySeed(value: string): number {
	let h = 2166136261;
	for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return h >>> 0;
}
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
export function svgDocument(body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="white"/>${body}</svg>`;
}
