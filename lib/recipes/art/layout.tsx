import type { RecipeRenderProps } from "@/lib/recipes/types";
import { editionLabel } from "./daily";
export function DailyArtLayout({
	width = 800,
	height = 480,
	series,
	title,
	subtitle,
	note,
	date,
	svg,
}: RecipeRenderProps & {
	series: string;
	title: string;
	subtitle: string;
	note: string;
	date: string;
	svg: string;
}) {
	const portrait = height > width;
	const pad = Math.round(Math.min(width, height) * 0.065);
	const imageSize = Math.floor(
		portrait
			? Math.min(width - pad * 2, height * 0.52)
			: Math.min(height - pad * 2 - 48, width * 0.5),
	);
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width,
				height,
				padding: pad,
				background: "white",
				color: "black",
				fontFamily: "inter",
				fontWeight: 500,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					borderTop: "2px solid black",
					paddingTop: 10,
					fontSize: 11,
					letterSpacing: 2,
				}}
			>
				<span>{series}</span>
				<span>DAILY EDITION</span>
			</div>
			<div
				style={{
					display: "flex",
					flex: 1,
					flexDirection: portrait ? "column" : "row",
					alignItems: "center",
					justifyContent: "center",
					gap: portrait ? 12 : 30,
				}}
			>
				{/* The recipe rasterizer consumes this exact SVG; Next image optimization is not used in device output. */}
				{/* biome-ignore lint/performance/noImgElement: Device renderer supports image nodes directly. */}
				<img
					src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
					alt={title}
					width={imageSize}
					height={imageSize}
					style={{ flexShrink: 0 }}
				/>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 16,
						flex: portrait ? undefined : 1,
						width: portrait ? "100%" : undefined,
					}}
				>
					<div style={{ display: "flex", fontSize: 11, letterSpacing: 2 }}>
						A SMALL OBSERVATION
					</div>
					<div
						style={{
							display: "flex",
							fontFamily: "inter",
							fontSize: portrait ? 36 : 44,
							lineHeight: 1.05,
						}}
					>
						{title}
					</div>
					<div style={{ display: "flex", fontSize: 17, lineHeight: 1.4 }}>
						{subtitle}
					</div>
					<div
						style={{ display: "flex", width: 36, borderTop: "1px solid black" }}
					/>
					<div style={{ display: "flex", fontSize: 12, lineHeight: 1.6 }}>
						{note}
					</div>
				</div>
			</div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					borderTop: "1px solid black",
					paddingTop: 10,
					fontSize: 11,
				}}
			>
				<span>{editionLabel(date)}</span>
				<span>FIELD NOTES / {date.replaceAll("-", ".")}</span>
			</div>
		</div>
	);
}
