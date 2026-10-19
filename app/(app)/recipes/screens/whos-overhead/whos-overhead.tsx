import type { CSSProperties, ReactNode } from "react";
import {
	ScreenCanvas,
	ScreenFooter,
	screenFontSize,
	screenMetric,
} from "@/components/trmnl/screen-layout";
import type { RecipeDefinition, RecipeRenderProps } from "@/lib/recipes/types";
import { createScreenProfile } from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";
import getOverheadData from "./getData";
import { flightPhase, placeTag } from "./placement";
import {
	altitudeBarArt,
	arrowArt,
	planeIconArt,
	radarArt,
	routeTrackArt,
} from "./radar";
import { dataSchema, type OverheadData, paramsSchema } from "./schema";

export { dataSchema, paramsSchema } from "./schema";

const row: CSSProperties = { display: "flex", flexDirection: "row" };
const col: CSSProperties = { display: "flex", flexDirection: "column" };
const clip: CSSProperties = {
	overflow: "hidden",
	whiteSpace: "nowrap",
	textOverflow: "ellipsis",
};
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (bearing: number) => POINTS[Math.round(bearing / 45) % 8];
const thousands = (value: number) => Math.round(value).toLocaleString("en-US");

export default function WhosOverhead({
	data,
	width = 800,
	height = 480,
	screen = createScreenProfile({ width, height }),
}: RecipeRenderProps & { data: OverheadData }) {
	const w = screen.logicalWidth;
	const h = screen.logicalHeight;
	const stacked = screen.orientation === "portrait" || screen.isHalfScreen;
	const compact = screen.isCompact || screen.isHalfScreen;
	// Narrow portrait screens still have room for everything; only short ones drop extras.
	const brief = screen.isHalfScreen || h < 420;
	const m = (value: number) => screenMetric(screen, value);
	const f = (value: number, minimum?: number) =>
		screenFontSize(screen, value, minimum);

	const padding = compact ? m(12) : m(screen.isLarge ? 28 : 18);
	const gap = compact ? m(8) : m(screen.isLarge ? 16 : 10);
	const footerHeight = f(compact ? 16 : 20, 16) + m(7) * 2;
	const mainWidth = w - padding * 2;
	const mainHeight = h - padding * 2 - gap - footerHeight;
	const columnGap = m(stacked ? 12 : 22);
	const stroke = Math.max(2, m(2));
	const ac = data.aircraft;
	// Stacked layouts give the scope whatever height the details leave.
	const radarSize = Math.max(
		1,
		Math.round(
			stacked
				? Math.min(
						mainWidth,
						mainHeight -
							columnGap -
							(ac
								? detailsHeight({
										compact,
										brief,
										large: screen.isLarge,
										stroke,
										logo: !!ac.logo,
										f,
										m,
									})
								: f(16) * 1.1 + f(40) * 2.1 + f(18) * 3.9 + m(20)),
					)
				: Math.min(mainHeight, mainWidth * 0.5),
		),
	);
	const panelWidth = stacked ? mainWidth : mainWidth - radarSize - columnGap;

	const radar = radarArt({
		size: radarSize,
		radiusKm: data.radiusKm,
		stroke,
		// Half a compass letter's knockout, so N/E/S/W never clip at the edges.
		inset: Math.round(f(16) * 0.75),
		traffic: data.traffic,
		target: ac
			? {
					distanceKm: ac.distanceKm,
					bearing: ac.bearing,
					heading: ac.heading,
					speedKt: ac.speed,
				}
			: undefined,
	});
	const updated = data.updated
		? `${new Date(data.updated).toISOString().slice(11, 16)} UTC`
		: "unavailable";
	// Compact footers drop the place name so the time still fits.
	const footerLeft =
		data.status === "demo"
			? "Sample flight · demo"
			: data.status === "live"
				? compact
					? `${data.count} aircraft · ${data.radiusKm} km`
					: `${data.location} · ${data.count} aircraft within ${data.radiusKm} km`
				: compact
					? `${data.radiusKm} km`
					: `${data.location} · ${data.radiusKm} km`;

	return (
		<PreSatori width={w} height={h}>
			<ScreenCanvas
				className="font-inter"
				screen={screen}
				style={{ padding, gap, fontFamily: "inter" }}
			>
				<div
					className="font-inter"
					style={{
						...(stacked ? col : row),
						flex: 1,
						minHeight: 0,
						alignItems: stacked ? "center" : "stretch",
						gap: columnGap,
					}}
				>
					<div
						className="font-inter"
						style={{
							...row,
							flex: stacked ? 1 : undefined,
							minHeight: 0,
							alignItems: "center",
							justifyContent: "center",
							flexShrink: 0,
						}}
					>
						<Scope
							size={radarSize}
							ring={radar.ring}
							src={radar.src}
							target={radar.target}
							callsign={ac?.callsign}
							radiusKm={data.radiusKm}
							f={f}
							m={m}
						/>
					</div>
					<div
						className="font-inter"
						style={{
							...col,
							width: panelWidth,
							flex: stacked ? undefined : 1,
							flexShrink: 0,
							minHeight: 0,
							justifyContent: stacked ? "flex-start" : "space-between",
							gap: m(compact ? 10 : 14),
						}}
					>
						{ac ? (
							<FlightDetails
								data={data}
								width={panelWidth}
								compact={compact}
								brief={brief}
								large={screen.isLarge}
								fill={!stacked}
								stroke={stroke}
								f={f}
								m={m}
							/>
						) : (
							<QuietSky data={data} f={f} m={m} />
						)}
					</div>
				</div>
				<ScreenFooter
					className="font-inter"
					screen={screen}
					style={{ fontFamily: "inter" }}
					left={footerLeft}
					right={
						compact
							? updated
							: `${data.status === "error" ? "Checked" : "Updated"} ${updated}`
					}
				/>
			</ScreenCanvas>
		</PreSatori>
	);
}

