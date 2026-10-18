import type { SkyPoint, SunAlmanac } from "./almanac";

const DEG = Math.PI / 180;

/** Stroke-drawn letters keep the plate free of SVG text and font loading. */
const GLYPHS: Record<string, string> = {
	N: "M0 10V0L6 10V0",
	E: "M6 0H0V10H6M0 5H5",
	S: "M6 1.5C5 0 1 0 0.5 2.2C0 4.5 6 5 6 7.6C6 10 1 10.4 0 8.5",
	W: "M0 0L1.6 10L3 3.5L4.4 10L6 0",
};

const f = (value: number) => value.toFixed(1);

/**
 * Polar sun-path chart: horizon on the rim, zenith at the centre, north up and
 * east on the right as on a site plan, so the shadow points where it falls.
 */
export function drawSunPlate(size: number, almanac: SunAlmanac): string {
	const centre = size / 2;
	const glyph = Math.max(8, size * 0.032);
	const radius = centre - glyph * 2.4;
	const project = ({ elevation, azimuth }: SkyPoint) => {
		const r = (radius * (90 - Math.max(0, elevation))) / 90;
		return {
			x: centre + r * Math.sin(azimuth * DEG),
			y: centre - r * Math.cos(azimuth * DEG),
		};
	};
	const line = (points: SkyPoint[]) =>
		points
			.map((point, i) => {
				const { x, y } = project(point);
				return `${i ? "L" : "M"}${f(x)} ${f(y)}`;
			})
			.join("");

	let body = `<circle cx="${centre}" cy="${centre}" r="${f(radius)}" stroke-width="3"/>`;
	for (const ring of [30, 60])
		body += `<circle cx="${centre}" cy="${centre}" r="${f((radius * (90 - ring)) / 90)}" stroke-width="2" stroke-dasharray="2 6"/>`;
	for (let bearing = 0; bearing < 360; bearing += 10) {
		const long = bearing % 30 === 0;
		const inner = radius + 3;
		const outer = radius + (long ? 12 : 7);
		const [s, c] = [Math.sin(bearing * DEG), Math.cos(bearing * DEG)];
		body += `<path d="M${f(centre + inner * s)} ${f(centre - inner * c)}L${f(centre + outer * s)} ${f(centre - outer * c)}" stroke-width="2"/>`;
	}
	const scale = glyph / 10;
	for (const [letter, bearing] of [
		["N", 0],
		["E", 90],
		["S", 180],
		["W", 270],
	] as const) {
		const distance = radius + glyph * 1.55;
		const x = centre + distance * Math.sin(bearing * DEG) - glyph * 0.3;
		const y = centre - distance * Math.cos(bearing * DEG) - glyph * 0.5;
		body += `<path d="${GLYPHS[letter]}" transform="translate(${f(x)} ${f(y)}) scale(${scale.toFixed(3)})" stroke-width="${(2.5 / scale).toFixed(2)}"/>`;
	}
	body += `<path d="M${centre - 6} ${centre}H${centre + 6}M${centre} ${centre - 6}V${centre + 6}" stroke-width="2"/>`;

	for (const solstice of almanac.solstices)
		for (const arc of solstice)
			body += `<path d="${line(arc)}" stroke-width="2" stroke-dasharray="9 7"/>`;
	for (const arc of almanac.path)
		body += `<path d="${line(arc)}" stroke-width="4.5"/>`;
	for (const hour of almanac.hours) {
		const { x, y } = project(hour);
		body +=
			hour.hour === 12
				? `<circle cx="${f(x)}" cy="${f(y)}" r="6" fill="black"/>`
				: `<circle cx="${f(x)}" cy="${f(y)}" r="4.5" fill="white" stroke-width="2.5"/>`;
	}

	if (almanac.now && almanac.shadow !== null) {
		// Shadow length on the plate grows with the real shadow, capped at the rim.
		const length = radius * Math.min(0.85, Math.max(0.06, almanac.shadow / 3));
		const away = (almanac.now.azimuth + 180) * DEG;
		body += `<path d="M${centre} ${centre}L${f(centre + length * Math.sin(away))} ${f(centre - length * Math.cos(away))}" stroke-width="6"/>`;
		body += `<circle cx="${centre}" cy="${centre}" r="5" fill="black" stroke="none"/>`;
	}
	if (almanac.now) {
		const { x, y } = project(almanac.now);
		let rays = "";
		for (let ray = 0; ray < 8; ray++) {
			const [s, c] = [Math.sin(ray * 45 * DEG), Math.cos(ray * 45 * DEG)];
			rays += `M${f(x + 13 * s)} ${f(y - 13 * c)}L${f(x + 19 * s)} ${f(y - 19 * c)}`;
		}
		body += `<circle cx="${f(x)}" cy="${f(y)}" r="22" fill="white" stroke="none"/><path d="${rays}" stroke-width="3"/><circle cx="${f(x)}" cy="${f(y)}" r="9" fill="black" stroke="none"/>`;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="white"/><g fill="none" stroke="black" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
}
