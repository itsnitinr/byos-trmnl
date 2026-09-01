import { z } from "zod";
import { screenFontSize, screenMetric } from "@/components/trmnl/screen-layout";
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
import getAirQualityData, { type AirQualityData } from "./getData";

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
	// Kept a plain string rather than an enum because the params form only
	// renders string/number/boolean fields; anything else is dropped silently.
	// `getData` normalizes it, so an unrecognized value falls back to "us".
	standard: z
		.string()
		.default("us")
		.describe('Index scale to report: "us" (US AQI) or "european" (EU AQI)')
		.meta({ title: "AQI standard", placeholder: "us" }),
});

const aqiHourSchema = z.object({
	label: z.string(),
	aqi: z.number(),
});

const pollutantSchema = z.object({
	name: z.string(),
	value: z.string(),
	dominant: z.boolean(),
});

export const dataSchema = z.object({
	locationName: z.string().default(""),
	dateLabel: z.string().default(""),
	standard: z.enum(["us", "european"]).default("us"),
	aqi: z.number().default(0),
	category: z.string().default(""),
	dominantPollutant: z.string().default(""),
	trend: z.number().default(0),
	hours: z.array(aqiHourSchema).default([]),
	threshold: z.number().default(100),
	scaleMax: z.number().default(120),
	bestWindow: z.string().default(""),
	bestWindowAqi: z.number().default(0),
	peakLabel: z.string().default(""),
	peakAqi: z.number().default(0),
	pollutants: z.array(pollutantSchema).default([]),
	error: z.string().optional(),
});

interface AirQualityProps extends Partial<AirQualityData> {
	width?: number;
	height?: number;
	screen?: ScreenProfile;
}

function trendLabel(trend: number): string {
	if (trend === 0) return "STEADY";
	return trend > 0 ? `UP ${trend} IN 3H` : `DOWN ${Math.abs(trend)} IN 3H`;
}

