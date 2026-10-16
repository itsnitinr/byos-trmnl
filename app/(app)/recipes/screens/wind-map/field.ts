import { seededRandom } from "@/lib/recipes/art/daily";
import { GRID_SIZE, type SpeedUnit, type WindSample } from "./schema";

/** Below this the direction is noise, so streamlines stop rather than wander. */
const CALM_KMH = 0.5;

const UNITS: Record<SpeedUnit, { factor: number; label: string }> = {
	kmh: { factor: 1, label: "km/h" },
	mph: { factor: 0.621371, label: "mph" },
	kn: { factor: 0.539957, label: "kn" },
	ms: { factor: 1 / 3.6, label: "m/s" },
};

export function formatSpeed(kmh: number, unit: SpeedUnit): string {
	return String(Math.round(kmh * UNITS[unit].factor));
}
export function unitLabel(unit: SpeedUnit): string {
	return UNITS[unit].label;
}

const BEAUFORT = [
	[1, "Calm"],
	[6, "Light air"],
	[12, "Light breeze"],
	[20, "Gentle breeze"],
	[29, "Moderate breeze"],
	[39, "Fresh breeze"],
	[50, "Strong breeze"],
	[62, "Near gale"],
	[75, "Gale"],
	[89, "Strong gale"],
	[103, "Storm"],
	[118, "Violent storm"],
] as const;
export function beaufort(kmh: number): { force: number; name: string } {
	const force = BEAUFORT.findIndex(([limit]) => kmh < limit);
	return force === -1
		? { force: 12, name: "Hurricane force" }
		: { force, name: BEAUFORT[force][1] };
}

const POINTS = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");
export function compassPoint(degrees: number): string {
	return POINTS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** Screen-space flow (x east, y south) for wind blowing *from* `direction`. */
function flow({ speed, direction }: WindSample) {
	const radians = (direction * Math.PI) / 180;
	return { u: -Math.sin(radians) * speed, v: Math.cos(radians) * speed };
}

/** Bilinear interpolation of wind components over the sampled grid. */
export function windField(grid: WindSample[]) {
	if (grid.length !== GRID_SIZE * GRID_SIZE)
		throw new Error(`Expected ${GRID_SIZE * GRID_SIZE} wind samples`);
	const vectors = grid.map(flow);
	const last = GRID_SIZE - 1;
	return (gx: number, gy: number) => {
		const x = Math.max(0, Math.min(last, gx));
		const y = Math.max(0, Math.min(last, gy));
		const x0 = Math.min(last - 1, Math.floor(x));
		const y0 = Math.min(last - 1, Math.floor(y));
		const fx = x - x0;
		const fy = y - y0;
		const at = (column: number, row: number) =>
			vectors[row * GRID_SIZE + column];
		const mix = (key: "u" | "v") =>
			(at(x0, y0)[key] * (1 - fx) + at(x0 + 1, y0)[key] * fx) * (1 - fy) +
			(at(x0, y0 + 1)[key] * (1 - fx) + at(x0 + 1, y0 + 1)[key] * fx) * fy;
		const u = mix("u");
		const v = mix("v");
		return { u, v, speed: Math.hypot(u, v) };
	};
}

function niceDistance(km: number): number {
	const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500];
	return steps.reduce((best, step) =>
		Math.abs(step - km) < Math.abs(best - km) ? step : best,
	);
}

type Point = { x: number; y: number };
type Stored = Point & { line: number; index: number };

/**
 * Evenly spaced streamlines (after Jobard & Lefer): lines grow along the flow
 * until they approach a neighbour, and new seeds are offered one spacing to
 * either side of every accepted line. Deterministic for a given grid and size.
 */
