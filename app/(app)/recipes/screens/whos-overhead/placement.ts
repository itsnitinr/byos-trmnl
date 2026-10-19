// Pure layout decisions for the recipe, kept apart from rendering so they test cheaply.

type Phase = { label: string; arrow: number };
/** Climb/descent from the reported vertical rate; level flight splits on altitude. */
export function flightPhase(
	altitude: number | null,
	verticalRate: number | null,
): Phase | null {
	if (verticalRate !== null && verticalRate >= 300)
		return { label: "Climbing", arrow: 45 };
	if (verticalRate !== null && verticalRate <= -300)
		return { label: "Descending", arrow: 135 };
	if (altitude === null) return null;
	return { label: altitude >= 20_000 ? "Cruising" : "Level", arrow: 90 };
}

/**
 * Put the callsign tag on whichever side of the plane points furthest away
 * from the scope centre, so it never hides the observer mark.
 */
export function placeTag({
	target,
	centre,
	size,
	width,
	height,
	gap,
	keepOut,
}: {
	target: { x: number; y: number; size: number };
	centre: number;
	size: number;
	width: number;
	height: number;
	gap: number;
	keepOut: number;
}) {
	const reach = target.size / 2 + gap;
	const clamp = (value: number, extent: number) =>
		Math.min(Math.max(value, 0), size - extent);
	const candidates = [
		{ left: target.x - width / 2, top: target.y + reach },
		{ left: target.x - width / 2, top: target.y - reach - height },
		{ left: target.x + reach, top: target.y - height / 2 },
		{ left: target.x - reach - width, top: target.y - height / 2 },
	].map((spot) => {
		const left = clamp(spot.left, width);
		const top = clamp(spot.top, height);
		const covers =
			left - keepOut < centre &&
			left + width + keepOut > centre &&
			top - keepOut < centre &&
			top + height + keepOut > centre;
		const dx = left + width / 2 - centre;
		const dy = top + height / 2 - centre;
		return { left, top, score: Math.hypot(dx, dy) - (covers ? size : 0) };
	});
	return candidates.reduce((best, spot) =>
		spot.score > best.score ? spot : best,
	);
}
