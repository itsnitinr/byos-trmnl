// Adapted from Baszert/trmnl-flyover @ 25288dfdf22112ae4a9c86dfa85beab50fc41868.
// Copyright (c) 2026 Baszert. MIT license: ./LICENSE.
export type Elements = {
	epoch: string;
	n: number;
	e: number;
	i: number;
	raan: number;
	w: number;
	ma: number;
	nd: number;
};
/* Terra: where the Sun stands over the Earth, and where the ISS is.
   Sun after Meeus, Astronomical Algorithms ch. 25 (apparent position); sidereal time ch. 12.
   ISS from mean orbital elements (CelesTrak OMM): the secular J2 terms of SGP4 (Brouwer mean motion, rates of the node,
   the argument of perigee and the mean anomaly) and no short-period terms, good to a few tens of kilometres. */

const R = Math.PI / 180,
	TAU = 2 * Math.PI,
	sin = Math.sin,
	cos = Math.cos,
	atan2 = Math.atan2,
	asin = Math.asin,
	sqrt = Math.sqrt;
const RE = 6378.137,
	F = 1 / 298.257223563,
	E2 = F * (2 - F);
function pmod(x: number, m: number) {
	x = x % m;
	return x < 0 ? x + m : x;
}
function jd(ms: number) {
	return ms / 864e5 + 2440587.5;
}
export function gmst(ms: number) {
	const d = jd(ms) - 2451545,
		T = d / 36525;
	return pmod(
		(280.46061837 +
			360.98564736629 * d +
			0.000387933 * T * T -
			(T * T * T) / 38710000) *
			R,
		TAU,
	);
}

// the Sun: apparent right ascension and declination (radians)
export function sunEq(ms: number) {
	const T = (jd(ms) - 2451545) / 36525,
		L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T,
		M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * R;
	const C =
		(1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
		(0.019993 - 0.000101 * T) * sin(2 * M) +
		0.000289 * sin(3 * M);
	const O = (125.04 - 1934.136 * T) * R,
		lam = (L0 + C - 0.00569 - 0.00478 * sin(O)) * R,
		eps = (23.439291 - 0.0130042 * T + 0.00256 * cos(O)) * R;
	return {
		ra: atan2(cos(eps) * sin(lam), cos(lam)),
		dec: asin(sin(eps) * sin(lam)),
	};
}
// the point on the Earth with the Sun straight overhead
export function subsolar(ms: number) {
	const s = sunEq(ms),
		lon = pmod(s.ra - gmst(ms) + Math.PI, TAU) - Math.PI;
	return { lat: s.dec, lon: lon };
}

/* ---------- the ISS ---------- */
const J2 = 1.082616e-3,
	J4 = -1.65597e-6,
	KE = 0.0743669161331734; // WGS72, as SGP4
export function prepare(el: Elements) {
	const n0 = (el.n * TAU) / 1440,
		e = el.e,
		i = el.i * R,
		ci = cos(i),
		c2 = ci * ci,
		c4 = c2 * c2,
		omeosq = 1 - e * e,
		rteosq = sqrt(omeosq),
		con41 = 3 * c2 - 1,
		con42 = 1 - 5 * c2;
	const a1 = (KE / n0) ** (2 / 3),
		d1 = (0.75 * J2 * con41) / (a1 * a1 * rteosq * omeosq),
		a0 = a1 * (1 - d1 / 3 - d1 * d1 - (134 * d1 * d1 * d1) / 81),
		d0 = (0.75 * J2 * con41) / (a0 * a0 * rteosq * omeosq);
	const no = n0 / (1 + d0),
		ao = a0 / (1 - d0),
		po = ao * omeosq,
		pinvsq = 1 / (po * po);
	const t1 = 1.5 * J2 * pinvsq * no,
		t2 = 0.5 * t1 * J2 * pinvsq,
		t3 = -0.46875 * J4 * pinvsq * pinvsq * no;
	return {
		el: el,
		epoch: Date.parse(
			el.epoch + (/Z|[+-]\d\d:?\d\d$/.test(el.epoch) ? "" : "Z"),
		),
		ao: ao,
		no: no,
		e: e,
		i: i,
		ci: ci,
		mdot:
			no +
			0.5 * t1 * rteosq * con41 +
			0.0625 * t2 * rteosq * (13 - 78 * c2 + 137 * c4),
		wdot:
			-0.5 * t1 * con42 +
			0.0625 * t2 * (7 - 114 * c2 + 395 * c4) +
			t3 * (3 - 36 * c2 + 49 * c4),
		odot: -t1 * ci + (0.5 * t2 * (4 - 19 * c2) + 2 * t3 * (3 - 7 * c2)) * ci,
	};
}
// position in the Earth-fixed frame, km: { x, y, z, lat, lon (degrees), alt, eci:[x,y,z] }
export function iss(p: ReturnType<typeof prepare>, ms: number) {
	const t = (ms - p.epoch) / 6e4; // minutes since the epoch
	const M = pmod(
			p.el.ma * R + p.mdot * t + p.el.nd * TAU * (t / 1440) ** 2,
			TAU,
		),
		w = p.el.w * R + p.wdot * t,
		O = p.el.raan * R + p.odot * t;
	let E = M;
	for (let k = 0; k < 8; k++) E -= (E - p.e * sin(E) - M) / (1 - p.e * cos(E));
	const a = p.ao * RE,
		xo = a * (cos(E) - p.e),
		yo = a * sqrt(1 - p.e * p.e) * sin(E),
		cw = cos(w),
		sw = sin(w),
		cO = cos(O),
		sO = sin(O),
		ci = p.ci,
		si = sin(p.i);
	const x1 = xo * cw - yo * sw,
		y1 = xo * sw + yo * cw;
	const X = x1 * cO - y1 * ci * sO,
		Y = x1 * sO + y1 * ci * cO,
		Z = y1 * si;
	const g = gmst(ms),
		xe = X * cos(g) + Y * sin(g),
		ye = -X * sin(g) + Y * cos(g),
		ze = Z;
	// geodetic latitude and height
	let lon = atan2(ye, xe),
		pr = sqrt(xe * xe + ye * ye),
		lat = atan2(ze, pr * (1 - E2));
	for (let k = 0; k < 5; k++) {
		const N = RE / sqrt(1 - E2 * sin(lat) * sin(lat));
		lat = atan2(ze + E2 * N * sin(lat), pr);
	}
	const Nn = RE / sqrt(1 - E2 * sin(lat) * sin(lat));
	return {
		x: xe,
		y: ye,
		z: ze,
		lat: lat / R,
		lon: lon / R,
		alt: pr / cos(lat) - Nn,
		eci: [X, Y, Z],
	};
}
// speed in km/s relative to the stars (the figure that is quoted for the ISS): from two positions ten seconds apart
export function speed(p: ReturnType<typeof prepare>, ms: number) {
	const a = iss(p, ms - 5000).eci,
		b = iss(p, ms + 5000).eci;
	return (
		sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2) / 10
	);
}
// a track of the ISS over the ground, [lat, lon] pairs from `from` to `to` ms
export function track(
	p: ReturnType<typeof prepare>,
	from: number,
	to: number,
	every: number,
) {
	const out = [];
	for (let t = from; t <= to; t += every) {
		const q = iss(p, t);
		out.push([q.lat, q.lon, t]);
	}
	return out;
}