type Sizer = (value: number, minimum?: number) => number;

/** Space between the detail sections; large screens get more air, not bigger type. */
const sectionGap = (compact: boolean, large: boolean, m: Sizer) =>
	m(large ? 24 : compact ? 10 : 14);

function Scope({
	size,
	ring,
	src,
	target,
	callsign,
	radiusKm,
	f,
	m,
}: {
	size: number;
	ring: number;
	src: string;
	target?: { x: number; y: number; size: number };
	callsign?: string;
	radiusKm: number;
	f: Sizer;
	m: Sizer;
}) {
	const c = size / 2;
	const letter = f(16);
	const box = Math.round(letter * 1.5);
	const knockout = (left: number, top: number, text: string) => (
		<div
			key={text}
			style={{
				position: "absolute",
				left: Math.round(left - box / 2),
				top: Math.round(top - box / 2),
				width: box,
				height: box,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: "white",
				fontSize: letter,
				fontWeight: 700,
				lineHeight: 1,
			}}
		>
			{text}
		</div>
	);
	const tag = (() => {
		if (!target || !callsign) return null;
		const font = f(16);
		const tagHeight = Math.round(font * 1.6);
		const tagWidth = Math.round(callsign.length * font * 0.66 + m(14));
		const { left, top } = placeTag({
			target,
			centre: c,
			size,
			width: tagWidth,
			height: tagHeight,
			gap: m(4),
			keepOut: size * 0.05,
		});
		return (
			<div
				style={{
					position: "absolute",
					left: Math.round(left),
					top: Math.round(top),
					width: tagWidth,
					height: tagHeight,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: "black",
					color: "white",
					borderRadius: m(6),
					fontSize: font,
					fontWeight: 700,
					lineHeight: 1,
				}}
			>
				{callsign}
			</div>
		);
	})();
	const ringLabelFont = f(14);
	return (
		<div
			style={{
				position: "relative",
				display: "flex",
				width: size,
				height: size,
				flexShrink: 0,
			}}
		>
			<img src={src} alt="Aircraft around you" width={size} height={size} />
			{knockout(c, c - ring, "N")}
			{knockout(c + ring, c, "E")}
			{knockout(c, c + ring, "S")}
			{knockout(c - ring, c, "W")}
			<div
				style={{
					position: "absolute",
					right: 0,
					bottom: 0,
					display: "flex",
					backgroundColor: "white",
					paddingLeft: m(4),
					fontSize: ringLabelFont,
					lineHeight: 1,
				}}
			>
				{radiusKm} km
			</div>
			{tag}
		</div>
	);
}

