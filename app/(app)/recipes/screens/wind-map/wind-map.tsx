import type { CSSProperties } from "react";
import {
	ScreenCanvas,
	ScreenFooter,
	screenFontSize,
	screenMetric,
} from "@/components/trmnl/screen-layout";
import type { RecipeDefinition, RecipeRenderProps } from "@/lib/recipes/types";
import { createScreenProfile } from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";
import {
	arrowSvg,
	beaufort,
	compassPoint,
	drawWindMap,
	formatSpeed,
	unitLabel,
} from "./field";
import getWindData from "./getData";
import { dataSchema, GRID_SIZE, paramsSchema, type WindData } from "./schema";

export { dataSchema, paramsSchema } from "./schema";

const row: CSSProperties = { display: "flex", flexDirection: "row" };
const col: CSSProperties = { display: "flex", flexDirection: "column" };
const clip: CSSProperties = {
	overflow: "hidden",
	whiteSpace: "nowrap",
	textOverflow: "ellipsis",
};
const clock = (time: string) => (time.length >= 16 ? time.slice(11, 16) : "—");

export function WindMap({
	width = 800,
	height = 480,
	screen = createScreenProfile({ width, height }),
	data,
}: RecipeRenderProps & { data: WindData }) {
	const w = screen.logicalWidth;
	const h = screen.logicalHeight;
	const stacked = screen.orientation === "portrait" || screen.isHalfScreen;
	const compact = screen.isCompact || screen.isHalfScreen;
	const m = (value: number) => screenMetric(screen, value);
	const f = (value: number) => screenFontSize(screen, value);

	const padding = screen.isCompact ? m(12) : m(screen.isLarge ? 28 : 18);
	const gap = screen.isCompact ? m(8) : m(screen.isLarge ? 16 : 10);
	const footerHeight = m(compact ? 30 : 34);
	const mainWidth = w - padding * 2;
	const mainHeight = h - padding * 2 - gap - footerHeight;
	const mapWidth = Math.max(
		1,
		stacked
			? mainWidth
			: Math.min(Math.round(mainHeight * 1.3), mainWidth * 0.62),
	);
	const showGusts = !screen.isHalfScreen;
	const forecastSteps = compact ? 4 : 6;
	const speedSize = m(compact ? 56 : screen.isLarge ? 96 : 80);
	// Stacked layouts give the map whatever the readout leaves, so no gap pools between them.
	const readoutHeight =
		f(compact ? 18 : 22) * 1.2 +
		speedSize * 0.9 +
		f(compact ? 16 : 20) * 1.2 +
		(showGusts ? f(18) * 1.2 + m(4) : 0) +
		m(8) * 2 +
		(data.forecast.length ? f(16) * 2.4 + f(18) * 1.2 + m(26) + m(26) : 0);
	const mapHeight = Math.max(
		1,
		stacked
			? Math.round(mainHeight - readoutHeight - m(12) - m(8))
			: mainHeight,
	);

	const ready = data.grid.length === GRID_SIZE * GRID_SIZE;
	const map = ready
		? drawWindMap({
				grid: data.grid,
				width: mapWidth,
				height: mapHeight,
				spanKm: data.spanKm,
			})
		: null;
	const centre = ready ? data.grid[Math.floor(data.grid.length / 2)] : null;
	const scale = centre ? beaufort(centre.speed) : null;
	const unit = unitLabel(data.unit);
	const border = `${m(2)}px solid black`;
	const forecast = data.forecast.slice(0, forecastSteps);

	const readout = (
		<div
			className="font-inter"
			style={{
				...col,
				flex: 1,
				minWidth: 0,
				justifyContent: "space-between",
				gap: m(stacked ? 8 : 12),
			}}
		>
			<div className="font-inter" style={{ ...col, gap: m(4) }}>
				<div
					className="font-inter"
					style={{ ...clip, fontSize: f(compact ? 18 : 22), fontWeight: 600 }}
				>
					{data.location}
				</div>
				<div
					className="font-inter"
					style={{ ...row, alignItems: "flex-end", gap: m(12) }}
				>
					<div
						className="font-inter"
						style={{
							fontSize: speedSize,
							fontWeight: 700,
							letterSpacing: "-0.04em",
							lineHeight: 0.85,
						}}
					>
						{centre ? formatSpeed(centre.speed, data.unit) : "—"}
					</div>
					<div
						className="font-inter"
						style={{ ...col, gap: m(2), paddingBottom: m(2) }}
					>
						<span
							className="font-inter"
							style={{ fontSize: f(compact ? 18 : 22), fontWeight: 600 }}
						>
							{unit}
						</span>
						<span
							className="font-inter"
							style={{ fontSize: f(compact ? 16 : 18) }}
						>
							{centre && scale?.force
								? `from ${compassPoint(centre.direction)}`
								: " "}
						</span>
					</div>
					{centre && scale?.force ? (
						<img
							src={arrowSvg(centre.direction, m(compact ? 40 : 52))}
							alt={`Wind from ${compassPoint(centre.direction)}`}
							width={m(compact ? 40 : 52)}
							height={m(compact ? 40 : 52)}
							style={{ marginLeft: "auto" }}
						/>
					) : null}
				</div>
				<div
					className="font-inter"
					style={{ ...row, gap: m(10), fontSize: f(compact ? 16 : 20) }}
				>
					<span className="font-inter" style={{ fontWeight: 600 }}>
						{scale ? `${scale.name}` : "No reading"}
					</span>
					{scale ? (
						<span className="font-inter">Force {scale.force}</span>
					) : null}
				</div>
				{data.gusts != null && showGusts ? (
					<div className="font-inter" style={{ fontSize: f(18) }}>
						Gusts to {formatSpeed(data.gusts, data.unit)} {unit}
					</div>
				) : null}
			</div>
			{forecast.length ? (
				<div className="font-inter" style={{ ...col, gap: m(6) }}>
					<div
						className="font-inter"
						style={{
							fontSize: f(16),
							borderBottom: border,
							paddingBottom: m(4),
						}}
					>
						Next {forecast.length * 2} hours
					</div>
					<div
						className="font-inter"
						style={{ ...row, justifyContent: "space-between" }}
					>
						{forecast.map((hour) => (
							<div
								className="font-inter"
								key={hour.time}
								style={{ ...col, alignItems: "center", gap: m(4) }}
							>
								<span className="font-inter" style={{ fontSize: f(16) }}>
									{clock(hour.time).slice(0, 2)}
								</span>
								<img
									src={arrowSvg(hour.direction, m(26))}
									alt={`From ${compassPoint(hour.direction)}`}
									width={m(26)}
									height={m(26)}
								/>
								<span
									className="font-inter"
									style={{ fontSize: f(18), fontWeight: 600 }}
								>
									{formatSpeed(hour.speed, data.unit)}
								</span>
							</div>
						))}
					</div>
				</div>
			) : null}
		</div>
	);

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
						gap: m(stacked ? 12 : 20),
					}}
				>
					{/* SVG data keeps streamline geometry identical across renderers. */}
					{map ? (
						<div
							className="font-inter"
							style={{
								...col,
								flexShrink: 0,
								width: mapWidth,
								height: mapHeight,
								position: "relative",
							}}
						>
							<img
								src={`data:image/svg+xml,${encodeURIComponent(map.svg)}`}
								alt={`Wind streamlines around ${data.location}`}
								width={mapWidth}
								height={mapHeight}
							/>
							{map.calm ? (
								<div
									className="font-inter"
									style={{
										...row,
										position: "absolute",
										inset: 0,
										alignItems: "center",
										justifyContent: "center",
										fontSize: f(28),
										fontWeight: 600,
									}}
								>
									Still air
								</div>
							) : null}
						</div>
					) : (
						<div
							className="font-inter"
							style={{
								...row,
								flexShrink: 0,
								width: mapWidth,
								height: mapHeight,
								border,
								alignItems: "center",
								justifyContent: "center",
								fontSize: f(20),
							}}
						>
							Wind data unavailable
						</div>
					)}
					{readout}
				</div>
				<ScreenFooter
					screen={screen}
					style={{
						fontFamily: "inter",
						height: footerHeight,
						padding: `0 ${m(12)}px`,
					}}
					left={`Updated ${clock(data.updated)}`}
					right={
						map && !compact
							? `Ring ${map.ringKm} km · ${data.spanKm} km across`
							: undefined
					}
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
		slug: "wind-map",
		title: "Wind map",
		description:
			"Live surface wind drawn as flowing streamlines around your location, with heavier strokes for stronger wind, the Beaufort force and a 12-hour outlook. Data from Open-Meteo, no API key.",
		published: true,
		category: "environment",
		tags: ["weather", "wind", "map", "live", "location"],
		version: "1.0.0",
		renderSettings: {
			imageDither: false,
		},
	},
	paramsSchema,
	dataSchema,
	getData: getWindData,
	Component: ({ data, width, height, screen }) => (
		<WindMap data={data} width={width} height={height} screen={screen} />
	),
};
