import type { CSSProperties } from "react";
import { z } from "zod";
import {
	ScreenCanvas,
	ScreenFooter,
	screenFontSize,
	screenMetric,
} from "@/components/trmnl/screen-layout";
import { dailyArtParams, editionDate } from "@/lib/recipes/art/daily";
import type { RecipeDefinition, RecipeRenderProps } from "@/lib/recipes/types";
import { createScreenProfile } from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";
import { sunAlmanac } from "./almanac";
import { drawSunPlate } from "./plate";

export const paramsSchema = dailyArtParams.extend({
	location: z
		.string()
		.max(60)
		.default("Bengaluru")
		.describe("Display label for the observer")
		.meta({ title: "Location label" }),
	latitude: z
		.number()
		.min(-89)
		.max(89)
		.default(12.9716)
		.describe("Observer latitude in decimal degrees"),
	longitude: z
		.number()
		.min(-180)
		.max(180)
		.default(77.5946)
		.describe("Observer longitude in decimal degrees"),
});
export const dataSchema = paramsSchema;
type Params = z.infer<typeof paramsSchema>;

/** The plate moves with the sun; ten minutes is a few pixels of travel. */
const FRAME_MS = 600_000;

const row: CSSProperties = { display: "flex", flexDirection: "row" };
const col: CSSProperties = { display: "flex", flexDirection: "column" };

const POINTS = "N NE E SE S SW W NW".split(" ");
const compass = (degrees: number) => POINTS[Math.round(degrees / 45) % 8];

function duration(ms: number) {
	const minutes = Math.round(Math.abs(ms) / 60_000);
	return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
}
function change(ms: number) {
	const seconds = Math.round(Math.abs(ms) / 1000);
	if (seconds === 0) return "Same length as yesterday";
	const amount =
		seconds < 60
			? `${seconds} s`
			: `${Math.floor(seconds / 60)} m ${String(seconds % 60).padStart(2, "0")} s`;
	return `${amount} ${ms > 0 ? "longer" : "shorter"} than yesterday`;
}
const coordinate = (value: number, positive: string, negative: string) =>
	`${Math.abs(value).toFixed(2)}°${value >= 0 ? positive : negative}`;