function Label({ children, f }: { children: ReactNode; f: Sizer }) {
	return (
		<div
			style={{
				fontSize: f(16),
				lineHeight: 1.1,
				letterSpacing: 1,
				textTransform: "uppercase",
				whiteSpace: "nowrap",
			}}
		>
			{children}
		</div>
	);
}

function FlightDetails({
	data,
	width,
	compact,
	brief,
	large,
	fill,
	stroke,
	f,
	m,
}: {
	data: OverheadData;
	width: number;
	compact: boolean;
	brief: boolean;
	large: boolean;
	fill: boolean;
	stroke: number;
	f: Sizer;
	m: Sizer;
}) {
	const ac = data.aircraft;
	if (!ac) return null;
	const phase = flightPhase(ac.altitude, ac.verticalRate);
	const routeKnown = ac.origin !== "—" && ac.destination !== "—";
	const total =
		ac.routeFlownKm !== null && ac.routeRemainingKm !== null
			? ac.routeFlownKm + ac.routeRemainingKm
			: null;
	const progress =
		total && ac.routeFlownKm !== null
			? Math.min(Math.max(ac.routeFlownKm / total, 0), 1)
			: null;
	const cardPadding = m(compact ? 10 : 14);
	const trackWidth = Math.max(1, width - cardPadding * 2 - stroke * 2);
	const codeSize = f(
		Math.max(ac.origin.length, ac.destination.length) > 3
			? compact
				? 36
				: 46
			: compact
				? 44
				: 58,
	);
	const tileWidth = Math.max(1, Math.floor((width - m(16) * 2) / 3));
	const value = f(compact ? 24 : 30);
	const unit = f(16);
	const overhead = ac.distanceKm < 1.5;
	const logoHeight = m(compact ? 34 : 44);

	return (
		<div
			style={{
				...col,
				flex: fill ? 1 : undefined,
				minHeight: 0,
				justifyContent: "center",
				gap: sectionGap(compact, large, m),
			}}
		>
			{/* Who: airline mark, callsign, operator, and what it is doing. */}
			<div style={{ ...row, alignItems: "center", gap: m(12), flexShrink: 0 }}>
				{ac.logo ? (
					<img
						src={ac.logo}
						alt={`${ac.airline} logo`}
						width={Math.round(logoHeight * 1.4)}
						height={logoHeight}
						style={{ objectFit: "contain", flexShrink: 0 }}
					/>
				) : null}
				<div style={{ ...col, flex: 1, minWidth: 0, gap: m(2) }}>
					<div
						style={{
							...clip,
							fontSize: f(compact ? 26 : 32),
							fontWeight: 700,
							letterSpacing: -0.5,
							lineHeight: 1.05,
						}}
					>
						{ac.callsign}
					</div>
					<div style={{ ...clip, fontSize: f(compact ? 16 : 18) }}>
						{ac.airline}
					</div>
				</div>
				{phase ? (
					<div
						style={{
							...row,
							alignItems: "center",
							flexShrink: 0,
							gap: m(6),
							padding: `${m(5)}px ${m(10)}px`,
							borderRadius: m(20),
							backgroundColor: "black",
							color: "white",
							fontSize: f(16),
							lineHeight: 1,
						}}
					>
						<img
							src={arrowArt({
								size: f(16),
								bearing: phase.arrow,
								color: "white",
								background: "black",
							})}
							alt=""
							width={f(16)}
							height={f(16)}
						/>
						{phase.label}
					</div>
				) : null}
			</div>

			{/* Where: the journey as a track with the aircraft on it. */}
			<div
				style={{
					...col,
					flexShrink: 0,
					border: `${stroke}px solid black`,
					borderRadius: m(14),
					padding: cardPadding,
					gap: m(compact ? 4 : 8),
				}}
			>
				{routeKnown ? (
					<div style={{ ...col, gap: m(compact ? 4 : 8) }}>
						<div
							style={{
								...row,
								justifyContent: "space-between",
								alignItems: "flex-end",
								gap: m(8),
							}}
						>
							<div
								style={{
									fontSize: codeSize,
									fontWeight: 700,
									letterSpacing: -1.5,
									lineHeight: 0.95,
								}}
							>
								{ac.origin}
							</div>
							{progress !== null && !brief ? (
								<div
									style={{
										...col,
										alignItems: "center",
										paddingBottom: m(4),
									}}
								>
									<div
										style={{ fontSize: f(26), fontWeight: 700, lineHeight: 1 }}
									>
										{Math.round(progress * 100)}%
									</div>
									<Label f={f}>flown</Label>
								</div>
							) : null}
							<div
								style={{
									fontSize: codeSize,
									fontWeight: 700,
									letterSpacing: -1.5,
									lineHeight: 0.95,
								}}
							>
								{ac.destination}
							</div>
						</div>
						<img
							src={routeTrackArt({
								width: trackWidth,
								height: m(compact ? 22 : 28),
								progress,
								stroke,
							})}
							alt=""
							width={trackWidth}
							height={m(compact ? 22 : 28)}
						/>
						<div
							style={{
								...row,
								justifyContent: "space-between",
								gap: m(12),
								fontSize: f(compact ? 16 : 18),
							}}
						>
							<div style={{ ...clip, flex: 1, minWidth: 0 }}>
								{ac.originCity}
							</div>
							<div
								style={{
									...clip,
									flex: 1,
									minWidth: 0,
									textAlign: "right",
									justifyContent: "flex-end",
								}}
							>
								{ac.destinationCity}
							</div>
						</div>
						{ac.routeRemainingKm !== null && !brief ? (
							<div
								style={{
									...row,
									justifyContent: "center",
									paddingTop: m(6),
									borderTop: `${Math.max(1, Math.round(stroke / 2))}px solid black`,
									fontSize: f(16),
									lineHeight: 1.2,
									whiteSpace: "nowrap",
								}}
							>
								{`${thousands(ac.routeRemainingKm)} km to go${total === null ? "" : ` of ${thousands(total)} km`}`}
							</div>
						) : null}
					</div>
				) : (
					<div style={{ ...col, gap: m(4) }}>
						<Label f={f}>Passing through</Label>
						<div
							style={{
								fontSize: f(compact ? 26 : 34),
								fontWeight: 700,
								letterSpacing: -0.5,
								lineHeight: 1.1,
							}}
						>
							Route not published
						</div>
						<div style={{ fontSize: f(16) }}>
							No flight plan is on file for this callsign.
						</div>
					</div>
				)}
			</div>

			{/* What: the airframe. */}
			{!brief ? (
				<div
					style={{
						flexShrink: 0,
						...row,
						alignItems: "center",
						gap: m(10),
						fontSize: f(18),
					}}
				>
					<img
						src={planeIconArt({ size: f(20) })}
						alt=""
						width={f(20)}
						height={f(20)}
					/>
					<div style={{ ...clip, fontWeight: 700, flexShrink: 1 }}>
						{ac.model}
					</div>
					<div style={{ ...clip, flexShrink: 0 }}>{ac.registration}</div>
				</div>
			) : null}

			{/* How: altitude, speed and where to look. */}
			<div
				style={{
					...row,
					flexShrink: 0,
					borderTop: `${stroke}px solid black`,
					paddingTop: m(compact ? 8 : 12),
					gap: m(16),
				}}
			>
				<Stat
					label="Altitude"
					value={ac.altitude === null ? "—" : thousands(ac.altitude)}
					unit="ft"
					sizes={{ value, unit }}
					f={f}
					m={m}
				>
					<img
						src={altitudeBarArt({
							width: tileWidth,
							height: m(12),
							altitude: ac.altitude,
							stroke,
						})}
						alt=""
						width={tileWidth}
						height={m(12)}
					/>
				</Stat>
				<Stat
					label="Speed"
					value={ac.speed === null ? "—" : String(Math.round(ac.speed))}
					unit="kt"
					sizes={{ value, unit }}
					f={f}
					m={m}
				>
					<div style={{ fontSize: f(16), lineHeight: 1 }}>
						{ac.speed === null
							? "No speed report"
							: `${thousands(ac.speed * 1.852)} km/h`}
					</div>
				</Stat>
				<Stat
					label={overhead ? "Overhead" : "Distance"}
					value={ac.distanceKm.toFixed(1)}
					unit="km"
					sizes={{ value, unit }}
					f={f}
					m={m}
				>
					<div style={{ ...row, alignItems: "center", gap: m(6) }}>
						<img
							src={arrowArt({ size: f(16), bearing: ac.bearing })}
							alt=""
							width={f(16)}
							height={f(16)}
						/>
						<div style={{ fontSize: f(16), lineHeight: 1 }}>
							{overhead ? "Above you" : `${compass(ac.bearing)} of you`}
						</div>
					</div>
				</Stat>
			</div>
		</div>
	);
}

