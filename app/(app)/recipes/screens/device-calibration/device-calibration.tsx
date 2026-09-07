import { z } from "zod";
import type { RecipeDefinition, RecipeRenderProps } from "@/lib/recipes/types";

export const paramsSchema = z.object({});
export const dataSchema = paramsSchema;

export function DeviceCalibration({
	width = 800,
	height = 480,
	screen,
}: RecipeRenderProps) {
	const compact = width < 600;
	const pad = Math.max(12, Math.round(Math.min(width, height) * 0.035));
	const gradient = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="60"><defs><linearGradient id="g"><stop stop-color="black"/><stop offset="1" stop-color="white"/></linearGradient></defs><rect width="600" height="60" fill="url(#g)"/></svg>`;
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width,
				height,
				padding: pad,
				gap: compact ? 10 : 14,
				background: "white",
				color: "black",
				fontFamily: "inter",
				border: "1px solid black",
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					borderBottom: "2px solid black",
					paddingBottom: 8,
				}}
			>
				<span style={{ fontSize: compact ? 20 : 28 }}>Display calibration</span>
				<span style={{ fontSize: 12 }}>{screen?.paletteId ?? "Preview"}</span>
			</div>
			<div
				style={{ display: "flex", fontSize: 12 }}
			>{`${screen?.physicalWidth ?? width} × ${screen?.physicalHeight ?? height} pixels · ${screen?.modelLabel ?? "TRMNL"}`}</div>
			<div
				style={{
					display: "flex",
					flexDirection: compact ? "column" : "row",
					gap: 20,
					flex: 1,
				}}
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}
				>
					<div style={{ display: "flex", fontSize: 12 }}>
						01 / TYPE & SMALL DETAILS
					</div>
					{[10, 12, 14, 18, 24].map((size) => (
						<div
							key={size}
							style={{ display: "flex", fontSize: size }}
						>{`${size}px · Aa Bb 0123456789`}</div>
					))}
					{[1, 2, 3].map((size) => (
						<div
							key={size}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								fontSize: 11,
							}}
						>
							<span>{size}px</span>
							<div
								style={{
									display: "flex",
									height: size,
									background: "black",
									flex: 1,
								}}
							/>
						</div>
					))}
				</div>
				<div
					style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}
				>
					<div style={{ display: "flex", fontSize: 12 }}>
						02 / TONES & IMAGE DITHER
					</div>
					<div style={{ display: "flex", height: 44 }}>
						{Array.from({ length: 16 }, (_, i) => (
							<div
								key={i.toString()}
								style={{
									display: "flex",
									flex: 1,
									background: `rgb(${i * 17},${i * 17},${i * 17})`,
								}}
							/>
						))}
					</div>
					<img
						alt="Continuous grayscale ramp"
						src={`data:image/svg+xml,${encodeURIComponent(gradient)}`}
						width={Math.max(
							100,
							compact ? width - pad * 2 : (width - pad * 2 - 20) / 2,
						)}
						height={44}
					/>
					<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
						{[2, 4, 8, 16].map((size) => (
							<div
								key={size}
								style={{
									display: "flex",
									width: 44,
									height: 44,
									border: `${size / 2}px solid black`,
									alignItems: "center",
									justifyContent: "center",
									fontSize: 10,
								}}
							>
								{size}
							</div>
						))}
					</div>
				</div>
			</div>
			<div
				style={{
					display: "flex",
					borderTop: "1px solid black",
					paddingTop: 8,
					fontSize: 11,
				}}
			>
				Check all four borders, readable small type, and distinct tones. Compare
				the device preview with your panel.
			</div>
		</div>
	);
}

export const definition: RecipeDefinition<typeof paramsSchema> = {
	meta: {
		slug: "device-calibration",
		title: "Display calibration",
		description:
			"Check typography, borders, grayscale and image dithering on your actual panel.",
		published: true,
		category: "tools",
		tags: ["calibration", "display"],
		version: "1.0.0",
		renderSettings: { supersample: false },
	},
	paramsSchema,
	dataSchema,
	Component: DeviceCalibration,
};
