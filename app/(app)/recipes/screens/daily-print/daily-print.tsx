import type { z } from "zod";
import {
	dailyArtParams,
	dailySeed,
	editionDate,
	seededRandom,
	svgDocument,
} from "@/lib/recipes/art/daily";
import { DailyArtLayout } from "@/lib/recipes/art/layout";
import type { RecipeDefinition, RecipeRenderProps } from "@/lib/recipes/types";
export const paramsSchema = dailyArtParams;
export const dataSchema = paramsSchema;
export function dailyPrint(date: string) {
	const seed = dailySeed(`contours:${date}`),
		random = seededRandom(seed);
	const wave = random() * Math.PI * 2,
		frequency = 2 + random() * 3,
		tilt = random() * 1.2 - 0.6;
	const title = [
		"Tidal memory",
		"Soft terrain",
		"Lines of quiet",
		"A passing current",
		"Folded horizon",
	][seed % 5];
	const paths = Array.from({ length: 45 }, (_, line) => {
		const points = Array.from({ length: 111 }, (_, step) => {
			const x = 35 + step * 3,
				envelope = Math.sin((step / 110) * Math.PI);
			const y =
				51 +
				line * 6.8 +
				Math.sin((x / 100) * frequency + wave + line * 0.08) * envelope * 23 +
				Math.sin(line * 0.11 + wave) * envelope * 18 +
				tilt * (x - 200) * 0.15;
			return `${step ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
		}).join("");
		return `<path d="${points}" fill="none" stroke="black" stroke-width="${line % 7 ? 1.8 : 2.2}"/>`;
	}).join("");
	return {
		title,
		number: String(seed % 10000).padStart(4, "0"),
		svg: svgDocument(paths),
	};
}
export function DailyPrint(
	props: RecipeRenderProps & { params: z.infer<typeof paramsSchema> },
) {
	const date = editionDate(props.params),
		print = dailyPrint(date);
	return (
		<DailyArtLayout
			{...props}
			date={date}
			series="THE DAILY PRINT"
			title={print.title}
			subtitle={`Study ${print.number} / forty-five lines`}
			note="A landscape without a place. The date becomes a seed; the same day always returns the same drawing."
			svg={print.svg}
		/>
	);
}
export const definition: RecipeDefinition<typeof paramsSchema> = {
	meta: {
		slug: "daily-print",
		title: "Daily print",
		description:
			"A new deterministic contour drawing each day, composed for monochrome e-ink.",
		published: true,
		category: "art",
		tags: ["generative", "daily", "art"],
		version: "1.0.0",
		renderSettings: { imageDither: false, supersample: false },
	},
	paramsSchema,
	dataSchema,
	Component: DailyPrint,
};
