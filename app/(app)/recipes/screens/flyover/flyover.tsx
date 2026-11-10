import type { CSSProperties } from "react";
import {
	ScreenCanvas,
	ScreenFooter,
	screenFontSize,
	screenMetric,
} from "@/components/trmnl/screen-layout";
import { globeMarkers } from "@/lib/recipes/flyover/markers";
import type { RecipeDefinition, RecipeRenderProps } from "@/lib/recipes/types";
import { createScreenProfile } from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";
import getData from "./getData";
import {
	dataSchema,
	type FlyoverData,
	type FlyoverParams,
	paramsSchema,
} from "./schema";

export { dataSchema, paramsSchema } from "./schema";

const col: CSSProperties = { display: "flex", flexDirection: "column" };
const row: CSSProperties = { display: "flex", flexDirection: "row" };

export function Flyover({
	width = 800,
	height = 480,
	screen = createScreenProfile({ width, height }),
	params,
	data,
}: RecipeRenderProps & { params: FlyoverParams; data: FlyoverData }) {
	const w = screen.logicalWidth,
		h = screen.logicalHeight;
	const m = (v: number) => screenMetric(screen, v);
	const fs = (v: number) => screenFontSize(screen, v);
	const compact = screen.isCompact || screen.isHalfScreen;
	const stacked = screen.orientation === "portrait";
	const padding = m(compact ? 12 : 18),
		gap = m(compact ? 8 : 12);
	const headerHeight = fs(24) * 1.25,
		footerHeight = fs(16) * 1.4 + m(8);
	const mainHeight = h - padding * 2 - headerHeight - footerHeight - gap * 2;
	const mainWidth = w - padding * 2;
	const readoutHeight = compact ? 132 : 214;
	const size = Math.max(
		1,
		Math.floor(
			stacked
				? Math.min(mainWidth, mainHeight - readoutHeight - gap)
				: Math.min(mainHeight, mainWidth * 0.59),
		),
	);
	const markers = globeMarkers(
		size,
		data.camera,
		data.station,
		params,
		data.track,
	);
	const unit = params.units === "miles" ? "mi" : "km";
	const amount = (v: number) =>
		Math.round(v / (unit === "mi" ? 1.609344 : 1)).toLocaleString("en-US");
	const time = new Date(data.updatedAt).toISOString().slice(11, 16);
	const coord = (v: number, pos: string, neg: string) =>
		`${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
	const text: CSSProperties = { fontFamily: "inter", color: "#000" };
	const stat = (label: string, value: string, large = false) => (
		<div
			className="font-inter"
			style={{ ...col, ...text, gap: m(3), minWidth: 0 }}
		>
			<span className="font-inter" style={{ fontSize: fs(18) }}>
				{label}
			</span>
			<span
				className="font-inter"
				style={{
					fontSize: fs(large ? 32 : 24),
					fontWeight: 600,
					lineHeight: 1.1,
				}}
			>
				{value}
			</span>
		</div>
	);
	return (
		<PreSatori width={w} height={h}>
			<ScreenCanvas
				screen={screen}
				className="font-inter"
				style={{ ...text, backgroundColor: "#fff", padding, gap }}
			>
				<div
					className="font-inter"
					style={{
						...row,
						height: headerHeight,
						flexShrink: 0,
						justifyContent: "space-between",
						alignItems: "center",
						...text,
					}}
				>
					<span
						className="font-inter"
						style={{ fontSize: fs(24), fontWeight: 600 }}
					>
						Flyover
					</span>
					<span className="font-inter" style={{ fontSize: fs(16) }}>
						ISS · {time} UTC
					</span>
				</div>
				<div
					style={{
						...(stacked ? col : row),
						height: mainHeight,
						flexShrink: 0,
						alignItems: "center",
						justifyContent: "center",
						gap,
					}}
				>
					<div
						style={{
							display: "flex",
							width: size,
							height: size,
							position: "relative",
							flexShrink: 0,
						}}
					>
						<img
							src={data.globe}
							alt="Earth with sunlight and city lights"
							width={size}
							height={size}
						/>
						<img
							src={`data:image/svg+xml,${encodeURIComponent(markers.svg)}`}
							alt="ISS and its next 52 minutes of ground track; ring marks your location"
							width={size}
							height={size}
							style={{ position: "absolute", left: 0, top: 0 }}
						/>
					</div>
					<div
						className="font-inter"
						style={{
							...col,
							...text,
							flex: 1,
							alignSelf: "stretch",
							justifyContent: "center",
							minWidth: 0,
							gap: m(compact ? 10 : 24),
						}}
					>
						{compact ? (
							<>
								{stat("Above · approximate", data.above)}
								<div
									className="font-inter"
									style={{
										...row,
										...text,
										gap: m(16),
										justifyContent: "space-between",
									}}
								>
									{stat(
										"Speed",
										`${amount(data.station.speed)} ${unit === "mi" ? "mph" : "km/h"}`,
									)}
									{stat("Altitude", `${amount(data.station.altitude)} ${unit}`)}
								</div>
								<span className="font-inter" style={{ fontSize: fs(16) }}>
									{amount(data.distance)} {unit} from {params.location || "you"}
									{markers.far ? " · far side" : ""}
								</span>
							</>
						) : (
							<>
								<div className="font-inter" style={{ ...col, gap: m(5) }}>
									{stat("Above · approximate", data.above, true)}
									<span className="font-inter" style={{ fontSize: fs(16) }}>
										{coord(data.station.latitude, "N", "S")} ·{" "}
										{coord(data.station.longitude, "E", "W")}
									</span>
								</div>
								<div className="font-inter" style={{ ...col, gap: m(5) }}>
									{stat(
										"Speed",
										`${amount(data.station.speed)} ${unit === "mi" ? "mph" : "km/h"}`,
										true,
									)}
									<span className="font-inter" style={{ fontSize: fs(18) }}>
										Altitude {amount(data.station.altitude)} {unit}
									</span>
								</div>
								<div className="font-inter" style={{ ...col, gap: m(5) }}>
									{stat(
										`Ground distance from ${params.location || "you"}`,
										`${amount(data.distance)} ${unit}`,
										true,
									)}
									{markers.far ? (
										<span className="font-inter" style={{ fontSize: fs(16) }}>
											ISS is on the far side of Earth
										</span>
									) : null}
								</div>
							</>
						)}
					</div>
				</div>
				<ScreenFooter
					screen={screen}
					style={{
						...text,
						height: footerHeight,
						backgroundColor: "#fff",
						borderTop: "1px solid #000",
						borderRadius: 0,
						padding: `${m(8)}px 0 0`,
						fontSize: fs(16),
					}}
					left={<span className="font-inter">Dashed: next 52 min</span>}
					right={
						compact ? undefined : (
							<span className="font-inter">
								NASA ·{" "}
								{data.cloudDate
									? `Clouds ${data.cloudDate}`
									: "Blue & Black Marble"}
							</span>
						)
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
		slug: "flyover",
		title: "Flyover · ISS",
		published: true,
		category: "environment",
		version: "1.0.0",
		description:
			"The International Space Station over a sunlit 3D Earth, with night lights, a 52-minute ground track, speed, altitude and distance from you. Adapted from Baszert's Flyover.",
		author: { name: "Baszert", github: "Baszert" },
		tags: ["space", "ISS", "astronomy", "earth", "location"],
		dataRefreshSeconds: 60,
		renderSettings: {
			imageDither: false,
			paletteReduction: "floyd-steinberg",
			supersample: false,
			cacheSeconds: 30,
		},
	},
	paramsSchema,
	dataSchema,
	getData,
	Component: Flyover,
};