/** Height FlightDetails will take, so a stacked scope can have the rest. */
function detailsHeight({
	compact,
	brief,
	large,
	stroke,
	logo,
	f,
	m,
}: {
	compact: boolean;
	brief: boolean;
	large: boolean;
	stroke: number;
	logo: boolean;
	f: Sizer;
	m: Sizer;
}) {
	const gap = sectionGap(compact, large, m);
	const inner = m(compact ? 4 : 8);
	const identity = Math.max(
		logo ? m(compact ? 34 : 44) : 0,
		f(compact ? 26 : 32) * 1.05 + m(2) + f(compact ? 16 : 18) * 1.2,
	);
	const codes = Math.max(
		f(compact ? 44 : 58) * 0.95,
		brief ? 0 : f(26) + f(16) * 1.1 + m(4),
	);
	const card =
		stroke * 2 +
		m(compact ? 10 : 14) * 2 +
		codes +
		inner * 2 +
		m(compact ? 22 : 28) +
		f(compact ? 16 : 18) * 1.2 +
		(brief ? 0 : inner + m(6) + f(16) * 1.2 + 1);
	const airframe = brief ? 0 : f(20) + gap;
	const stats =
		stroke +
		m(compact ? 8 : 12) +
		f(16) * 1.1 +
		m(5) * 2 +
		f(compact ? 24 : 30) +
		Math.max(m(12), f(16));
	return Math.ceil((identity + card + airframe + stats + gap * 2) * 1.04);
}

