import type { OverheadTraffic } from "./schema";

// Monochrome SVG artwork for the recipe. Every size is in logical pixels; the
// renderer scales the finished canvas. Only black and white are used so the
// device's palette snap keeps every mark crisp on 1-bit panels.

/** Top-down airliner pointing north, centred on 0,0 inside a 24-unit box. */
const PLANE =
	"M0 -11.5C0.9 -11.5 1.5 -10.4 1.5 -9V-3.3L10.8 2.2V4.3L1.5 1.7V7.4L4.3 9.6V11.3L0 10.1L-4.3 11.3V9.6L-1.5 7.4V1.7L-10.8 4.3V2.2L-1.5 -3.3V-9C-1.5 -10.4 -0.9 -11.5 0 -11.5Z";

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const n = (value: number) => Number(value.toFixed(2));
const uri = (width: number, height: number, body: string) =>
	`data:image/svg+xml;utf8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
	)}`;

/** Offset from the scope centre for a report at this distance and bearing. */
export function project(
	distanceKm: number,
	bearing: number,
	radiusKm: number,
	ringRadius: number,
) {
	const r = Math.min(distanceKm / radiusKm, 1) * ringRadius;
	return { x: Math.sin(rad(bearing)) * r, y: -Math.cos(rad(bearing)) * r };
}

function plane(
	x: number,
	y: number,
	heading: number,
	size: number,
	fill: string,
	stroke: string,
	strokeWidth: number,
) {
	const scale = size / 24;
	return `<path d="${PLANE}" transform="translate(${n(x)} ${n(y)}) rotate(${n(heading)}) scale(${n(scale)})" fill="${fill}" stroke="${stroke}" stroke-width="${n(strokeWidth / scale)}" stroke-linejoin="round"/>`;
}

const point = (cx: number, cy: number, r: number, bearing: number) =>
	`${n(cx + Math.sin(rad(bearing)) * r)} ${n(cy - Math.cos(rad(bearing)) * r)}`;

export type RadarTarget = {
	distanceKm: number;
	bearing: number;
	heading: number | null;
	speedKt: number | null;
};

export type RadarArt = {
	src: string;
	/** Ring radius, so overlays can sit on it. */
	ring: number;
	/** Target position inside the square, when there is a target. */
	target?: { x: number; y: number; size: number };
};

/**
 * The sky scope: range rings, a bezel, a hatched sweep trailing the nearest
 * aircraft, every other aircraft in range as an outlined plane on its track,
 * and the nearest as a solid plane with its projected two-minute path.
 */
