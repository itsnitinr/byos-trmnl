import * as d3 from "d3";
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
import getAirQualityData, {
	type AirQualityData,
	type AirQualityGauge,
	type AirQualitySample,
	UNIT,
} from "./getData";

export const paramsSchema = z.object({
	location: z
		.string()
		.default("Bengaluru")
		.describe("City or place name to fetch air quality for")
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
	// normalizes both, so an unrecognized value falls back to the default.
	standard: z
		.string()
		.default("us")
		.describe('Index scale the dial categories come from: "us" or "european"')
		.meta({ title: "AQI standard", placeholder: "us" }),
	pollutant: z
		.string()
		.default("pm2_5")
		.describe('Pollutant plotted on the chart: "pm2_5" or "pm10"')
		.meta({ title: "Charted pollutant", placeholder: "pm2_5" }),
});

const gaugeSchema = z.object({
	key: z.enum(["pm2_5", "pm10"]),
	label: z.string(),
	value: z.number(),
	category: z.string(),
	scaleMax: z.number(),
});

const sampleSchema = z.object({
	time: z.string(),
	value: z.number(),
});

export const dataSchema = z.object({
	locationName: z.string().default(""),
	updatedLabel: z.string().default(""),
	standard: z.enum(["us", "european"]).default("us"),
	gauges: z.array(gaugeSchema).default([]),
	series: z.array(sampleSchema).default([]),
	nowIndex: z.number().default(0),
	chartLabel: z.string().default("PM 2.5"),
	error: z.string().optional(),
});

interface AirQualityProps extends Partial<AirQualityData> {
	width?: number;
	height?: number;
	screen?: ScreenProfile;
}

/** Dial geometry: a 270° sweep opening at the bottom, 0 on the left. */
const RING_START = -135;
const RING_SWEEP = 270;
/** Ticks around the dial. Seven gaps keep the labels on round numbers. */
const RING_TICKS = 8;
/**
 * The unfilled part of the dial is a checkerboard rather than a gray fill. A
 * flat gray leaves the palette pass to invent the texture, and error diffusion
 * across a curved band comes out as banding; drawing the stipple ourselves
 * keeps it even at any size and survives palette reduction untouched.
 */
const TRACK_PATTERN = `<pattern id="track" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="#000"/><rect x="1" y="1" width="1" height="1" fill="#000"/></pattern>`;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Point on a circle, measuring clockwise from twelve o'clock. */
function polar(center: number, radius: number, angle: number) {
	const radians = (angle * Math.PI) / 180;
	return {
		x: center + radius * Math.sin(radians),
		y: center - radius * Math.cos(radians),
	};
}