function Stat({
	label,
	value,
	unit,
	sizes,
	children,
	f,
	m,
}: {
	label: string;
	value: string;
	unit: string;
	sizes: { value: number; unit: number };
	children: ReactNode;
	f: Sizer;
	m: Sizer;
}) {
	return (
		<div style={{ ...col, flex: 1, minWidth: 0, gap: m(5) }}>
			<Label f={f}>{label}</Label>
			<div style={{ ...row, alignItems: "baseline", gap: m(4) }}>
				<div
					style={{
						fontSize: sizes.value,
						fontWeight: 700,
						letterSpacing: -0.5,
						lineHeight: 1,
					}}
				>
					{value}
				</div>
				<div style={{ fontSize: sizes.unit, lineHeight: 1 }}>{unit}</div>
			</div>
			{children}
		</div>
	);
}

function QuietSky({ data, f, m }: { data: OverheadData; f: Sizer; m: Sizer }) {
	const empty = data.status === "empty";
	return (
		<div style={{ ...col, flex: 1, justifyContent: "center", gap: m(10) }}>
			<Label f={f}>{empty ? "Nothing in range" : "Feed offline"}</Label>
			<div
				style={{
					fontSize: f(40),
					fontWeight: 700,
					letterSpacing: -1,
					lineHeight: 1.05,
				}}
			>
				{empty ? "A quiet patch of sky" : "Sky feed unavailable"}
			</div>
			<div style={{ fontSize: f(18), lineHeight: 1.3 }}>
				{empty
					? `No aircraft reported within ${data.radiusKm} km of ${data.location}. Coverage depends on nearby ADS-B receivers.`
					: "Could not get a current position report. Trying again on the next refresh."}
			</div>
		</div>
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
			"A live sky scope of every aircraft around you, with the nearest flight's route progress, altitude, speed and where to look.",
		category: "travel",
		tags: ["aviation", "flights", "live", "location"],
		published: true,
		version: "2.0.0",
		dataRefreshSeconds: 30,
	},
	paramsSchema,
	dataSchema,
	getData: getOverheadData,
	Component: ({ data, width, height, screen }) => (
		<WhosOverhead data={data} width={width} height={height} screen={screen} />
	),
};
