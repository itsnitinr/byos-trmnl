import { z } from "zod";
import { BoundedCache } from "@/lib/cache/bounded-cache";
import { recipeFetch } from "@/lib/recipes/runtime/fetch-context";
import type { Elements } from "./terra";

const elementsSchema = z.object({
	epoch: z
		.string()
		.refine((v) =>
			Number.isFinite(Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`)),
		),
	n: z.number().min(14).max(17),
	e: z.number().min(0).max(0.05),
	i: z.number().min(0).max(180),
	raan: z.number().min(0).max(360),
	w: z.number().min(0).max(360),
	ma: z.number().min(0).max(360),
	nd: z.number(),
});
const cache = new BoundedCache<Elements>(4096, 1);
const KEEP_MS = 8 * 3600_000;

export function validateElements(input: unknown, now = Date.now()): Elements {
	const el = elementsSchema.parse(input);
	const epoch = Date.parse(
		/Z|[+-]\d\d:?\d\d$/.test(el.epoch) ? el.epoch : `${el.epoch}Z`,
	);
	if (Math.abs(now - epoch) > 48 * 3600_000)
		throw new Error("ISS orbital elements are older than 48 hours");
	return el;
}

export function parseTle(text: string): Elements {
	const lines = text.trim().split(/\r?\n/);
	const l1 = lines.at(-2) ?? "",
		l2 = lines.at(-1) ?? "";
	if (!l1.startsWith("1 25544") || !l2.startsWith("2 25544"))
		throw new Error("Invalid ISS TLE");
	const yr = Number(l1.slice(18, 20));
	const ms =
		Date.UTC(yr < 57 ? 2000 + yr : 1900 + yr, 0, 1) +
		(Number(l1.slice(20, 32)) - 1) * 86400_000;
	return elementsSchema.parse({
		epoch: new Date(ms).toISOString(),
		n: Number(l2.slice(52, 63)),
		e: Number(`0.${l2.slice(26, 33).trim()}`),
		i: Number(l2.slice(8, 16)),
		raan: Number(l2.slice(17, 25)),
		w: Number(l2.slice(34, 42)),
		ma: Number(l2.slice(43, 51)),
		nd: Number(l1.slice(33, 43)),
	});
}

async function request(url: string, signal?: AbortSignal) {
	const response = await recipeFetch(url, {
		optional: true,
		signal: AbortSignal.any([
			AbortSignal.timeout(2000),
			...(signal ? [signal] : []),
		]),
		headers: { "User-Agent": "BYOS TRMNL Flyover" },
	});
	if (!response.ok) throw new Error(`ISS source HTTP ${response.status}`);
	return response;
}

export async function fetchElements(signal?: AbortSignal): Promise<Elements> {
	try {
		const response = await request(
			"https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json",
			signal,
		);
		const rows = z
			.array(
				z.object({
					NORAD_CAT_ID: z.literal(25544),
					EPOCH: z.string(),
					MEAN_MOTION: z.number(),
					ECCENTRICITY: z.number(),
					INCLINATION: z.number(),
					RA_OF_ASC_NODE: z.number(),
					ARG_OF_PERICENTER: z.number(),
					MEAN_ANOMALY: z.number(),
					MEAN_MOTION_DOT: z.number(),
				}),
			)
			.nonempty()
			.parse(await response.json());
		const o = rows[0];
		return validateElements({
			epoch: o.EPOCH,
			n: o.MEAN_MOTION,
			e: o.ECCENTRICITY,
			i: o.INCLINATION,
			raan: o.RA_OF_ASC_NODE,
			w: o.ARG_OF_PERICENTER,
			ma: o.MEAN_ANOMALY,
			nd: o.MEAN_MOTION_DOT,
		});
	} catch {
		const response = await request(
			"https://api.wheretheiss.at/v1/satellites/25544/tles?format=text",
			signal,
		);
		return validateElements(parseTle(await response.text()));
	}
}

export async function currentElements(signal?: AbortSignal) {
	// A set can cross its accuracy limit before the eight-hour cache TTL.
	// Evict it now so a fresh set can be fetched instead of waiting for expiry.
	const previous = cache.peek("iss");
	if (previous) {
		try {
			validateElements(previous.value);
		} catch {
			cache.delete("iss");
		}
	}
	const result = await cache.get(
		"iss",
		KEEP_MS,
		() => fetchElements(signal),
		() => 1024,
	);
	return validateElements(result.value);
}
