import { z } from "zod";
import {
	MIN_SCREEN_BODY_FONT_SIZE,
	ScreenCanvas,
	ScreenFooter,
	screenFontSize,
	screenMetric,
} from "@/components/trmnl/screen-layout";
import {
	DEFAULT_IMAGE_HEIGHT,
	DEFAULT_IMAGE_WIDTH,
} from "@/lib/recipes/constants";
import type { RecipeDefinition } from "@/lib/recipes/types";
import {
	createScreenProfile,
	type ScreenProfile,
} from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";
import getSunriseSunsetData, { type SunriseSunsetData } from "./getData";

export const paramsSchema = z.object({
	location: z
		.string()
		.default("Bengaluru")
		.describe("City or place name to compute the sun's path for")
		.meta({ title: "Location", placeholder: "Bengaluru" }),
	latitude: z
		.number()
		.default(0)
		.describe(
			"Optional exact latitude; when set with longitude, skips geocoding",
		)
		.meta({ title: "Latitude" }),
	longitude: z
		.number()
		.default(0)
		.describe(
			"Optional exact longitude; when set with latitude, skips geocoding",
		)
		.meta({ title: "Longitude" }),
	// Kept plain strings rather than enums because the params form only renders
	// string/number/boolean fields; anything else is dropped silently. `getData`
	// normalizes them, so an unrecognized value falls back to the default.
	timezone: z
		.string()
		.default("")
		.describe(
			"IANA timezone the times are read in. Empty follows the location.",
		)
		.meta({ title: "Timezone", placeholder: "Europe/Amsterdam" }),
	timeFormat: z
		.string()
		.default("24h")
		.describe('Clock format: "24h" or "12h"')
		.meta({ title: "Time format", placeholder: "24h" }),
	label: z
		.string()
		.default("Sunrise & Sunset")
		.describe("Text shown on the left of the footer bar")
		.meta({ title: "Footer label", placeholder: "Sunrise & Sunset" }),
});

export const dataSchema = z.object({
	locationName: z.string().default(""),
	timezone: z.string().default(""),
	sunrise: z.string().default("None"),
	sunset: z.string().default("None"),
	dawn: z.string().default("None"),
	solarNoon: z.string().default("None"),
	dusk: z.string().default("None"),
	samples: z.array(z.number()).default([]),
	dawnFraction: z.number().nullable().default(null),
	duskFraction: z.number().nullable().default(null),
	nowFraction: z.number().default(0),
	error: z.string().optional(),
});

