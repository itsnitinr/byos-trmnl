import type { z } from "zod";
import {
	dailyArtParams,
	editionDate,
	seededRandom,
	svgDocument,
} from "@/lib/recipes/art/daily";
import { DailyArtLayout } from "@/lib/recipes/art/layout";
import type { RecipeDefinition, RecipeRenderProps } from "@/lib/recipes/types";
export const paramsSchema = dailyArtParams;
export const dataSchema = paramsSchema;
const MONTH = 29.530588;
// Mean-cycle illustration, not an ephemeris. Epoch: USNO Circular 169 (2000 Jan 6, 18:15 TDT).
// https://aa.usno.navy.mil/downloads/Circular_169_coverupdate.pdf
// Mean month: https://eclipse.gsfc.nasa.gov/phase/phases0501.html
export function moonPhase(at: Date) {
	const elapsed =
		(at.getTime() - Date.parse("2000-01-06T18:14:00Z")) / 86_400_000;
	const age = ((elapsed % MONTH) + MONTH) % MONTH;
	const phase = age / MONTH;
	const labels = [
		"New moon",
		"Waxing crescent",
		"First quarter",
		"Waxing gibbous",
		"Full moon",
		"Waning gibbous",
		"Last quarter",
		"Waning crescent",
	];
	return {
		age,
		phase,
		illumination: (1 - Math.cos(2 * Math.PI * phase)) / 2,
		label: labels[Math.round(phase * 8) % 8],
	};
}
export function moonSvg(phase: number) {
	const r = 139,
		c = 200,
		cosine = Math.cos(phase * Math.PI * 2),
		waxing = phase < 0.5;
	const points: string[] = [];
	for (let y = -r; y <= r; y += 1) {
		const x = Math.sqrt(Math.max(0, r * r - y * y));
		points.push(`${c + (waxing ? cosine : -cosine) * x},${c + y}`);
	}
	for (let y = r; y >= -r; y -= 1) {
		const x = Math.sqrt(Math.max(0, r * r - y * y));
		points.push(`${c + (waxing ? x : -x)},${c + y}`);
	}
	const random = seededRandom(142);
	const dots = Array.from({ length: 440 }, () => {
		const x = 70 + random() * 260,
			y = 70 + random() * 260;
		return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.35 + random() * 1.1).toFixed(1)}" fill="black"/>`;
	}).join("");
	const marks = Array.from({ length: 60 }, (_, i) => {
		const a = (i / 60) * Math.PI * 2;
		return `<path d="M${200 + Math.sin(a) * 168},${200 + Math.cos(a) * 168}L${200 + Math.sin(a) * (i % 5 ? 171 : 175)},${200 + Math.cos(a) * (i % 5 ? 171 : 175)}" stroke="black"/>`;
	}).join("");
	return svgDocument(
		`<defs><clipPath id="lit"><polygon points="${points.join(" ")}"/></clipPath></defs><circle cx="200" cy="200" r="139" fill="black"/><polygon points="${points.join(" ")}" fill="white"/><g clip-path="url(#lit)">${dots}<circle cx="165" cy="160" r="22" fill="none" stroke="black" stroke-width=".7"/><circle cx="236" cy="248" r="12" fill="none" stroke="black" stroke-width=".8"/></g><circle cx="200" cy="200" r="139" fill="none" stroke="black"/>${marks}`,
	);
}
export function MoonAlmanac(
	props: RecipeRenderProps & { params: z.infer<typeof paramsSchema> },
) {
	const date = editionDate(props.params),
		moon = moonPhase(new Date(`${date}T12:00:00Z`));
	return (
		<DailyArtLayout
			{...props}
			date={date}
			series="THE MOON ALMANAC"
			title={moon.label}
			subtitle={`${Math.round(moon.illumination * 100)}% illuminated · day ${moon.age.toFixed(1)}`}
			note="A study of light and shadow. Approximate mean-cycle phase at noon UTC; the disc is a stylized illustration."
			svg={moonSvg(moon.phase)}
		/>
	);
}
export const definition: RecipeDefinition<typeof paramsSchema> = {
	meta: {
		slug: "moon-almanac",
		title: "Moon almanac",
		description:
			"A quiet daily lunar print with an engraved disc and approximate phase. Works offline.",
		published: true,
		category: "art",
		tags: ["moon", "daily", "art"],
		version: "1.0.0",
		renderSettings: { imageDither: false, supersample: false },
	},
	paramsSchema,
	dataSchema,
	Component: MoonAlmanac,
};