export function radarArt({
	size,
	radiusKm,
	target,
	traffic = [],
	stroke = 2,
	inset = stroke,
}: {
	size: number;
	radiusKm: number;
	target?: RadarTarget;
	traffic?: OverheadTraffic[];
	stroke?: number;
	/** Gap between the square's edge and the bezel, e.g. room for compass letters. */
	inset?: number;
}): RadarArt {
	const c = size / 2;
	const ring = c - Math.max(inset, stroke);
	const thin = Math.max(1, stroke * 0.6);
	const parts: string[] = [
		`<defs><clipPath id="scope"><circle cx="${c}" cy="${c}" r="${n(ring)}"/></clipPath><pattern id="hatch" width="${n(stroke * 3)}" height="${n(stroke * 3)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${n(thin)}" height="${n(stroke * 3)}" fill="black"/></pattern></defs>`,
		`<circle cx="${c}" cy="${c}" r="${n(ring)}" fill="white"/>`,
	];
	const scope: string[] = [];
	let marker: RadarArt["target"];
	if (target) {
		const p = project(target.distanceKm, target.bearing, radiusKm, ring);
		// A short sweep trailing the target's bearing, the way a scope paints it.
		const sweep = 38;
		const from = target.bearing - sweep;
		scope.push(
			`<path d="M${c} ${c}L${point(c, c, ring, from)}A${n(ring)} ${n(ring)} 0 0 1 ${point(c, c, ring, target.bearing)}Z" fill="url(#hatch)"/>`,
			`<path d="M${c} ${c}L${point(c, c, ring, target.bearing)}" stroke="black" stroke-width="${n(stroke)}"/>`,
		);
		const planeSize = Math.round(size * 0.13);
		marker = { x: c + p.x, y: c + p.y, size: planeSize };
		if (target.heading !== null && target.speedKt) {
			// Where it will be in two minutes at the current ground speed.
			const ahead =
				(((target.speedKt * 1.852) / 60) * 2 * ring) / radiusKm + planeSize / 2;
			scope.push(
				`<path d="M${n(marker.x)} ${n(marker.y)}L${point(marker.x, marker.y, ahead, target.heading)}" stroke="black" stroke-width="${n(stroke)}" stroke-dasharray="${n(stroke * 2)} ${n(stroke * 2)}"/>`,
			);
		}
	}
	// Range rings and crosshair go over the sweep so the hatch reads as a beam.
	for (const fraction of [1 / 3, 2 / 3]) {
		scope.push(
			`<circle cx="${c}" cy="${c}" r="${n(ring * fraction)}" fill="none" stroke="black" stroke-width="${n(thin)}" stroke-dasharray="${n(thin)} ${n(stroke * 3)}" stroke-linecap="round"/>`,
		);
	}
	scope.push(
		`<path d="M${c} ${n(c - ring)}V${n(c + ring)}M${n(c - ring)} ${c}H${n(c + ring)}" stroke="black" stroke-width="${n(thin)}" stroke-dasharray="${n(thin)} ${n(stroke * 3)}" stroke-linecap="round"/>`,
	);
	const blip = Math.max(12, Math.round(size * 0.075));
	for (const other of traffic) {
		const p = project(other.distanceKm, other.bearing, radiusKm, ring);
		scope.push(
			other.heading === null
				? `<rect x="${n(c + p.x - blip / 4)}" y="${n(c + p.y - blip / 4)}" width="${n(blip / 2)}" height="${n(blip / 2)}" transform="rotate(45 ${n(c + p.x)} ${n(c + p.y)})" fill="white" stroke="black" stroke-width="${n(stroke)}"/>`
				: plane(
						c + p.x,
						c + p.y,
						other.heading,
						blip,
						"white",
						"black",
						stroke,
					),
		);
	}
	parts.push(`<g clip-path="url(#scope)">${scope.join("")}</g>`);
	// Bezel: a heavy ring with five-degree ticks, longer every thirty.
	const ticks = Array.from({ length: 72 }, (_, i) => {
		const bearing = i * 5;
		const length = i % 6 === 0 ? size * 0.045 : size * 0.02;
		return `M${point(c, c, ring, bearing)}L${point(c, c, ring - length, bearing)}`;
	}).join("");
	parts.push(
		`<path d="${ticks}" stroke="black" stroke-width="${n(thin)}"/>`,
		`<circle cx="${c}" cy="${c}" r="${n(ring)}" fill="none" stroke="black" stroke-width="${n(stroke * 1.5)}"/>`,
	);
	// You: a filled dot inside a ring.
	parts.push(
		`<circle cx="${c}" cy="${c}" r="${n(size * 0.03)}" fill="white" stroke="black" stroke-width="${n(stroke)}"/>`,
		`<circle cx="${c}" cy="${c}" r="${n(size * 0.012)}" fill="black"/>`,
	);
	if (marker && target) {
		parts.push(
			plane(
				marker.x,
				marker.y,
				target.heading ?? target.bearing,
				marker.size,
				"black",
				"white",
				stroke * 1.5,
			),
		);
	}
	return { src: uri(size, size, parts.join("")), ring, target: marker };
}

/**
 * Origin dot, solid line flown, the plane, dotted line still to go, and a
 * destination ring. Without progress the plane is left out and the line is
 * dotted end to end.
 */
