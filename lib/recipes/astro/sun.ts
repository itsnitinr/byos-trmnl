const DAY_MS = 86_400_000;
const DEG = Math.PI / 180;

/**
 * Sun declination (degrees) and the equation of time (minutes) for an instant,
 * from the NOAA solar position equations. Good to well under a minute of
 * sunrise time for any year a screen will plausibly run in.
 */
export function solarCoordinates(ms: number): {
	declination: number;
	equationOfTime: number;
} {
	// Julian centuries since J2000.0.
	const t = (ms / DAY_MS + 2440587.5 - 2451545) / 36525;

	const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
	const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
	const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

	const center =
		Math.sin(meanAnomaly * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
		Math.sin(2 * meanAnomaly * DEG) * (0.019993 - 0.000101 * t) +
		Math.sin(3 * meanAnomaly * DEG) * 0.000289;

	// Apparent longitude: true longitude corrected for nutation and aberration.
	const apparentLongitude =
		meanLongitude +
		center -
		0.00569 -
		0.00478 * Math.sin((125.04 - 1934.136 * t) * DEG);

	const meanObliquity =
		23 +
		(26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
	const obliquity =
		meanObliquity + 0.00256 * Math.cos((125.04 - 1934.136 * t) * DEG);

	const declination =
		Math.asin(Math.sin(obliquity * DEG) * Math.sin(apparentLongitude * DEG)) /
		DEG;

	const y = Math.tan((obliquity / 2) * DEG) ** 2;
	const equationOfTime =
		(4 *
			(y * Math.sin(2 * meanLongitude * DEG) -
				2 * eccentricity * Math.sin(meanAnomaly * DEG) +
				4 *
					eccentricity *
					y *
					Math.sin(meanAnomaly * DEG) *
					Math.cos(2 * meanLongitude * DEG) -
				0.5 * y * y * Math.sin(4 * meanLongitude * DEG) -
				1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * DEG))) /
		DEG;

	return { declination, equationOfTime };
}

/**
 * Geometric position of the sun's centre: elevation above the horizon and
 * azimuth clockwise from true north, both in degrees.
 */
export function solarPosition(
	ms: number,
	latitude: number,
	longitude: number,
): { elevation: number; azimuth: number; declination: number } {
	const { declination, equationOfTime } = solarCoordinates(ms);

	// True solar time: UTC clock time carried to the meridian the observer
	// stands on (4 minutes per degree) and corrected by the equation of time.
	const utcMinutes = (((ms / 60_000) % 1440) + 1440) % 1440;
	const trueSolarTime =
		(((utcMinutes + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440;
	const hourAngle = trueSolarTime / 4 - 180;

	const cosZenith =
		Math.sin(latitude * DEG) * Math.sin(declination * DEG) +
		Math.cos(latitude * DEG) *
			Math.cos(declination * DEG) *
			Math.cos(hourAngle * DEG);
	const elevation = 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / DEG;

	// Measured from south towards west, then turned to a north-based bearing.
	const fromSouth = Math.atan2(
		Math.sin(hourAngle * DEG),
		Math.cos(hourAngle * DEG) * Math.sin(latitude * DEG) -
			Math.tan(declination * DEG) * Math.cos(latitude * DEG),
	);
	const azimuth = (((fromSouth / DEG + 180) % 360) + 360) % 360;

	return { elevation, azimuth, declination };
}

/** Geometric elevation of the sun above the horizon, in degrees. */
export function solarElevation(
	ms: number,
	latitude: number,
	longitude: number,
): number {
	return solarPosition(ms, latitude, longitude).elevation;
}
