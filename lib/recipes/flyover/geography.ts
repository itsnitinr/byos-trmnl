import countries from "./countries.json";
import type { Texture } from "./earthface";

/** Great-circle ground distance, as in the upstream Flyover plugin (not slant range). */
export function groundDistance(a: number, b: number, c: number, d: number) {
	const rad = Math.PI / 180;
	const x = Math.sin(((c - a) * rad) / 2);
	const y = Math.sin(((d - b) * rad) / 2);
	const h = x * x + Math.cos(a * rad) * Math.cos(c * rad) * y * y;
	return 12742 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

/** Approximate region from upstream's albedo mask and coarse town grid. */
export function regionBelow(
	latitude: number,
	longitude: number,
	albedo: Texture,
) {
	const x =
		((Math.floor(((longitude + 180) / 360) * albedo.w) % albedo.w) + albedo.w) %
		albedo.w;
	const y = Math.max(
		0,
		Math.min(albedo.h - 1, Math.floor(((90 - latitude) / 180) * albedo.h)),
	);
	if (albedo.a[y * albedo.w + x] > 19) {
		let nearest = "";
		let best = 2500;
		for (const [lat, lon, code] of countries) {
			const distance = groundDistance(
				latitude,
				longitude,
				Number(lat),
				Number(lon),
			);
			if (distance < best) {
				best = distance;
				nearest = String(code);
			}
		}
		if (nearest)
			return (
				new Intl.DisplayNames(["en"], { type: "region" }).of(nearest) ?? nearest
			);
	}
	if (latitude < -50) return "Southern Ocean";
	if (latitude > 66) return "Arctic Ocean";
	if (
		(longitude >= 20 && longitude < 105 && latitude < 30) ||
		(longitude >= 105 && longitude < 147 && latitude < -10)
	)
		return "Indian Ocean";
	return longitude >= -70 && longitude < 20
		? "Atlantic Ocean"
		: "Pacific Ocean";
}
