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
const studies = [
	{
		title: "The fern",
		subtitle: "A rhythm of small, unfolding leaves.",
		type: "fern",
	},
	{
		title: "Meadow stems",
		subtitle: "The delicate architecture of a seed head.",
		type: "grass",
	},
	{
		title: "A flowering sprig",
		subtitle: "Five petals, held briefly in balance.",
		type: "flower",
	},
] as const;
export function botanicalStudy(date: string) {
	const seed = dailySeed(date),
		study = studies[seed % studies.length],
		random = seededRandom(seed);
	let drawing =
		'<path d="M194 359Q215 233 204 53" fill="none" stroke="black" stroke-width="2"/>';
	if (study.type === "fern") {
		for (let i = 0; i < 14; i++) {
			const y = 320 - i * 18,
				spread = Math.sin(((i + 2) / 17) * Math.PI) * 120;
			for (const sign of [-1, 1]) {
				const x = 204 + sign * spread;
				drawing += `<path d="M204 ${y}Q${204 + sign * spread * 0.5} ${y - 40} ${x} ${y - 32}Q${204 + sign * spread * 0.7} ${y + 1} 204 ${y}" fill="white" stroke="black" stroke-width="1.8"/><path d="M204 ${y}L${x} ${y - 32}" stroke="black" stroke-width="1.6"/>`;
				for (let j = 1; j < 8; j++) {
					const fraction = j / 8;
					drawing += `<path d="M${204 + sign * spread * fraction} ${y - 32 * fraction}l${sign * 7} -9" stroke="black" stroke-width="1.5"/>`;
				}
			}
		}
	} else if (study.type === "grass") {
		for (let i = 0; i < 9; i++) {
			const x = 65 + i * 33,
				y = 75 + random() * 95;
			drawing += `<path d="M194 359Q${x + 20} 230 ${x} ${y}" fill="none" stroke="black" stroke-width="1.4"/>`;
			for (let j = 0; j < 9; j++)
				for (const sign of [-1, 1])
					drawing += `<ellipse cx="${x + sign * 6}" cy="${y + j * 9}" rx="3" ry="8" transform="rotate(${sign * -30} ${x + sign * 6} ${y + j * 9})" fill="white" stroke="black" stroke-width="1.6"/>`;
		}
	} else {
		for (let i = 0; i < 5; i++) {
			const x = 100 + random() * 200,
				y = 80 + i * 42;
			drawing += `<path d="M200 ${y + 85}Q${x} ${y + 70} ${x} ${y}" fill="none" stroke="black" stroke-width="1.4"/>`;
			for (let p = 0; p < 5; p++)
				drawing += `<ellipse cx="${x}" cy="${y - 15}" rx="10" ry="18" transform="rotate(${p * 72} ${x} ${y})" fill="white" stroke="black" stroke-width="1.4"/>`;
			drawing += `<circle cx="${x}" cy="${y}" r="7" fill="black"/>`;
		}
		for (let i = 0; i < 5; i++) {
			const y = 225 + i * 23,
				sign = i % 2 ? 1 : -1;
			drawing += `<path d="M200 ${y}q${sign * 75} -65 ${sign * 87} -40q${-sign * 10} 42 ${-sign * 87} 40Z" fill="white" stroke="black" stroke-width="1.6"/><path d="M200 ${y}l${sign * 79} -38" stroke="black" stroke-width="1.6"/>`;
		}
	}
	return {
		...study,
		svg: svgDocument(
			`${drawing}<path d="M64 369h70M64 365v8M99 366v6M134 365v8" stroke="black" stroke-width="1.6"/>`,
		),
	};
}
export function BotanicalPlate(
	props: RecipeRenderProps & { params: z.infer<typeof paramsSchema> },
) {
	const date = editionDate(props.params),
		study = botanicalStudy(date);
	return (
		<DailyArtLayout
			{...props}
			date={date}
			series="THE BOTANICAL CABINET"
			title={study.title}
			subtitle={study.subtitle}
			note="An imagined specimen, drawn anew each day. A decorative field study of branching, repetition and growth."
			svg={study.svg}
		/>
	);
}
export const definition: RecipeDefinition<typeof paramsSchema> = {
	meta: {
		slug: "botanical-plate",
		title: "Botanical plate",
		description:
			"Daily pen-and-ink botanical studies: fern, meadow and flowering sprig. No external images required.",
		published: true,
		category: "art",
		tags: ["botanical", "daily", "art"],
		version: "1.0.0",
		renderSettings: {
			imageDither: false,
			supersample: false,
			cacheSeconds: 86400,
		},
	},
	getRenderCacheKey: (params) => editionDate(params),
	paramsSchema,
	dataSchema,
	Component: BotanicalPlate,
};