interface SunriseSunsetProps extends Partial<SunriseSunsetData> {
	label?: string;
	width?: number;
	height?: number;
	screen?: ScreenProfile;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Share of the plot the sun's arc gets. What is left is the night below the
 * horizon line, which only has to read as "below" — the arc is the subject.
 */
const HORIZON_POSITION = 0.66;

/**
 * Rough advance width of a glyph in ems, used to size a number to the column it
 * has to fit. Only digits, colons, spaces and AM/PM ever reach it.
 */
function textEms(text: string): number {
	let ems = 0;
	for (const character of text) {
		if (character === ":") ems += 0.3;
		else if (character === " ") ems += 0.28;
		else if (character >= "0" && character <= "9") ems += 0.6;
		else ems += 0.66;
	}
	return ems;
}

/**
 * Largest type size at which every one of `values` still fits `width`, capped
 * by what the screen has the height for. The times are the screen, so they are
 * sized to the column they sit in rather than to the device — a portrait panel
 * has the width for large type even though its `screenMetric` scale is small.
 */
function fittedFontSize(
	values: string[],
	width: number,
	ceiling: number,
): number {
	const widest = Math.max(1, ...values.map(textEms));
	return Math.max(12, Math.min(ceiling, Math.floor(width / widest)));
}

/**
 * SVG is handed to the renderer as an `<img>` data URL rather than inline
 * markup, the same way `components/common/graph.tsx` does it — Satori and
 * Takumi both rasterize images, but neither lays out inline SVG children.
 */
function svgUrl(body: string, width: number, height: number): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Diagonal hatch drawn as three strokes per tile — the tile's own diagonal plus
 * the two corner stubs that continue it into the neighbouring tiles. Written
 * out rather than rotated with `patternTransform`, which not every rasterizer
 * in the render path handles the same way.
 */
function hatchPattern(gap: number, stroke: number): string {
	const half = gap / 2;
	return `<pattern id="hatch" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse"><path d="M0 ${gap}L${gap} 0M${-half} ${half}L${half} ${-half}M${half} ${gap + half}L${gap + half} ${half}" stroke="#000" stroke-width="${stroke}" fill="none"/></pattern>`;
}

type CurveNode = { x: number; y: number; elevation: number };

function linePath(nodes: CurveNode[]): string {
	return nodes
		.map(
			(node, index) =>
				`${index === 0 ? "M" : "L"}${round2(node.x)} ${round2(node.y)}`,
		)
		.join("");
}

/** The nodes of one stretch of curve, closed down onto the horizon line. */
function areaPath(nodes: CurveNode[], horizonY: number): string {
	const first = nodes[0];
	const last = nodes[nodes.length - 1];
	return `${linePath(nodes)}L${round2(last.x)} ${horizonY}L${round2(first.x)} ${horizonY}Z`;
}

/**
 * Splits the curve into the stretches that sit on one side of the horizon.
 * Horizon crossings carry an elevation of exactly 0 and so belong to the
 * stretch on either side of them, which is what closes both areas cleanly.
 */
function horizonRuns(nodes: CurveNode[], above: boolean): CurveNode[][] {
	const runs: CurveNode[][] = [];
	let current: CurveNode[] = [];
	for (const node of nodes) {
		const inside = above ? node.elevation >= 0 : node.elevation <= 0;
		if (inside) {
			current.push(node);
		} else {
			if (current.length > 1) runs.push(current);
			current = [];
		}
	}
	if (current.length > 1) runs.push(current);
	return runs;
}

function buildChart({
	samples,
	nowFraction,
	dawnFraction,
	duskFraction,
	width,
	height,
	curveWidth,
	ruleWidth,
	dotRadius,
	hatchGap,
}: {
	samples: number[];
	nowFraction: number;
	dawnFraction: number | null;
	duskFraction: number | null;
	width: number;
	height: number;
	curveWidth: number;
	ruleWidth: number;
	dotRadius: number;
	hatchGap: number;
}): string {
	const maxElevation = Math.max(...samples);
	const minElevation = Math.min(...samples);
	const topPad = Math.ceil(curveWidth);
	const bottomPad = Math.ceil(curveWidth);

	// Day and night get their own scale so the arc always fills the frame. They
	// stay equal while the night fits, and the night is only compressed when a
	// winter midnight would otherwise run off the bottom of the plot. Inside the
	// polar circles one of the two sides is empty, and the horizon moves to the
	// edge of the plot so the other side gets all of it.
	let horizonY = Math.round(height * HORIZON_POSITION);
	if (minElevation >= 0) horizonY = height - bottomPad; // the sun never sets
	if (maxElevation <= 0) horizonY = topPad; // and here it never rises
	const dayFit = maxElevation > 0 ? (horizonY - topPad) / maxElevation : 0;
	const nightFit =
		minElevation < 0 ? (height - bottomPad - horizonY) / -minElevation : 0;
	const dayScale = dayFit || nightFit;
	const nightScale =
		dayFit > 0 && nightFit > 0
			? Math.min(dayFit, nightFit)
			: dayFit || nightFit;

	const xOf = (index: number) => (index / (samples.length - 1)) * width;
	const yOf = (elevation: number) =>
		elevation >= 0
			? horizonY - elevation * dayScale
			: horizonY - elevation * nightScale;

	const nodes: CurveNode[] = [];
	samples.forEach((elevation, index) => {
		const previous = samples[index - 1];
		if (
			index > 0 &&
			((previous < 0 && elevation > 0) || (previous > 0 && elevation < 0))
		) {
			const ratio = -previous / (elevation - previous);
			nodes.push({
				x: xOf(index - 1 + ratio),
				y: horizonY,
				elevation: 0,
			});
		}
		nodes.push({ x: xOf(index), y: yOf(elevation), elevation });
	});

	// The sun's own position is put on the curve as a node, so the filled past
	// and the dotted future meet exactly under the marker.
	const position = nowFraction * (samples.length - 1);
	const before = Math.min(Math.floor(position), samples.length - 2);
	const nowElevation =
		samples[before] +
		(samples[before + 1] - samples[before]) * (position - before);
	const nowNode: CurveNode = {
		x: nowFraction * width,
		y: yOf(nowElevation),
		elevation: nowElevation,
	};
	const nowIndex = Math.max(
		1,
		nodes.findIndex((node) => node.x > nowNode.x),
	);
	nodes.splice(nowIndex, 0, nowNode);

	const past = nodes.slice(0, nowIndex + 1);
	const future = nodes.slice(nowIndex);

	const daylight = horizonRuns(past, true)
		.map(
			(run) =>
				`<path d="${areaPath(run, horizonY)}" fill="url(#hatch)" stroke="none"/>`,
		)
		.join("");
	const night = horizonRuns(past, false)
		.map(
			(run) =>
				`<path d="${areaPath(run, horizonY)}" fill="#000" stroke="none"/>`,
		)
		.join("");

	const twilightRules = [dawnFraction, duskFraction]
		.filter((fraction): fraction is number => fraction !== null)
		.map(
			(fraction) =>
				`<line x1="${round2(fraction * width)}" x2="${round2(fraction * width)}" y1="0" y2="${horizonY}" stroke="#000" stroke-width="${ruleWidth}" stroke-linecap="round" stroke-dasharray="0.01 ${ruleWidth * 3}"/>`,
		)
		.join("");

	const horizon = `<line x1="0" x2="${width}" y1="${horizonY}" y2="${horizonY}" stroke="#000" stroke-width="${ruleWidth}"/>`;

	const travelled = `<path d="${linePath(past)}" fill="none" stroke="#000" stroke-width="${curveWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
	const remaining = `<path d="${linePath(future)}" fill="none" stroke="#000" stroke-width="${curveWidth}" stroke-linecap="round" stroke-dasharray="0.01 ${curveWidth * 2.2}"/>`;

	const sun = `<circle cx="${round2(nowNode.x)}" cy="${round2(nowNode.y)}" r="${dotRadius}" fill="#000"/>`;

	return svgUrl(
		`<defs>${hatchPattern(hatchGap, Math.max(1, curveWidth / 3))}</defs>${daylight}${night}${horizon}${twilightRules}${travelled}${remaining}${sun}`,
		width,
		height,
	);
}

/** One label sitting above its time, used by both the hero pair and the row. */
function TimeStat({
	label,
	value,
	width,
	labelSize,
	valueSize,
	gap,
}: {
	label: string;
	value: string;
	width: number;
	labelSize: number;
	valueSize: number;
	gap: number;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				flex: "none",
				width,
				alignItems: "center",
				gap,
			}}
		>
			<div
				style={{
					display: "flex",
					fontFamily: "Inter, sans-serif",
					fontSize: labelSize,
					lineHeight: 1,
				}}
			>
				{label}
			</div>
			<div
				style={{
					display: "flex",
					fontFamily: "Inter, sans-serif",
					fontSize: valueSize,
					lineHeight: 1.1,
				}}
			>
				{value}
			</div>
		</div>
	);
}

export default function SunriseSunset({
	locationName = "",
	sunrise = "None",
	sunset = "None",
	dawn = "None",
	solarNoon = "None",
	dusk = "None",
	samples = [],
	dawnFraction = null,
	duskFraction = null,
	nowFraction = 0,
	error,
	label = "Sunrise & Sunset",
	width = DEFAULT_IMAGE_WIDTH,
	height = DEFAULT_IMAGE_HEIGHT,
	screen,
}: SunriseSunsetProps) {
	const screenProfile = screen ?? createScreenProfile({ width, height });
	const compact = screenProfile.isCompact || screenProfile.isHalfScreen;

	const pad = screenMetric(screenProfile, compact ? 14 : 20);
	const gap = screenMetric(screenProfile, compact ? 10 : 16);
	const footerHeight = screenMetric(screenProfile, compact ? 32 : 40);
	const canvasWidth = screenProfile.logicalWidth - pad * 2;

	const available =
		screenProfile.logicalHeight - pad * 2 - footerHeight - gap * 2;

	// Type is sized to the column it has to fit and then held back by the height
	// the canvas can spare. Each label follows its own value, so the pairs keep
	// their proportions on every screen.
	const heroColumn = Math.floor((canvasWidth - gap) / 2);
	const heroValueSize = fittedFontSize(
		[sunrise, sunset],
		heroColumn * 0.86,
		Math.round(available * 0.21),
	);
	const heroLabelSize = Math.max(
		MIN_SCREEN_BODY_FONT_SIZE,
		Math.round(heroValueSize * 0.3),
	);
	const heroGap = Math.round(heroValueSize * 0.09);
	const heroHeight = Math.round(
		heroValueSize * 1.15 + heroLabelSize * 1.2 + heroGap,
	);

	const rowColumn = Math.floor((canvasWidth - gap * 2) / 3);
	const rowValueSize = fittedFontSize(
		[dawn, solarNoon, dusk],
		rowColumn * 0.85,
		Math.round(available * 0.105),
	);
	const rowLabelSize = Math.max(
		MIN_SCREEN_BODY_FONT_SIZE,
		Math.round(rowValueSize * 0.45),
	);
	const rowGap = Math.round(rowValueSize * 0.1);
	const rowHeight = Math.round(
		rowValueSize * 1.15 + rowLabelSize * 1.2 + rowGap,
	);

	// A tall panel would stretch the arc into a spike, so past a landscape-ish
	// plot the extra height is split with the layout: half to the arc, half left
	// as air that `space-between` on the canvas spreads between the bands.
	const remaining = available - heroHeight - rowHeight;
	const naturalChart = Math.round(canvasWidth * 0.5);
	const chartHeight = Math.max(
		screenMetric(screenProfile, 60),
		remaining <= naturalChart
			? remaining
			: naturalChart + Math.round((remaining - naturalChart) * 0.5),
	);

	const chart =
		samples.length > 1
			? buildChart({
					samples,
					nowFraction,
					dawnFraction,
					duskFraction,
					width: canvasWidth,
					height: chartHeight,
					curveWidth: screenMetric(screenProfile, 3),
					ruleWidth: screenMetric(screenProfile, 2),
					dotRadius: screenMetric(screenProfile, compact ? 6 : 8),
					hatchGap: screenMetric(screenProfile, 7),
				})
			: null;

	return (
		<PreSatori
			width={screenProfile.logicalWidth}
			height={screenProfile.logicalHeight}
		>
			<ScreenCanvas
				screen={screenProfile}
				style={{ padding: pad, gap, justifyContent: "space-between" }}
			>
				{error || !chart ? (
					<div
						style={{
							display: "flex",
							flex: 1,
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							gap: screenMetric(screenProfile, 10),
						}}
					>
						<div
							className="font-inter"
							style={{
								display: "flex",
								fontFamily: "Inter, sans-serif",
								fontSize: screenFontSize(screenProfile, compact ? 26 : 40),
								lineHeight: 1,
							}}
						>
							No sun data
						</div>
						<div
							className="font-inter"
							style={{
								display: "flex",
								fontFamily: "Inter, sans-serif",
								fontSize: screenFontSize(
									screenProfile,
									compact ? 16 : 20,
									MIN_SCREEN_BODY_FONT_SIZE,
								),
								lineHeight: 1,
							}}
						>
							{error ?? "Sun times unavailable"}
						</div>
					</div>
				) : (
					<>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								flex: "none",
								height: heroHeight,
								width: canvasWidth,
								alignItems: "center",
								justifyContent: "space-between",
								gap,
							}}
						>
							<TimeStat
								label="Sunrise"
								value={sunrise}
								width={heroColumn}
								labelSize={heroLabelSize}
								valueSize={heroValueSize}
								gap={heroGap}
							/>
							<TimeStat
								label="Sunset"
								value={sunset}
								width={heroColumn}
								labelSize={heroLabelSize}
								valueSize={heroValueSize}
								gap={heroGap}
							/>
						</div>

						<div
							style={{
								display: "flex",
								flex: "none",
								width: canvasWidth,
								height: chartHeight,
							}}
						>
							{/* Satori and Takumi do not support the Next.js Image
							    component, so the arc is a plain img. */}
							<img
								src={chart}
								alt="Path of the sun through the day"
								width={canvasWidth}
								height={chartHeight}
								style={{ display: "block" }}
							/>
						</div>

						<div
							style={{
								display: "flex",
								flexDirection: "row",
								flex: "none",
								height: rowHeight,
								width: canvasWidth,
								alignItems: "center",
								justifyContent: "space-between",
								gap,
							}}
						>
							<TimeStat
								label="Dawn"
								value={dawn}
								width={rowColumn}
								labelSize={rowLabelSize}
								valueSize={rowValueSize}
								gap={rowGap}
							/>
							<TimeStat
								label="Solar noon"
								value={solarNoon}
								width={rowColumn}
								labelSize={rowLabelSize}
								valueSize={rowValueSize}
								gap={rowGap}
							/>
							<TimeStat
								label="Dusk"
								value={dusk}
								width={rowColumn}
								labelSize={rowLabelSize}
								valueSize={rowValueSize}
								gap={rowGap}
							/>
						</div>
					</>
				)}

				<ScreenFooter
					screen={screenProfile}
					left={label}
					right={locationName}
					style={{ height: footerHeight }}
				/>
			</ScreenCanvas>
		</PreSatori>
	);
}

export const definition: RecipeDefinition<
	typeof paramsSchema,
	typeof dataSchema
> = {
	meta: {
		slug: "sunrise-sunset",
		title: "Sunrise & Sunset",
		description:
			"Today's sunrise and sunset over the sun's path through the sky, with dawn, solar noon and dusk. Sun positions are computed on the server; only the location lookup needs the network, and no API key.",
		published: true,
		tags: ["tailwind", "sun", "daylight", "astronomy", "configurable"],
		author: { name: "Nitin Ranganath", github: "itsnitinr" },
		category: "display-components",
		version: "0.1.0",
		createdAt: "2026-09-07T00:00:00Z",
		updatedAt: "2026-09-07T00:00:00Z",
	},
	paramsSchema,
	dataSchema,
	getData: async (params) => {
		const data = await getSunriseSunsetData({
			location: params.location,
			latitude: params.latitude,
			longitude: params.longitude,
			timezone: params.timezone,
			timeFormat: params.timeFormat,
		});
		return data as z.infer<typeof dataSchema>;
	},
	Component: ({ width, height, screen, params, data }) => (
		<SunriseSunset
			{...(data as SunriseSunsetData)}
			label={params?.label}
			width={width}
			height={height}
			screen={screen}
		/>
	),
};