export function drawWindMap({
	grid,
	width,
	height,
	spanKm,
}: {
	grid: WindSample[];
	width: number;
	height: number;
	spanKm: number;
}) {
	const field = windField(grid);
	const extent = Math.max(width, height);
	const last = GRID_SIZE - 1;
	const sample = (x: number, y: number) =>
		field(
			((x - width / 2) / extent) * last + last / 2,
			((y - height / 2) / extent) * last + last / 2,
		);
	const calm = Math.max(...grid.map((point) => point.speed)) < 1;

	const separation = Math.max(14, Math.round(Math.min(width, height) / 22));
	const minimumGap = separation * 0.5;
	const step = 2;
	const maxSteps = Math.ceil((width + height) * 1.5) / step;
	const cellSize = minimumGap;
	const columns = Math.ceil(width / cellSize) + 1;
	const cells = new Map<number, Stored[]>();
	const cellOf = (x: number, y: number) =>
		Math.floor(y / cellSize) * columns + Math.floor(x / cellSize);
	const store = (target: Map<number, Stored[]>, point: Stored) => {
		const key = cellOf(point.x, point.y);
		const bucket = target.get(key);
		if (bucket) bucket.push(point);
		else target.set(key, [point]);
	};
	const crowded = (
		target: Map<number, Stored[]>,
		point: Point,
		distance: number,
		ignore?: (other: Stored) => boolean,
	) => {
		const reach = Math.ceil(distance / cellSize);
		const cx = Math.floor(point.x / cellSize);
		const cy = Math.floor(point.y / cellSize);
		for (let dy = -reach; dy <= reach; dy++)
			for (let dx = -reach; dx <= reach; dx++) {
				if (cx + dx < 0 || cx + dx >= columns) continue;
				for (const other of target.get((cy + dy) * columns + cx + dx) ?? [])
					if (
						!ignore?.(other) &&
						Math.hypot(other.x - point.x, other.y - point.y) < distance
					)
						return true;
			}
		return false;
	};
	const inside = ({ x, y }: Point) =>
		x >= 0 && y >= 0 && x <= width && y <= height;
	const direction = (point: Point) => {
		const wind = sample(point.x, point.y);
		return wind.speed < CALM_KMH
			? null
			: { x: wind.u / wind.speed, y: wind.v / wind.speed };
	};

	const lines: { points: Point[]; speed: number }[] = [];
	const trace = (seed: Point, line: number) => {
		const own = new Map<number, Stored[]>();
		// Points this close along the same line are neighbours, not a loop.
		const selfSkip = Math.ceil((separation * 2) / step);
		const halves = [1, -1].map((sign) => {
			const points: Point[] = [];
			let point = seed;
			for (let index = 1; index <= maxSteps; index++) {
				const first = direction(point);
				if (!first) break;
				const middle = direction({
					x: point.x + (first.x * step * sign) / 2,
					y: point.y + (first.y * step * sign) / 2,
				});
				if (!middle) break;
				const next = {
					x: point.x + middle.x * step * sign,
					y: point.y + middle.y * step * sign,
				};
				const signed = index * sign;
				if (
					!inside(next) ||
					crowded(cells, next, minimumGap) ||
					crowded(
						own,
						next,
						minimumGap,
						(other) => Math.abs(other.index - signed) < selfSkip,
					)
				)
					break;
				store(own, { ...next, line, index: signed });
				points.push(next);
				point = next;
			}
			return points;
		});
		const points = [...halves[1].reverse(), seed, ...halves[0]];
		if ((points.length - 1) * step < separation * 1.5) return null;
		for (const [index, point] of points.entries())
			store(cells, { ...point, line, index });
		const speed =
			points.reduce((sum, point) => sum + sample(point.x, point.y).speed, 0) /
			points.length;
		return { points, speed };
	};

	const queue: Point[] = [{ x: width / 2, y: height / 2 }];
	const random = seededRandom(width * 7919 + height);
	const fallback: Point[] = [];
	for (let y = separation / 2; y < height; y += separation)
		for (let x = separation / 2; x < width; x += separation)
			fallback.push({
				x: x + (random() - 0.5) * separation * 0.5,
				y: y + (random() - 0.5) * separation * 0.5,
			});
	while (!calm && (queue.length || fallback.length)) {
		const seed = (queue.length ? queue.shift() : fallback.shift()) as Point;
		if (!inside(seed) || !direction(seed)) continue;
		if (crowded(cells, seed, separation * 0.95)) continue;
		const accepted = trace(seed, lines.length);
		if (!accepted) continue;
		lines.push(accepted);
		const { points } = accepted;
		for (let index = 0; index < points.length; index += 4) {
			const before = points[Math.max(0, index - 1)];
			const after = points[Math.min(points.length - 1, index + 1)];
			const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
			const normal = {
				x: -(after.y - before.y) / length,
				y: (after.x - before.x) / length,
			};
			for (const side of [1, -1])
				queue.push({
					x: points[index].x + normal.x * separation * side,
					y: points[index].y + normal.y * separation * side,
				});
		}
	}

	const chevronSpacing = separation * 5;
	let drawing = "";
	for (const [index, { points, speed }] of lines.entries()) {
		// Absolute scale so a gale looks heavier than a breeze on any day.
		const weight = 2 + Math.min(1, speed / 50) * 3;
		const path = points
			.filter((_, i) => i % 2 === 0 || i === points.length - 1)
			.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
			.join("");
		drawing += `<path d="${path}" stroke-width="${weight.toFixed(1)}"/>`;
		const arm = 4 + weight * 1.3;
		const stride = Math.round(chevronSpacing / step);
		const offset = Math.round(((index * 0.618) % 1) * stride);
		for (let i = offset + 2; i < points.length - 2; i += stride) {
			const tip = points[i];
			const back = points[i - 2];
			const length = Math.hypot(tip.x - back.x, tip.y - back.y) || 1;
			const t = { x: (tip.x - back.x) / length, y: (tip.y - back.y) / length };
			const wing = (side: number) =>
				`${(tip.x - t.x * arm - t.y * arm * 0.75 * side).toFixed(1)} ${(tip.y - t.y * arm + t.x * arm * 0.75 * side).toFixed(1)}`;
			drawing += `<path d="M${wing(1)}L${tip.x.toFixed(1)} ${tip.y.toFixed(1)}L${wing(-1)}" stroke-width="${weight.toFixed(1)}"/>`;
		}
	}

	const ringKm = niceDistance(spanKm / 4);
	const ringRadius = (ringKm / spanKm) * extent;
	const cx = width / 2;
	const cy = height / 2;
	const marker =
		`<circle cx="${cx}" cy="${cy}" r="${ringRadius.toFixed(1)}" stroke="white" stroke-width="6"/>` +
		`<circle cx="${cx}" cy="${cy}" r="${ringRadius.toFixed(1)}" stroke-width="2" stroke-dasharray="6 6"/>` +
		`<circle cx="${cx}" cy="${cy}" r="11" fill="white" stroke="none"/>` +
		`<circle cx="${cx}" cy="${cy}" r="7" fill="black" stroke="none"/>`;

	return {
		calm,
		lines: lines.length,
		ringKm,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/><g fill="none" stroke="black" stroke-linecap="round" stroke-linejoin="round">${drawing}${marker}<rect x="1" y="1" width="${width - 2}" height="${height - 2}" stroke-width="2"/></g></svg>`,
	};
}

/** A bold arrow pointing where the wind is going, for wind blowing from `direction`. */
export function arrowSvg(direction: number, size: number): string {
	const rotate = (((direction + 180) % 360) + 360) % 360;
	return `data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40"><g transform="rotate(${rotate} 20 20)"><path d="M20 4L31 20H24V36H16V20H9Z" fill="black"/></g></svg>`,
	)}`;
}