export default function AirQuality({
	locationName = "",
	dateLabel = "",
	standard = "us",
	aqi = 0,
	category = "",
	dominantPollutant = "",
	trend = 0,
	hours = [],
	threshold = 100,
	scaleMax = 120,
	bestWindow = "",
	bestWindowAqi = 0,
	peakLabel = "",
	peakAqi = 0,
	pollutants = [],
	error,
	width = DEFAULT_IMAGE_WIDTH,
	height = DEFAULT_IMAGE_HEIGHT,
	screen,
}: AirQualityProps) {
	const screenProfile = screen ?? createScreenProfile({ width, height });
	const compact = screenProfile.isHalfScreen;

	// Everything below is drawn inline rather than split into helper components:
	// PreSatori only transforms the JSX tree it is handed, so classNames inside a
	// nested component would never reach the renderer.
	const shownHours = hours.slice(0, compact ? 12 : 24);
	const shownPollutants = pollutants.slice(0, compact ? 2 : 4);
	const chartHeight = screenMetric(screenProfile, compact ? 96 : 150);
	const thresholdOffset = Math.min(95, (threshold / scaleMax) * 100);

	// The headline column is a fixed width the chart has to be measured against.
	// Both are derived from the logical width the frame is actually laid out at
	// rather than the caller's pixel dimensions. The column is an inline style so
	// it scales, but `p-6`/`gap-6` are Tailwind classes that PreSatori passes
	// through untouched, so those stay at their literal 24px.
	const logicalWidth = screenProfile.logicalWidth;
	const headlineWidth = screenMetric(screenProfile, 210);
	const PADDING = 24;
	const COLUMN_GAP = 24;

	// Bars are sized from the real column width so the white gaps between them
	// survive 1-bit quantization — touching bars dither into one grey slab.
	const chartWidth = compact
		? logicalWidth - PADDING * 2
		: logicalWidth - PADDING * 2 - headlineWidth - COLUMN_GAP;
	const barWidth = Math.max(
		3,
		Math.floor((chartWidth / Math.max(1, shownHours.length)) * 0.62),
	);

	// A four-digit index (dust storms, wildfire smoke) has to fit the column.
	const headlineSize =
		aqi >= 1000
			? compact
				? 40
				: 68
			: aqi >= 100
				? compact
					? 48
					: 86
				: compact
					? 60
					: 104;

	// Five evenly spaced ticks across the window; the first is always "NOW".
	const tickStep = Math.max(1, Math.floor((shownHours.length - 1) / 4));
	const ticks = shownHours.filter(
		(_, index) => index === 0 || index % tickStep === 0,
	);

	return (
		<PreSatori
			width={screenProfile.logicalWidth}
			height={screenProfile.logicalHeight}
		>
			<div className="flex flex-col w-full h-full bg-white text-black font-inter p-6">
				{/* Header */}
				<div className="flex flex-row items-center justify-between border-b-2 border-black pb-3">
					<span
						className={`${compact ? "text-lg" : "text-2xl"} font-inter font-bold tracking-widest`}
					>
						AIR QUALITY
					</span>
					<span className={`${compact ? "text-xs" : "text-lg"} font-inter`}>
						{locationName}
						{dateLabel ? ` · ${dateLabel}` : ""}
					</span>
				</div>

				{error ? (
					<div className="flex flex-col flex-1 items-center justify-center gap-3">
						<span
							className={`${compact ? "text-2xl" : "text-4xl"} font-inter font-bold`}
						>
							NO AIR DATA
						</span>
						<span
							className={`${compact ? "text-base" : "text-xl"} font-inter text-gray-600`}
						>
							{error}
						</span>
					</div>
				) : (
					<div
						className={`flex ${compact ? "flex-col" : "flex-row"} flex-1 ${compact ? "gap-2" : "gap-6"} pt-4`}
					>
						{/* Headline index */}
						<div
							className="flex flex-col justify-center"
							style={compact ? {} : { width: `${headlineWidth}px` }}
						>
							<span
								className="font-inter font-bold leading-none"
								style={{
									fontSize: `${screenFontSize(screenProfile, headlineSize)}px`,
								}}
							>
								{aqi}
							</span>
							<span
								className={`${compact ? "text-xl" : "text-3xl"} font-inter font-bold mt-2`}
							>
								{category}
							</span>
							<span
								className={`${compact ? "text-xs" : "text-sm"} font-inter tracking-widest mt-2`}
							>
								{standard === "european" ? "EU AQI" : "US AQI"}
								{dominantPollutant ? ` · ${dominantPollutant} LEADS` : ""}
							</span>
							<span
								className={`${compact ? "text-xs" : "text-sm"} font-inter tracking-widest mt-1`}
							>
								{trendLabel(trend)}
							</span>
						</div>

						{/* Forecast */}
						<div className="flex flex-col flex-1">
							<div className="flex flex-row items-center justify-between">
								<span
									className={`${compact ? "text-xs" : "text-sm"} font-inter font-bold tracking-widest`}
								>
									NEXT {shownHours.length} HOURS
								</span>
								<span
									className={`${compact ? "text-xs" : "text-sm"} font-inter tracking-widest`}
								>
									LINE {threshold} · TOP {scaleMax}
								</span>
							</div>

							{/* Bars. Heights are inline because they are data-driven. */}
							<div
								className="flex flex-row items-end justify-between border-b-2 border-black mt-2"
								style={{ height: `${chartHeight}px`, position: "relative" }}
							>
								{/* Threshold reference, drawn behind the bars: on a clean day it
								    sits clearly above them, on a bad day the bars bury it. */}
								<div
									className="bg-black"
									style={{
										position: "absolute",
										left: 0,
										right: 0,
										bottom: `${thresholdOffset}%`,
										height: "2px",
									}}
								/>
								{shownHours.map((hour) => (
									<div
										key={hour.label + hour.aqi}
										className="bg-black"
										style={{
											width: `${barWidth}px`,
											height: `${Math.max(2, Math.min(100, (hour.aqi / scaleMax) * 100))}%`,
										}}
									/>
								))}
							</div>

							{/* Hour ticks */}
							<div className="flex flex-row items-center justify-between mt-1">
								{ticks.map((tick, index) => (
									<span
										key={tick.label + tick.aqi}
										className={`${compact ? "text-xs" : "text-sm"} font-inter tracking-widest`}
									>
										{index === 0 ? "NOW" : tick.label}
									</span>
								))}
							</div>

							{/* Pollutant concentrations */}
							<div
								className={`flex flex-row ${compact ? "gap-1 mt-2" : "gap-2 mt-4"}`}
							>
								{shownPollutants.map((pollutant) => (
									<div
										key={pollutant.name}
										className={`flex flex-col flex-1 border border-black ${compact ? "p-1" : "p-2"} ${
											pollutant.dominant ? "bg-black text-white" : ""
										}`}
									>
										<span
											className={`${compact ? "text-xs" : "text-sm"} font-inter tracking-widest`}
										>
											{pollutant.name}
										</span>
										<span
											className={`${compact ? "text-base" : "text-2xl"} font-inter font-bold leading-none mt-1`}
										>
											{pollutant.value}
										</span>
									</div>
								))}
							</div>
						</div>
					</div>
				)}

				{/* Footer */}
				<div className="flex flex-row items-center justify-between border-t-2 border-black pt-3 mt-4">
					<span
						className={`${compact ? "text-xs" : "text-lg"} font-inter font-bold`}
					>
						{bestWindow ? `BEST AIR ${bestWindow} · ${bestWindowAqi}` : ""}
					</span>
					<span className={`${compact ? "text-xs" : "text-lg"} font-inter`}>
						{peakLabel ? `PEAK ${peakLabel} · ${peakAqi}` : ""}
					</span>
				</div>
			</div>
		</PreSatori>
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
			"Current air quality index for a location with a 24-hour forecast chart, pollutant concentrations, and the calmest window of the day. Uses Open-Meteo; no API key required.",
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
		version: "0.1.0",
		createdAt: "2026-09-02T00:00:00Z",
		updatedAt: "2026-09-02T00:00:00Z",
	},
	paramsSchema,
	dataSchema,
	getData: async (params) => {
		const data = await getAirQualityData({
			location: params.location,
			latitude: params.latitude,
			longitude: params.longitude,
			standard: params.standard,
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
