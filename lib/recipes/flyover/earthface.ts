// Adapted from Baszert/trmnl-flyover @ 25288dfdf22112ae4a9c86dfa85beab50fc41868.
// Copyright (c) 2026 Baszert. MIT license: ./LICENSE.
export type Texture = { w: number; h: number; a: Uint8Array; m?: Texture };
export type Textures = { alb: Texture; lights: Texture; live: Texture | null };
const PI = Math.PI,
	sin = Math.sin,
	cos = Math.cos,
	sqrt = Math.sqrt,
	atan2 = Math.atan2,
	asin = Math.asin,
	R = PI / 180;
// a little noise texture (deterministic), for the mottle where there is no satellite picture
const NOISE = (() => {
	let w = 128,
		h = 64,
		a = new Uint8Array(w * h),
		s = 12345;
	for (let i = 0; i < a.length; i++) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		a[i] = (s >> 8) & 255;
	}
	return { w: w, h: h, a: a };
})();
function smooth(a: number, b: number, v: number) {
	const k = Math.max(0, Math.min(1, (v - a) / (b - a)));
	return k * k * (3 - 2 * k);
}
function bil(t: Texture, u: number, v: number) {
	let w = t.w,
		h = t.h,
		u0 = Math.floor(u),
		v0 = Math.floor(v),
		fu = u - u0,
		fv = v - v0;
	u0 = ((u0 % w) + w) % w;
	const u1 = (u0 + 1) % w;
	v0 = Math.max(0, Math.min(h - 1, v0));
	const v1 = Math.min(h - 1, v0 + 1),
		a = t.a;
	return (
		(a[v0 * w + u0] * (1 - fu) + a[v0 * w + u1] * fu) * (1 - fv) +
		(a[v1 * w + u0] * (1 - fu) + a[v1 * w + u1] * fu) * fv
	);
}
// the camera: looks down on (lat0, lon0) with north up; returns the screen axes in Earth-fixed space
export function camera(lat0: number, lon0: number) {
	const p = lat0 * R,
		l = lon0 * R;
	return {
		e: [-sin(l), cos(l), 0],
		u: [-sin(p) * cos(l), -sin(p) * sin(l), cos(p)],
		c: [cos(p) * cos(l), cos(p) * sin(l), sin(p)],
	};
}
// luminance (0..1) of every pixel of a disc of radius r (pixels); sun = { lat, lon } in radians
export function shade(
	T: Textures,
	cam: ReturnType<typeof camera>,
	sun: { lat: number; lon: number },
	r: number,
	o: { nightBase?: number; gain?: number; lights?: number } = {},
) {
	o = o || {};
	const halo = Math.ceil(r * 0.045),
		size = Math.ceil(2 * r) + 2 * halo + 4,
		L = new Float32Array(size * size),
		c0 = size / 2;
	const sv = [
		cos(sun.lat) * cos(sun.lon),
		cos(sun.lat) * sin(sun.lon),
		sin(sun.lat),
	];
	let hv = [sv[0] + cam.c[0], sv[1] + cam.c[1], sv[2] + cam.c[2]],
		hl = 1 / sqrt(hv[0] * hv[0] + hv[1] * hv[1] + hv[2] * hv[2]);
	hv = [hv[0] * hl, hv[1] * hl, hv[2] * hl];
	const nb = o.nightBase == null ? 0 : o.nightBase,
		alb = T.alb,
		live = T.live,
		lights = T.lights,
		gain = o.gain || 1.05,
		lg = o.lights == null ? 1 : o.lights;
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size; i++) {
			const x = (i + 0.5 - c0) / r,
				y = -(j + 0.5 - c0) / r,
				rr = x * x + y * y;
			if (rr >= 1) {
				// the haze around the planet, only where the Sun lights the limb
				const rad = sqrt(rr),
					d = (rad - 1) * r;
				if (d < halo) {
					const lx = x / rad,
						ly = y / rad,
						mu =
							lx * cam.e[0] * sv[0] +
							lx * cam.e[1] * sv[1] +
							lx * cam.e[2] * sv[2] +
							ly * (cam.u[0] * sv[0] + cam.u[1] * sv[1] + cam.u[2] * sv[2]);
					const f = 1 - d / halo;
					L[j * size + i] = f * f * f * 0.62 * smooth(-0.25, 0.45, mu);
				}
				continue;
			}
			const z = sqrt(1 - rr);
			const nx = x * cam.e[0] + y * cam.u[0] + z * cam.c[0],
				ny = x * cam.e[1] + y * cam.u[1] + z * cam.c[1],
				nz = x * cam.e[2] + y * cam.u[2] + z * cam.c[2];
			const mu0 = nx * sv[0] + ny * sv[1] + nz * sv[2];
			const lat = asin(Math.max(-1, Math.min(1, nz))),
				lon = atan2(ny, nx),
				u = (lon + PI) / (2 * PI),
				v = (PI / 2 - lat) / PI;
			// the surface: yesterday's satellite picture where it has data, the Blue Marble elsewhere
			let A = bil(alb, u * alb.w - 0.5, v * alb.h - 0.5) / 255;
			A = 0.04 + 0.78 * A ** 1.15;
			const al = Math.abs(lat) / R;
			if (A > 0.55) A = Math.min(1, A * 1.18); // the same white as the satellite's snow and ice
			// where the satellite has no picture (the polar night) a mottle of cloud and pack ice, not a patch of open sea; (a planar map of the pole, so no radial streaks)
			if (al > 66) {
				const pxn = cos(lat) * cos(lon),
					pyn = cos(lat) * sin(lon),
					fl = 0.5 + (0.34 * bil(NOISE, 64 + pxn * 38, 32 + pyn * 18)) / 255;
				A = Math.max(A, A + (fl - A) * smooth(66, 72, al));
			}
			if (live) {
				const lv = bil(live, u * live.w - 0.5, v * live.h - 0.5) / 255,
					wl = smooth(
						0.2,
						0.95,
						bil(live.m ?? live, u * live.w - 0.5, v * live.h - 0.5) / 255,
					);
				A = A + (lv - A) * wl;
			}
			const sea = smooth(0.34, 0.2, A);
			const td = smooth(-0.07, 0.24, mu0),
				lam = Math.max(mu0, 0);
			let day = A * (0.1 + 0.98 * lam ** 0.7) * gain;
			// glint of the Sun on the sea
			const nh = nx * hv[0] + ny * hv[1] + nz * hv[2];
			day += Math.max(nh, 0) ** 120 * 0.55 * sea;
			// haze: the limb is brighter where the Sun shines
			const hz = (1 - z) ** 2.6 * 0.5 * smooth(-0.1, 0.5, mu0);
			let lum = (day + hz) * td;
			// the night: a faint outline of the land, and the lights
			const nt = 1 - smooth(-0.2, 0.01, mu0);
			if (nb) lum += nt * (1 - td) * Math.max(0, A - 0.22) * nb;
			if (lights)
				lum +=
					(bil(lights, u * lights.w - 0.5, v * lights.h - 0.5) / 255) *
					nt *
					0.98 *
					lg;
			L[j * size + i] = lum;
		}
	return { L: L, size: size };
}

export function project(
	cam: ReturnType<typeof camera>,
	cx: number,
	cy: number,
	r: number,
	latDeg: number,
	lonDeg: number,
) {
	const p = latDeg * R,
		l = lonDeg * R,
		n = [cos(p) * cos(l), cos(p) * sin(l), sin(p)];
	const x = n[0] * cam.e[0] + n[1] * cam.e[1] + n[2] * cam.e[2],
		y = n[0] * cam.u[0] + n[1] * cam.u[1] + n[2] * cam.u[2],
		z = n[0] * cam.c[0] + n[1] * cam.c[1] + n[2] * cam.c[2];
	return { x: cx + x * r, y: cy - y * r, z: z, visible: z > 0.02 };
}