function arcPath(center: number, radius: number, from: number, to: number) {
	const start = polar(center, radius, from);
	const end = polar(center, radius, to);
	const largeArc = Math.abs(to - from) > 180 ? 1 : 0;
	return `M${round2(start.x)} ${round2(start.y)}A${round2(radius)} ${round2(radius)} 0 ${largeArc} 1 ${round2(end.x)} ${round2(end.y)}`;
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

function ringUrl(size: number, stroke: number, fraction: number): string {
	const center = size / 2;
	const radius = (size - stroke) / 2;
	const track = `<defs>${TRACK_PATTERN}</defs><path d="${arcPath(center, radius, RING_START, RING_START + RING_SWEEP)}" fill="none" stroke="url(#track)" stroke-width="${stroke}" stroke-linecap="round"/>`;
	// Below about half a degree the two endpoints coincide and the arc is
	// undefined; the round cap alone still reads as "barely any".
	const filled =
		fraction > 0.002
			? `<path d="${arcPath(center, radius, RING_START, RING_START + RING_SWEEP * fraction)}" fill="none" stroke="#000" stroke-width="${stroke}" stroke-linecap="round"/>`
			: "";
	return svgUrl(`${track}${filled}`, size, size);
}

type ChartGeometry = {
	url: string;
	xOf: (index: number) => number;
	yOf: (value: number) => number;
	yTicks: number[];
	xTicks: Array<{ index: number; label: string }>;
};

/** Rounds a domain out to whole steps so the axis reads 10/20/30 and the
 *  line keeps headroom instead of touching the frame. */
function niceDomain(min: number, max: number, tickCount: number) {
	const span = Math.max(1, max - min);
	const rough = span / Math.max(1, tickCount - 1);
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const step =
		[1, 2, 2.5, 5, 10]
			.map((factor) => factor * magnitude)
			.find((candidate) => candidate >= rough) ?? magnitude * 10;
	return {
		lo: Math.floor(min / step) * step,
		hi: Math.ceil(max / step) * step,
		step,
	};
}

/** "2026-05-23T04:00" -> "04:00 AM", or "May 23" at midnight. */
function axisLabel(isoLocal: string): string {
	const hour = Number(isoLocal.slice(11, 13));
	if (hour === 0) {
		const month = MONTH_NAMES[Number(isoLocal.slice(5, 7)) - 1] ?? "";
		return `${month} ${Number(isoLocal.slice(8, 10))}`;
	}
	const suffix = hour < 12 ? "AM" : "PM";
	const twelve = hour % 12 === 0 ? 12 : hour % 12;
	return `${String(twelve).padStart(2, "0")}:00 ${suffix}`;
}

const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function buildChart({
	series,
	nowIndex,
	width,
	height,
	lineWidth,
	hourStep,
}: {
	series: AirQualitySample[];
	nowIndex: number;
	width: number;
	height: number;
	lineWidth: number;
	hourStep: number;
}): ChartGeometry {
	const values = series.map((sample) => sample.value);
	const domain = niceDomain(Math.min(...values), Math.max(...values), 5);

	const x = d3
		.scaleLinear()
		.domain([0, Math.max(1, series.length - 1)])
		.range([0, width]);
	const y = d3.scaleLinear().domain([domain.lo, domain.hi]).range([height, 0]);

	const yTicks: number[] = [];
	for (let tick = domain.lo; tick <= domain.hi + 1e-6; tick += domain.step) {
		yTicks.push(Math.round(tick * 100) / 100);
	}

	// Ticks are taken from the series itself rather than from the scale, so every
	// label sits on a real hour of the feed and midnight always gets its date.
	const xTicks = series
		.map((sample, index) => ({ sample, index }))
		.filter(({ index }) => index % hourStep === 0)
		.map(({ sample, index }) => ({ index, label: axisLabel(sample.time) }));

	const line = d3
		.line<number>()
		.x((_, index) => x(index))
		.y((value) => y(value))
		.curve(d3.curveMonotoneX);

	const grid = [
		...yTicks.map(
			(tick) =>
				`<line x1="0" x2="${width}" y1="${round2(y(tick))}" y2="${round2(y(tick))}" stroke="#000" stroke-width="1" stroke-dasharray="1 4"/>`,
		),
		...xTicks.map(
			({ index }) =>
				`<line x1="${round2(x(index))}" x2="${round2(x(index))}" y1="0" y2="${height}" stroke="#000" stroke-width="1" stroke-dasharray="1 4"/>`,
		),
	].join("");

	const axes = `<line x1="0" x2="0" y1="0" y2="${height}" stroke="#000" stroke-width="1.5"/><line x1="0" x2="${width}" y1="${height}" y2="${height}" stroke="#000" stroke-width="1.5"/>`;

	const nowLine =
		nowIndex > 0 && nowIndex < series.length
			? `<line x1="${round2(x(nowIndex))}" x2="${round2(x(nowIndex))}" y1="0" y2="${height}" stroke="#000" stroke-width="1.5"/>`
			: "";

	const path = `<path d="${line(values) ?? ""}" fill="none" stroke="#000" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;

	return {
		url: svgUrl(`${grid}${axes}${nowLine}${path}`, width, height),
		xOf: (index: number) => x(index),
		yOf: (value: number) => y(value),
		yTicks,
		xTicks,
	};
}

export default function AirQuality({
	locationName = "",
	updatedLabel = "",
	gauges = [],
	series = [],
	nowIndex = 0,
	chartLabel = "PM 2.5",
	error,
	width = DEFAULT_IMAGE_WIDTH,
	height = DEFAULT_IMAGE_HEIGHT,
	screen,
}: AirQualityProps) {
	const screenProfile = screen ?? createScreenProfile({ width, height });
	const compact = screenProfile.isCompact || screenProfile.isHalfScreen;

	const pad = screenMetric(screenProfile, compact ? 14 : 20);
	const gap = screenMetric(screenProfile, compact ? 8 : 12);
	const footerHeight = screenMetric(screenProfile, compact ? 32 : 40);
	const canvasWidth = screenProfile.logicalWidth - pad * 2;

	// The dials are square and share the width; the chart takes what is left.
	// The wider gap is what keeps the "120" of one dial off the "20" of the next
	// when the pair is width-constrained rather than height-constrained.
	const dialGap = gap * 3;
	const dialSize = Math.min(
		Math.round(screenProfile.logicalHeight * 0.36),
		Math.floor((canvasWidth - dialGap) / 2),
	);
	const chartHeight =
		screenProfile.logicalHeight - pad * 2 - dialSize - gap * 2 - footerHeight;

	const axisFontSize = screenFontSize(screenProfile, compact ? 12 : 14);
	const axisLeft = Math.round(axisFontSize * 2.6);
	const axisBottom = Math.round(axisFontSize * 1.6);
	const plotWidth = Math.max(80, canvasWidth - axisLeft);
	const plotHeight = Math.max(60, chartHeight - axisBottom);

	const chart =
		series.length > 1
			? buildChart({
					series,
					nowIndex,
					width: plotWidth,
					height: plotHeight,
					lineWidth: screenMetric(screenProfile, 4),
					// Roughly six labels across the window, snapped to whole hours.
					hourStep: Math.max(2, Math.round(series.length / (compact ? 4 : 6))),
				})
			: null;

	const footerLeft = locationName
		? `Air Quality · ${locationName}`
		: "Air Quality Monitor";

	return (
		<PreSatori
			width={screenProfile.logicalWidth}
			height={screenProfile.logicalHeight}
		>
			<ScreenCanvas screen={screenProfile} style={{ padding: pad, gap }}>
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
							No air data
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
							{error ?? "Air quality unavailable"}
						</div>
					</div>
				) : (
					<>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								flex: "none",
								height: dialSize,
								alignItems: "center",
								justifyContent: "space-around",
								gap: dialGap,
							}}
						>
							{gauges.map((gauge) => (
								<Dial key={gauge.key} gauge={gauge} size={dialSize} />
							))}
						</div>

						<div
							style={{
								display: "flex",
								flex: "none",
								position: "relative",
								width: canvasWidth,
								height: chartHeight,
							}}
						>
							{/* Y axis. Each label is a fixed box centred on its gridline so
							    no transform is needed to place it. */}
							{chart.yTicks.map((tick) => (
								<div
									key={tick}
									className="font-inter"
									style={{
										display: "flex",
										position: "absolute",
										left: 0,
										top: chart.yOf(tick) - axisFontSize,
										width: axisLeft - screenMetric(screenProfile, 6),
										height: axisFontSize * 2,
										alignItems: "center",
										justifyContent: "flex-end",
										fontFamily: "Inter, sans-serif",
										fontSize: axisFontSize,
										lineHeight: 1,
									}}
								>
									{tick}
								</div>
							))}

							<div
								style={{
									display: "flex",
									position: "absolute",
									left: axisLeft,
									top: 0,
								}}
							>
								{/* Satori and Takumi do not support the Next.js Image
								    component, so the chart is a plain img. */}
								<img
									src={chart.url}
									alt={`${chartLabel} concentration`}
									width={plotWidth}
									height={plotHeight}
									style={{ display: "block" }}
								/>
							</div>

							{chart.xTicks.map((tick) => (
								<div
									key={tick.index}
									className="font-inter"
									style={{
										display: "flex",
										position: "absolute",
										left: axisLeft + chart.xOf(tick.index) - dialSize / 2,
										top: plotHeight + screenMetric(screenProfile, 4),
										width: dialSize,
										height: axisFontSize * 1.4,
										alignItems: "center",
										justifyContent: "center",
										fontFamily: "Inter, sans-serif",
										fontSize: axisFontSize,
										lineHeight: 1,
									}}
								>
									{tick.label}
								</div>
							))}

							{nowIndex > 0 && nowIndex < series.length ? (
								<div
									className="font-inter"
									style={{
										display: "flex",
										position: "absolute",
										left:
											axisLeft +
											chart.xOf(nowIndex) +
											screenMetric(screenProfile, 4),
										top: screenMetric(screenProfile, 2),
										fontFamily: "Inter, sans-serif",
										fontSize: axisFontSize,
										lineHeight: 1,
									}}
								>
									Now
								</div>
							) : null}
						</div>
					</>
				)}

				<ScreenFooter
					screen={screenProfile}
					left={footerLeft}
					right={updatedLabel}
					style={{ height: footerHeight, backgroundColor: "#000" }}
				/>
			</ScreenCanvas>
		</PreSatori>
	);
}

/**
 * One dial. Written with inline styles only: PreSatori transforms the tree it
 * is handed, so Tailwind classes inside a nested component would never reach
 * the renderer.
 */
function Dial({ gauge, size }: { gauge: AirQualityGauge; size: number }) {
	const ringSize = Math.round(size * 0.72);
	const stroke = Math.max(6, Math.round(ringSize * 0.13));
	const ringInset = Math.round((size - ringSize) / 2);
	const center = size / 2;
	const fraction = Math.max(0, Math.min(1, gauge.value / gauge.scaleMax));

	// Type inside the dial is proportional to the dial, never run back through
	// screenFontSize: `size` is already a scaled logical measurement, so scaling
	// it a second time blows the stack straight out of the ring on large screens.
	const tickFontSize = Math.max(12, Math.round(size * 0.07));
	const tickBox = Math.round(tickFontSize * 2.6);
	const tickRadius = ringSize / 2 + Math.round(tickFontSize * 1.25);
	const labelFontSize = Math.max(13, Math.round(size * 0.081));
	const valueFontSize = Math.round(size * 0.172);
	const unitFontSize = Math.max(12, Math.round(size * 0.069));

	// A long band name ("Very Unhealthy") has to fit the hole in the ring, so it
	// gives up type size rather than running out over the stippled track.
	const categoryFontSize = Math.max(
		12,
		Math.round(
			size * 0.088 * Math.min(1, 9 / Math.max(1, gauge.category.length)),
		),
	);

	const ticks = Array.from({ length: RING_TICKS }, (_, index) => {
		const value = (gauge.scaleMax / (RING_TICKS - 1)) * index;
		const point = polar(
			center,
			tickRadius,
			RING_START + (RING_SWEEP / (RING_TICKS - 1)) * index,
		);
		return { value: Math.round(value), x: point.x, y: point.y };
	});

	return (
		<div
			style={{
				display: "flex",
				position: "relative",
				flex: "none",
				width: size,
				height: size,
			}}
		>
			<div
				style={{
					display: "flex",
					position: "absolute",
					left: ringInset,
					top: ringInset,
				}}
			>
				{/* Satori and Takumi do not support the Next.js Image component. */}
				<img
					src={ringUrl(ringSize, stroke, fraction)}
					alt=""
					width={ringSize}
					height={ringSize}
					style={{ display: "block" }}
				/>
			</div>

			{ticks.map((tick) => (
				<div
					key={tick.value}
					style={{
						display: "flex",
						position: "absolute",
						left: tick.x - tickBox / 2,
						top: tick.y - tickFontSize,
						width: tickBox,
						height: tickFontSize * 2,
						alignItems: "center",
						justifyContent: "center",
						fontFamily: "Inter, sans-serif",
						fontSize: tickFontSize,
						lineHeight: 1,
					}}
				>
					{tick.value}
				</div>
			))}

			<div
				style={{
					display: "flex",
					position: "absolute",
					left: 0,
					top: Math.round(size * 0.34),
					width: size,
					flexDirection: "column",
					alignItems: "center",
					gap: Math.round(size * 0.022),
				}}
			>
				<div
					style={{
						display: "flex",
						fontFamily: "Inter, sans-serif",
						fontSize: categoryFontSize,
						lineHeight: 1,
					}}
				>
					{gauge.category}
				</div>
				<div
					style={{
						display: "flex",
						fontFamily: "Inter, sans-serif",
						fontSize: labelFontSize,
						lineHeight: 1,
					}}
				>
					{gauge.label}
				</div>
				<div
					style={{
						display: "flex",
						fontFamily: "Inter, sans-serif",
						fontSize: valueFontSize,
						lineHeight: 1,
					}}
				>
					{gauge.value.toFixed(1)}
				</div>
				<div
					style={{
						display: "flex",
						fontFamily: "Inter, sans-serif",
						fontSize: unitFontSize,
						lineHeight: 1,
					}}
				>
					{UNIT}
				</div>
			</div>
		</div>
	);
}

export const definition: RecipeDefinition<
	typeof paramsSchema,
	typeof dataSchema
> = {
	meta: {
		slug: "air-quality",
		title: "Air Quality",
		description:
			"Particulate readings for a location as two dials, over a 30-hour concentration chart marked with the current hour. Uses Open-Meteo; no API key required.",
		published: true,
		tags: [
			"tailwind",
			"air-quality",
			"weather",
			"api",
			"live-data",
			"configurable",
		],
		author: { name: "Nitin Ranganath", github: "itsnitinr" },
		category: "display-components",
		version: "0.2.0",
		createdAt: "2026-09-02T00:00:00Z",
		updatedAt: "2026-09-07T00:00:00Z",
		renderSettings: {
			// The dial track and the antialiased chart line are grays. Snapping to a
			// 1-bit palette would flatten them to white, so the frame is dithered.
			paletteReduction: "floyd-steinberg",
		},
	},
	paramsSchema,
	dataSchema,
	getData: async (params) => {
		const data = await getAirQualityData({
			location: params.location,
			latitude: params.latitude,
			longitude: params.longitude,
			standard: params.standard,
			pollutant: params.pollutant,
		});
		return data as z.infer<typeof dataSchema>;
	},
	Component: ({ width, height, screen, data }) => (
		<AirQuality
			{...(data as AirQualityData)}
			width={width}
			height={height}
			screen={screen}
		/>
	),
};