export function SunPath({
	width = 800,
	height = 480,
	screen = createScreenProfile({ width, height }),
	params,
}: RecipeRenderProps & { params: Params }) {
	const date = editionDate(params);
	const almanac = sunAlmanac({
		date,
		timeZone: params.timezone,
		latitude: params.latitude,
		longitude: params.longitude,
		now: Date.now(),
	});
	const clock = (ms: number | null) =>
		ms === null
			? "None"
			: new Intl.DateTimeFormat("en-GB", {
					timeZone: params.timezone,
					hour: "2-digit",
					minute: "2-digit",
					hourCycle: "h23",
				}).format(new Date(Math.round(ms / 60_000) * 60_000));
	const dayLabel = new Intl.DateTimeFormat("en-GB", {
		timeZone: "UTC",
		weekday: "short",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date(`${date}T12:00:00Z`));
	const shortDay = (iso: string) =>
		new Intl.DateTimeFormat("en-GB", {
			timeZone: "UTC",
			day: "numeric",
			month: "short",
		}).format(new Date(`${iso}T12:00:00Z`));

	const w = screen.logicalWidth;
	const h = screen.logicalHeight;
	const stacked = screen.orientation === "portrait" || screen.isHalfScreen;
	const compact = screen.isCompact || screen.isHalfScreen;
	const m = (value: number) => screenMetric(screen, value);
	const fs = (value: number) => screenFontSize(screen, value);

	const padding = screen.isCompact ? m(12) : m(screen.isLarge ? 28 : 18);
	const gap = screen.isCompact ? m(8) : m(screen.isLarge ? 16 : 10);
	const footerHeight = m(compact ? 30 : 34);
	const mainWidth = w - padding * 2;
	const mainHeight = h - padding * 2 - gap - footerHeight;
	const heroSize = m(compact ? 52 : screen.isLarge ? 88 : 76);
	const showZeroShadow = almanac.zeroShadow.length > 0 && !screen.isHalfScreen;
	// Stacked layouts give the plate whatever the readout leaves.
	const readoutHeight =
		fs(compact ? 18 : 22) * 1.2 +
		fs(16) * 1.2 +
		heroSize * 0.9 +
		fs(18) * 1.2 +
		(fs(16) + fs(compact ? 20 : 24)) * 1.25 +
		fs(18) * 2.4 +
		(showZeroShadow ? fs(16) * 1.2 : 0) +
		m(10) * 5;
	const plate = Math.max(
		1,
		Math.floor(
			stacked
				? Math.min(mainWidth, mainHeight - readoutHeight - m(12))
				: Math.min(mainHeight, mainWidth * 0.56),
		),
	);
	const svg = drawSunPlate(plate, almanac);

	const label: CSSProperties = { fontSize: fs(16) };
	const stat = (name: string, value: string) => (
		<div className="font-inter" style={{ ...col, gap: m(2) }}>
			<span className="font-inter" style={label}>
				{name}
			</span>
			<span
				className="font-inter"
				style={{ fontSize: fs(compact ? 20 : 24), fontWeight: 600 }}
			>
				{value}
			</span>
		</div>
	);

	let hero: { kicker: string; value: string; unit: string; note: string };
	if (almanac.now)
		hero = {
			kicker: "Sun now",
			value: `${Math.round(almanac.now.elevation)}°`,
			unit: `${compass(almanac.now.azimuth)} · ${Math.round(almanac.now.azimuth)}°`,
			note:
				almanac.shadow === null
					? "On the horizon"
					: almanac.shadow >= 10
						? `Long shadows, falling ${compass((almanac.now.azimuth + 180) % 360)}`
						: `Shadow ${almanac.shadow.toFixed(1)}× height, falls ${compass((almanac.now.azimuth + 180) % 360)}`,
		};
	else if (almanac.live)
		hero = {
			kicker: "Sun now",
			value: "Night",
			unit: "",
			note:
				almanac.nextRise !== null
					? `Rises at ${clock(almanac.nextRise)}`
					: "No sunrise tomorrow",
		};
	else
		hero = {
			kicker: dayLabel,
			value: `${Math.round(almanac.noonElevation)}°`,
			unit: "at noon",
			note:
				almanac.noonElevation > 0
					? `Noon shadow ${(1 / Math.tan((almanac.noonElevation * Math.PI) / 180)).toFixed(1)}× height`
					: "Sun stays below the horizon",
		};

	return (
		<PreSatori width={w} height={h}>
			<ScreenCanvas
				className="font-inter"
				screen={screen}
				style={{ fontFamily: "inter" }}
			>
				<div
					className="font-inter"
					style={{
						...(stacked ? col : row),
						flex: 1,
						minHeight: 0,
						alignItems: stacked ? "center" : "stretch",
						gap: m(stacked ? 12 : 24),
					}}
				>
					<img
						src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
						alt={`Path of the sun over ${params.location} on ${dayLabel}`}
						width={plate}
						height={plate}
						style={{ flexShrink: 0 }}
					/>
					<div
						className="font-inter"
						style={{
							...col,
							flex: 1,
							minWidth: 0,
							alignSelf: "stretch",
							justifyContent: "space-between",
							gap: m(10),
						}}
					>
						<div className="font-inter" style={{ ...col, gap: m(2) }}>
							<span
								className="font-inter"
								style={{
									fontSize: fs(compact ? 18 : 22),
									fontWeight: 600,
									overflow: "hidden",
									whiteSpace: "nowrap",
								}}
							>
								{params.location}
							</span>
							<span className="font-inter" style={label}>
								{coordinate(params.latitude, "N", "S")}{" "}
								{coordinate(params.longitude, "E", "W")}
							</span>
						</div>
						<div className="font-inter" style={{ ...col, gap: m(4) }}>
							<span className="font-inter" style={label}>
								{hero.kicker}
							</span>
							<div
								className="font-inter"
								style={{ ...row, alignItems: "flex-end", gap: m(10) }}
							>
								<span
									className="font-inter"
									style={{
										fontSize: heroSize,
										fontWeight: 700,
										letterSpacing: "-0.04em",
										lineHeight: 0.85,
									}}
								>
									{hero.value}
								</span>
								<span
									className="font-inter"
									style={{
										fontSize: fs(compact ? 18 : 22),
										fontWeight: 600,
										paddingBottom: m(2),
									}}
								>
									{hero.unit}
								</span>
							</div>
							<span className="font-inter" style={{ fontSize: fs(18) }}>
								{hero.note}
							</span>
						</div>
						<div
							className="font-inter"
							style={{
								...row,
								justifyContent: "space-between",
								borderTop: `${m(2)}px solid black`,
								paddingTop: m(8),
							}}
						>
							{stat("Sunrise", clock(almanac.rise))}
							{stat(
								"Noon",
								`${clock(almanac.noon)}${compact ? "" : ` · ${Math.round(almanac.noonElevation)}°`}`,
							)}
							{stat("Sunset", clock(almanac.set))}
						</div>
						<div className="font-inter" style={{ ...col, gap: m(4) }}>
							<span
								className="font-inter"
								style={{ fontSize: fs(18), fontWeight: 600 }}
							>
								Daylight {duration(almanac.dayLength)}
							</span>
							<span className="font-inter" style={{ fontSize: fs(16) }}>
								{change(almanac.dayLengthChange)}
							</span>
							{showZeroShadow ? (
								<span className="font-inter" style={{ fontSize: fs(16) }}>
									Zero-shadow days{" "}
									{almanac.zeroShadow.map(shortDay).join(" · ")}
								</span>
							) : null}
						</div>
					</div>
				</div>
				<ScreenFooter
					screen={screen}
					style={{
						fontFamily: "inter",
						height: footerHeight,
						padding: `0 ${m(12)}px`,
					}}
					left={<span className="font-inter">{dayLabel}</span>}
					right={
						compact ? undefined : (
							<span className="font-inter">
								Dashed: 21 Jun & 21 Dec · dots: hours
							</span>
						)
					}
				/>
			</ScreenCanvas>
		</PreSatori>
	);
}

export const definition: RecipeDefinition<typeof paramsSchema> = {
	meta: {
		slug: "sun-path",
		title: "Sun path",
		description:
			"An architect's sun-path chart for your location: today's arc across the sky against the solstices, where the sun is now and which way shadows fall, with sunrise, sunset, day length and zero-shadow days. Works offline.",
		published: true,
		category: "environment",
		tags: ["sun", "astronomy", "daily", "location"],
		version: "1.0.0",
		renderSettings: {
			imageDither: false,
			supersample: false,
			cacheSeconds: FRAME_MS / 1000,
		},
	},
	getRenderCacheKey: (params) =>
		params.date
			? params.date
			: `${editionDate(params)}:${Math.floor(Date.now() / FRAME_MS)}`,
	paramsSchema,
	dataSchema,
	Component: SunPath,
};