export function routeTrackArt({
	width,
	height,
	progress,
	stroke = 2,
}: {
	width: number;
	height: number;
	progress: number | null;
	stroke?: number;
}) {
	const y = height / 2;
	const end = height * 0.22;
	const left = end + stroke;
	const right = width - end - stroke;
	const x = progress === null ? null : left + (right - left) * progress;
	const parts = [
		`<path d="M${n(x ?? left)} ${n(y)}H${n(right)}" stroke="black" stroke-width="${n(stroke)}" stroke-dasharray="${n(stroke)} ${n(stroke * 3)}" stroke-linecap="round"/>`,
	];
	if (x !== null)
		parts.push(
			`<path d="M${n(left)} ${n(y)}H${n(x)}" stroke="black" stroke-width="${n(stroke * 2)}"/>`,
		);
	parts.push(
		`<circle cx="${n(left)}" cy="${n(y)}" r="${n(end)}" fill="black"/>`,
		`<circle cx="${n(right)}" cy="${n(y)}" r="${n(end)}" fill="white" stroke="black" stroke-width="${n(stroke)}"/>`,
	);
	if (x !== null) {
		// Keep the plane clear of both airport marks even at the very ends.
		const margin = left + end + height / 2;
		const px = Math.min(Math.max(x, margin), width - margin);
		parts.push(plane(px, y, 90, height, "black", "white", stroke * 1.2));
	}
	return uri(width, height, parts.join(""));
}

/** Altitude as a filled bar on a 0–45,000 ft scale with 10,000 ft ticks. */
export function altitudeBarArt({
	width,
	height,
	altitude,
	stroke = 2,
}: {
	width: number;
	height: number;
	altitude: number | null;
	stroke?: number;
}) {
	const ceiling = 45_000;
	const inner = width - stroke * 2;
	const fill =
		altitude === null
			? 0
			: Math.min(Math.max(altitude / ceiling, 0), 1) * (inner - stroke * 2);
	const ticks = [10_000, 20_000, 30_000, 40_000]
		.map((ft) => {
			const x = stroke * 2 + (ft / ceiling) * (inner - stroke * 2);
			return `M${n(x)} ${n(stroke)}V${n(height - stroke)}`;
		})
		.join("");
	return uri(
		width,
		height,
		`<rect x="${n(stroke / 2)}" y="${n(stroke / 2)}" width="${n(width - stroke)}" height="${n(height - stroke)}" rx="${n(height / 2)}" fill="white" stroke="black" stroke-width="${n(stroke)}"/><path d="${ticks}" stroke="black" stroke-width="${n(stroke / 2)}"/>${fill > 0 ? `<rect x="${n(stroke * 2)}" y="${n(stroke * 2)}" width="${n(Math.max(fill, height - stroke * 4))}" height="${n(height - stroke * 4)}" rx="${n((height - stroke * 4) / 2)}" fill="black"/>` : ""}`,
	);
}

/**
 * A solid arrow pointing at `bearing` degrees (0 is up). Device rendering
 * flattens images onto white, so an arrow drawn on a dark element needs that
 * element's colour as an explicit background.
 */
export function arrowArt({
	size,
	bearing,
	color = "black",
	background,
}: {
	size: number;
	bearing: number;
	color?: string;
	background?: string;
}) {
	const c = size / 2;
	return uri(
		size,
		size,
		`${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}<path d="M${c} ${n(size * 0.08)}L${n(size * 0.84)} ${n(size * 0.86)}L${c} ${n(size * 0.66)}L${n(size * 0.16)} ${n(size * 0.86)}Z" transform="rotate(${n(bearing)} ${c} ${c})" fill="${color}"/>`,
	);
}

/** A small top-down plane for inline use next to text. */
export function planeIconArt({
	size,
	heading = 45,
}: {
	size: number;
	heading?: number;
}) {
	return uri(
		size,
		size,
		plane(size / 2, size / 2, heading, size, "black", "none", 0),
	);
}
