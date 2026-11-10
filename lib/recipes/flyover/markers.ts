import { camera, project } from "./earthface";

type Point = { latitude: number; longitude: number };
export function globeMarkers(
	size: number,
	target: Point,
	station: Point,
	home: Point,
	track: [number, number][],
) {
	const cam = camera(target.latitude, target.longitude);
	const centre = size / 2;
	// Must match the shade() canvas: radius 440, halo ceil(440*.045), +4.
	const radius = (size * 440) / 924;
	const p = (q: Point) =>
		project(cam, centre, centre, radius, q.latitude, q.longitude);
	const segments: string[] = [];
	let pen = false;
	for (const [latitude, longitude] of track) {
		const q = p({ latitude, longitude });
		if (!q.visible) {
			pen = false;
			continue;
		}
		segments.push(`${pen ? "L" : "M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`);
		pen = true;
	}
	const iss = p(station),
		observer = p(home);
	const far = !iss.visible;
	if (far) {
		let dx = iss.x - centre;
		const dy = iss.y - centre;
		if (Math.hypot(dx, dy) < 0.000001) dx = 1;
		const length = Math.hypot(dx, dy);
		iss.x = centre + (dx / length) * radius * 0.88;
		iss.y = centre + (dy / length) * radius * 0.88;
	}
	const k = Math.max(0.65, size / 480);
	const orbit = segments.join(" ");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
	<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="#000" stroke-width="1"/>
	<path d="${orbit}" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round"/>
	<path d="${orbit}" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round"/>
	${observer.visible ? `<circle cx="${observer.x}" cy="${observer.y}" r="${8 * k}" fill="#000" stroke="#fff" stroke-width="2"/><circle cx="${observer.x}" cy="${observer.y}" r="${3 * k}" fill="#fff"/>` : ""}
	<g transform="translate(${iss.x} ${iss.y}) rotate(-30) scale(${k})" fill="#fff" stroke="#000" stroke-width="2.5" stroke-linejoin="round">
	<path d="M-22,-2 H22 V2 H-22Z"/><path d="M-21,-11 H-13 V11 H-21Z M-11,-11 H-3 V11 H-11Z M3,-11 H11 V11 H3Z M13,-11 H21 V11 H13Z"/><rect x="-4" y="-7" width="8" height="14"/>
	</g></svg>`;
	return { svg, far };
}
