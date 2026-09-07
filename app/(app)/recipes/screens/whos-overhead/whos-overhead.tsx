import type { CSSProperties } from "react";
import type { RecipeDefinition } from "@/lib/recipes/types";
import {
	createScreenProfile,
	type ScreenProfile,
} from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";
import getOverheadData from "./getData";
import { dataSchema, type OverheadData, paramsSchema } from "./schema";

export { dataSchema, paramsSchema } from "./schema";

const row: CSSProperties = { display: "flex", flexDirection: "row" };
const col: CSSProperties = { display: "flex", flexDirection: "column" };
const clip: CSSProperties = {
	overflow: "hidden",
	whiteSpace: "nowrap",
	textOverflow: "ellipsis",
};
function radar(distance: number | null, bearing: number, radius: number) {
	const angle = (bearing * Math.PI) / 180,
		r = Math.min((distance ?? 0) / radius, 1) * 66;
	const x = 100 + Math.sin(angle) * r,
		y = 100 - Math.cos(angle) * r;
	const ticks = Array.from({ length: 48 }, (_, i) => {
		const a = (i * Math.PI) / 24;
		const r = i % 4 === 0 ? 77 : 81;
		return `<path d="M${100 + Math.sin(a) * r} ${100 - Math.cos(a) * r}L${100 + Math.sin(a) * 85} ${100 - Math.cos(a) * 85}"/>`;
	}).join("");
	const body = `<g fill="none" stroke="black" stroke-width="1">${ticks}<circle cx="100" cy="100" r="66"/><circle cx="100" cy="100" r="33" stroke-dasharray="1 5"/><path d="M100 28V172 M28 100H172" stroke-dasharray="1 5"/>${distance === null ? "" : `<path d="M100 100L${x} ${y}" stroke-width="1.5"/>`}</g><circle cx="100" cy="100" r="3" fill="black"/>${distance === null ? "" : `<circle cx="${x}" cy="${y}" r="8" fill="black" stroke="white" stroke-width="2"/>`}<path d="M96 10V2L104 10V2" fill="none" stroke="black" stroke-width="1.5"/>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">${body}</svg>`)}`;
}
export default function WhosOverhead({
	data,
	width = 800,
	height = 480,
	screen,
}: {
	data: OverheadData;
	width?: number;
	height?: number;
	screen?: ScreenProfile;
}) {
	const profile = screen ?? createScreenProfile({ width, height });
	const w = profile.logicalWidth,
		h = profile.logicalHeight,
		portrait = h > w;
	const compact = h < 350;
	const scale = Math.min(w / (portrait ? 520 : 800), h / 480);
	const f = (n: number) => Math.max(compact ? 11 : 13, Math.round(n * scale));
	const pad = Math.round(24 * scale),
		ac = data.aircraft;
	const direction = ac
		? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
				Math.round(ac.bearing / 45) % 8
			]
		: "";
	const updated = data.updated
		? `${new Date(data.updated).toISOString().slice(11, 16)} UTC`
		: "Unavailable";
	const small: CSSProperties = {
		fontSize: f(12),
		letterSpacing: compact ? 0.5 : 1,
		lineHeight: 1.2,
	};
	const codeSize = f(
		ac && Math.max(ac.origin.length, ac.destination.length) > 3 ? 54 : 70,
	);
	const locatorSize = Math.round((portrait ? 205 : 126) * scale);
	const routeKnown = ac && ac.origin !== "—" && ac.destination !== "—";
	return (
		<PreSatori width={w} height={h}>
			<div
				className="font-inter"
				style={{
					...col,
					width: w,
					height: h,
					padding: pad,
					boxSizing: "border-box",
					lineHeight: 1.2,
					backgroundColor: "white",
					color: "black",
					overflow: "hidden",
				}}
			>
				<div
					className="font-inter"
					style={{
						...row,
						justifyContent: "space-between",
						alignItems: "center",
						paddingBottom: 12 * scale,
						borderBottom: "2px solid black",
						gap: 12 * scale,
						flexShrink: 0,
					}}
				>
					<div className="font-inter" style={{ ...small, fontWeight: 700 }}>
						WHO’S OVERHEAD
					</div>
					<div
						className="font-inter"
						style={{ ...small, ...clip, maxWidth: "55%" }}
					>
						{data.location.toUpperCase()} / {data.radiusKm} KM
					</div>
				</div>
				{ac ? (
					<>
						<div
							className="font-inter"
							style={{
								...row,
								alignItems: "center",
								gap: 14 * scale,
								paddingTop: 12 * scale,
								paddingBottom: 8 * scale,
								flexShrink: 0,
							}}
						>
							{ac.logo ? (
								<img
									src={ac.logo}
									alt={`${ac.airline} logo`}
									width={Math.round(62 * scale)}
									height={Math.round(48 * scale)}
									style={{ objectFit: "contain" }}
								/>
							) : null}
							<div
								className="font-inter"
								style={{ ...col, flex: 1, minWidth: 0, gap: 4 * scale }}
							>
								<div
									className="font-inter"
									style={{ fontSize: f(21), ...clip }}
								>
									{ac.airline}
								</div>
								{!compact ? (
									<div className="font-inter" style={{ ...small }}>
										NEAREST AIRCRAFT
									</div>
								) : null}
							</div>
							<div
								className="font-inter"
								style={{
									fontSize: f(27),
									fontWeight: 600,
									whiteSpace: "nowrap",
									flexShrink: 0,
									lineHeight: 1.2,
								}}
							>
								{ac.callsign}
							</div>
						</div>
						<div
							className="font-inter"
							style={{
								...row,
								flexDirection: portrait ? "column" : "row",
								flex: 1,
								minHeight: 0,
								gap: 22 * scale,
								paddingTop: 8 * scale,
								paddingBottom: 16 * scale,
							}}
						>
							<div
								className="font-inter"
								style={{
									...col,
									flex: 1,
									minWidth: 0,
									justifyContent: "center",
									gap: 22 * scale,
								}}
							>
								{routeKnown ? (
									<div
										className="font-inter"
										style={{ ...col, gap: 6 * scale }}
									>
										<div
											className="font-inter"
											style={{ ...row, gap: 12 * scale }}
										>
											<div
												className="font-inter"
												style={{
													...small,
													flex: 1,
													textAlign: "center",
													justifyContent: "center",
												}}
											>
												FROM
											</div>
											<div
												className="font-inter"
												style={{ width: 32 * scale, flexShrink: 0 }}
											/>
											<div
												className="font-inter"
												style={{
													...small,
													flex: 1,
													textAlign: "center",
													justifyContent: "center",
												}}
											>
												TO
											</div>
										</div>
										<div
											className="font-inter"
											style={{ ...row, alignItems: "center", gap: 12 * scale }}
										>
											<div
												className="font-inter"
												style={{
													flex: 1,
													minWidth: 0,
													textAlign: "center",
													justifyContent: "center",
													fontSize: codeSize,
													fontWeight: 600,
													letterSpacing: -2 * scale,
													lineHeight: 1.1,
												}}
											>
												{ac.origin}
											</div>
											<div
												className="font-inter"
												style={{
													width: 32 * scale,
													flexShrink: 0,
													fontSize: f(30),
													lineHeight: 1,
													textAlign: "center",
												}}
											>
												→
											</div>
											<div
												className="font-inter"
												style={{
													flex: 1,
													minWidth: 0,
													textAlign: "center",
													justifyContent: "center",
													fontSize: codeSize,
													fontWeight: 600,
													letterSpacing: -2 * scale,
													lineHeight: 1.1,
												}}
											>
												{ac.destination}
											</div>
										</div>
										<div
											className="font-inter"
											style={{ ...row, gap: 12 * scale }}
										>
											<div
												className="font-inter"
												style={{
													...clip,
													flex: 1,
													minWidth: 0,
													textAlign: "center",
													justifyContent: "center",
													fontSize: f(16),
												}}
											>
												{ac.originCity}
											</div>
											<div
												className="font-inter"
												style={{ width: 32 * scale, flexShrink: 0 }}
											/>
											<div
												className="font-inter"
												style={{
													...clip,
													flex: 1,
													minWidth: 0,
													textAlign: "center",
													justifyContent: "center",
													fontSize: f(16),
												}}
											>
												{ac.destinationCity}
											</div>
										</div>
									</div>
								) : (
									<div
										className="font-inter"
										style={{ ...col, gap: 8 * scale }}
									>
										<div className="font-inter" style={small}>
											PASSING NEARBY
										</div>
										<div
											className="font-inter"
											style={{ fontSize: f(45), letterSpacing: -1 }}
										>
											Journey unknown
										</div>
										<div className="font-inter" style={{ fontSize: f(17) }}>
											No route reported for this callsign.
										</div>
									</div>
								)}
								{!compact ? (
									<div
										className="font-inter"
										style={{
											...row,
											gap: 10 * scale,
											alignItems: "center",
											fontSize: f(16),
										}}
									>
										<div
											className="font-inter"
											style={{ ...clip, fontWeight: 600 }}
										>
											{ac.model}
										</div>
										<div className="font-inter" style={{ ...clip }}>
											/ {ac.registration}
										</div>
									</div>
								) : null}
							</div>
							{!compact ? (
								<div
									className="font-inter"
									style={{
										...col,
										width: portrait ? "100%" : 206 * scale,
										alignItems: "center",
										justifyContent: "center",
										borderLeft: portrait ? undefined : "1px solid black",
										paddingLeft: portrait ? 0 : 20 * scale,
										flexShrink: 0,
									}}
								>
									<img
										src={radar(ac.distanceKm, ac.bearing, data.radiusKm)}
										alt={`Aircraft ${ac.distanceKm.toFixed(1)} km ${direction} of your location`}
										width={locatorSize}
										height={locatorSize}
									/>
									<div
										className="font-inter"
										style={{
											fontSize: f(25),
											fontWeight: 600,
											letterSpacing: 0,
										}}
									>
										{ac.distanceKm.toFixed(1)} km {direction}
									</div>
									<div
										className="font-inter"
										style={{
											...small,
											marginTop: 6 * scale,
											paddingBottom: 8 * scale,
											whiteSpace: "nowrap",
										}}
									>
										FROM YOU
									</div>
								</div>
							) : null}
						</div>
						<div
							className="font-inter"
							style={{
								...row,
								borderTop: "2px solid black",
								paddingTop: 12 * scale,
								paddingBottom: 8 * scale,
								flexShrink: 0,
							}}
						>
							{[
								{
									label: "ALTITUDE",
									value:
										ac.altitude === null
											? "—"
											: Math.round(ac.altitude).toLocaleString("en-US"),
									unit: "ft",
								},
								{
									label: "GROUND SPEED",
									value: ac.speed === null ? "—" : String(Math.round(ac.speed)),
									unit: "kt",
								},
								{
									label: compact ? "DISTANCE" : "TRACK",
									value: compact
										? ac.distanceKm.toFixed(1)
										: ac.heading === null
											? "—"
											: `${String(Math.round(ac.heading) % 360).padStart(3, "0")}°`,
									unit: compact ? "km" : "",
								},
							].map((stat, i) => (
								<div
									key={stat.label}
									className="font-inter"
									style={{
										...col,
										flex: 1,
										paddingLeft: i ? 18 * scale : 0,
										borderLeft: i ? "1px solid black" : undefined,
										gap: 4 * scale,
									}}
								>
									<div className="font-inter" style={small}>
										{stat.label}
									</div>
									<div
										className="font-inter"
										style={{ ...row, alignItems: "baseline", gap: 8 * scale }}
									>
										<div
											className="font-inter"
											style={{
												fontSize: f(29),
												fontWeight: 600,
												letterSpacing: 0,
												lineHeight: 1.2,
											}}
										>
											{stat.value}
										</div>
										<div className="font-inter" style={{ fontSize: f(15) }}>
											{stat.unit}
										</div>
									</div>
								</div>
							))}
						</div>
					</>
				) : (
					<div
						className="font-inter"
						style={{
							...col,
							flex: 1,
							justifyContent: "center",
							alignItems: "center",
							gap: 12 * scale,
						}}
					>
						{!compact ? (
							<img
								src={radar(null, 0, data.radiusKm)}
								alt="Observation area"
								width={Math.round(165 * scale)}
								height={Math.round(165 * scale)}
							/>
						) : null}
						<div
							className="font-inter"
							style={{ fontSize: f(36), fontWeight: 600, letterSpacing: -1 }}
						>
							{data.status === "empty"
								? "A quiet patch of sky"
								: "Sky feed unavailable"}
						</div>
						<div
							className="font-inter"
							style={{ fontSize: f(17), textAlign: "center" }}
						>
							{data.status === "empty"
								? `No aircraft reported within ${data.radiusKm} km.`
								: "Could not get a current position report. Try again later."}
						</div>
					</div>
				)}
				<div
					className="font-inter"
					style={{
						...row,
						justifyContent: "space-between",
						borderTop: "1px solid black",
						paddingTop: 10 * scale,
						fontSize: f(11),
						gap: 12 * scale,
						flexShrink: 0,
					}}
				>
					<div className="font-inter" style={clip}>
						{data.status === "demo"
							? "SAMPLE FLIGHT / DEMO"
							: data.status === "live"
								? `ADSB.LOL / ${data.count} AIRCRAFT NEARBY`
								: "ADSB.LOL / COVERAGE VARIES"}
					</div>
					<div className="font-inter" style={{ whiteSpace: "nowrap" }}>
						{data.status === "error" ? "CHECKED" : "UPDATED"} {updated}
					</div>
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
		slug: "whos-overhead",
		title: "Who’s Overhead?",
		description:
			"A live flight card with airline branding, a bold route, flight details and a local sky locator.",
		category: "travel",
		tags: ["aviation", "flights", "live", "location"],
		published: true,
		version: "1.1.0",
	},
	paramsSchema,
	dataSchema,
	getData: getOverheadData,
	Component: ({ data, width, height, screen }) => (
		<WhosOverhead data={data} width={width} height={height} screen={screen} />
	),
};
