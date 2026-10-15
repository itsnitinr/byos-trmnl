import { z } from "zod";
import {
	ScreenCanvas,
	screenFontSize,
	screenMetric,
} from "@/components/trmnl/screen-layout";
import { dailyArtParams, editionDate } from "@/lib/recipes/art/daily";
import type { RecipeDefinition, RecipeRenderProps } from "@/lib/recipes/types";
import { createScreenProfile } from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";
import { generatePrint } from "./artwork";

export const paramsSchema = dailyArtParams.extend({
	style: z
		.enum(["daily", "contours", "orbits", "tiles"])
		.default("daily")
		.describe("Rotate styles each day, or choose a single style")
		.meta({ title: "Print style" }),
	seed: z
		.string()
		.max(64)
		.default("")
		.describe("Optional word or number for your own variation of each edition")
		.meta({ title: "Personal seed" }),
});
export const dataSchema = paramsSchema;

export function GenerativePrint({
	width = 800,
	height = 480,
	screen = createScreenProfile({ width, height }),
	params,
}: RecipeRenderProps & { params: z.infer<typeof paramsSchema> }) {
	const date = editionDate(params);
	const compact = screen.isCompact || screen.isHalfScreen;
	const padding = screenMetric(screen, compact ? 18 : 26);
	const gap = screenMetric(screen, 14);
	const headerHeight = screenMetric(screen, 26);
	const footerHeight = screenMetric(screen, compact ? 58 : 64);
	const artWidth = Math.max(1, screen.logicalWidth - padding * 2);
	const artHeight = Math.max(
		1,
		screen.logicalHeight - padding * 2 - headerHeight - footerHeight - gap * 2,
	);
	const print = generatePrint({
		...params,
		date,
		width: artWidth,
		height: artHeight,
	});

	return (
		<PreSatori width={screen.logicalWidth} height={screen.logicalHeight}>
			<ScreenCanvas
				className="font-inter"
				screen={screen}
				style={{ padding, gap, fontFamily: "inter" }}
			>
				<div
					className="font-inter"
					style={{
						display: "flex",
						flexShrink: 0,
						height: headerHeight,
						justifyContent: "space-between",
						alignItems: "center",
						fontSize: screenFontSize(screen, 16),
						fontWeight: 600,
						letterSpacing: 2,
					}}
				>
					<span className="font-inter">GENERATIVE PRINT</span>
					{!compact && <span className="font-inter">No. {print.number}</span>}
				</div>
				{/* Native SVG image data keeps the same geometry in browser and device renderers. */}
				<img
					src={`data:image/svg+xml,${encodeURIComponent(print.svg)}`}
					alt={`${print.title} — generative ${print.style} artwork`}
					width={artWidth}
					height={artHeight}
					style={{ flexShrink: 0 }}
				/>
				{/* A monochrome print colophon replaces dashboard footer chrome for this art series. */}
				<div
					className="font-inter"
					style={{
						display: "flex",
						flexShrink: 0,
						height: footerHeight,
						flexDirection: "column",
						justifyContent: "space-between",
						borderTop: `${screenMetric(screen, 2)}px solid black`,
						paddingTop: screenMetric(screen, 8),
					}}
				>
					<div
						className="font-inter"
						style={{
							display: "flex",
							fontSize: screenFontSize(screen, 26),
							lineHeight: 1,
							fontWeight: 600,
						}}
					>
						{print.title}
					</div>
					<div
						className="font-inter"
						style={{
							display: "flex",
							justifyContent: "space-between",
							fontSize: screenFontSize(screen, 16),
							lineHeight: 1,
						}}
					>
						<span className="font-inter">{date.replaceAll("-", " / ")}</span>
						<span className="font-inter">
							{compact ? `No. ${print.number}` : "An edition in black & white"}
						</span>
					</div>
				</div>
			</ScreenCanvas>
		</PreSatori>
	);
}

export const definition: RecipeDefinition<typeof paramsSchema> = {
	meta: {
		slug: "generative-print",
		title: "Generative print",
		description:
			"A daily series of contour fields, orbital lines and geometric tiles. Choose a style, add a personal seed, or pin a favorite date. No external services required.",
		published: true,
		category: "art",
		tags: ["generative", "geometric", "daily", "art"],
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
	Component: GenerativePrint,
};
