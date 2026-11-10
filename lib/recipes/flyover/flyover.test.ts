import sharp from "sharp";
import { withRecipeDeadline } from "@/lib/recipes/runtime/fetch-context";
import fixture from "@/scripts/fixtures/flyover-iss.json";
import { camera, project, shade } from "./earthface";
import { groundDistance, regionBelow } from "./geography";
import { globeMarkers } from "./markers";
import {
	currentElements,
	fetchElements,
	parseTle,
	validateElements,
} from "./orbit";
import { iss, prepare, speed, subsolar, track } from "./terra";
import {
	baseTextures,
	cloudDay,
	cloudTexture,
	decodeTexture,
} from "./textures";

const now = Date.parse("2026-11-11T06:30:00Z");
const el = {
	epoch: fixture.EPOCH,
	n: fixture.MEAN_MOTION,
	e: fixture.ECCENTRICITY,
	i: fixture.INCLINATION,
	raan: fixture.RA_OF_ASC_NODE,
	w: fixture.ARG_OF_PERICENTER,
	ma: fixture.MEAN_ANOMALY,
	nd: fixture.MEAN_MOTION_DOT,
};

afterEach(() => jest.restoreAllMocks());

test("rejects corrupt and expired orbits instead of inventing a live ISS", () => {
	expect(validateElements(el, now)).toEqual(el);
	expect(() => validateElements({ ...el, n: 0 }, now)).toThrow();
	expect(() => validateElements({ ...el, epoch: "invalid" }, now)).toThrow();
	expect(() => validateElements(el, now + 3 * 86400_000)).toThrow("48 hours");
});

test("propagated position, speed and ground track stay in the ISS orbit", () => {
	const p = prepare(el);
	for (const t of [now, now + 12 * 3600_000, now + 24 * 3600_000]) {
		const q = iss(p, t);
		expect(Math.abs(q.lat)).toBeLessThan(52);
		expect(Math.abs(q.lon)).toBeLessThanOrEqual(180);
		expect(q.alt).toBeGreaterThan(380);
		expect(q.alt).toBeLessThan(460);
		expect(speed(p, t)).toBeGreaterThan(7.5);
		expect(speed(p, t)).toBeLessThan(7.9);
	}
	const points = track(p, now, now + 52 * 60_000, 30_000);
	expect(points).toHaveLength(105);
	expect(points[0].slice(0, 2)).toEqual([iss(p, now).lat, iss(p, now).lon]);
});

test("Sun and camera use radians and degrees consistently", () => {
	const sun = subsolar(Date.parse("2026-06-21T12:00:00Z"));
	expect((sun.lat * 180) / Math.PI).toBeCloseTo(23.44, 1);
	expect(Math.abs((sun.lon * 180) / Math.PI)).toBeLessThan(1);
	const cam = camera(0, 0);
	expect(project(cam, 100, 100, 90, 0, 0)).toMatchObject({
		x: 100,
		y: 100,
		visible: true,
	});
	expect(project(cam, 100, 100, 90, 0, 180).visible).toBe(false);
});

test("projection breaks tracks at the far hemisphere and marks a hidden ISS", () => {
	const target = { latitude: 0, longitude: 0 };
	const markers = globeMarkers(
		400,
		target,
		{ latitude: 0, longitude: 160 },
		target,
		[
			[0, 0],
			[0, 40],
			[0, 160],
			[20, 0],
		],
	);
	expect(markers.far).toBe(true);
	expect(markers.svg.match(/M/g)?.length).toBeGreaterThanOrEqual(2);
	expect(markers.svg).not.toMatch(/NaN|Infinity/);
});

test("great-circle distance is stable at coincident and antipodal points", () => {
	expect(groundDistance(12, 77, 12, 77)).toBe(0);
	expect(groundDistance(0, 0, 0, 180)).toBeCloseTo(Math.PI * 6371, 5);
	expect(groundDistance(90, 0, -90, 180)).toBeCloseTo(Math.PI * 6371, 5);
});

test("bundled NASA textures resolve land and ocean and shade both hemispheres", async () => {
	const textures = await baseTextures();
	expect(regionBelow(13, 78, textures.alb)).toBe("India");
	expect(regionBelow(0, -140, textures.alb)).toBe("Pacific Ocean");
	const result = shade(
		{ ...textures, live: null },
		camera(0, 90),
		{ lat: 0, lon: 0 },
		48,
	);
	expect(result.L.every(Number.isFinite)).toBe(true);
	expect(Math.max(...result.L)).toBeGreaterThan(0.3);
	expect(result.L[0]).toBe(0);
});

test("cloud gaps remain masked and textures decode to one luminance per pixel", async () => {
	const input = await sharp({
		create: { width: 32, height: 16, channels: 3, background: "white" },
	})
		.composite([
			{
				input: await sharp({
					create: { width: 16, height: 16, channels: 3, background: "black" },
				})
					.png()
					.toBuffer(),
				left: 0,
				top: 0,
			},
		])
		.png()
		.toBuffer();
	const t = await decodeTexture(input, true);
	expect(t.a).toHaveLength(512);
	expect(t.m?.a[0]).toBe(0);
	expect(t.m?.a[31]).toBeGreaterThan(200);
	expect(cloudDay(Date.parse("2026-11-11T04:00:00Z"))).toBe("2026-11-09");
});

test("CelesTrak failure falls back to validated TLE inside the recipe deadline", async () => {
	jest.spyOn(Date, "now").mockReturnValue(now);
	// Fixed-width TLE for the same CelesTrak snapshot; checksums are unused by
	// upstream's secular propagator, but the epoch and all fields are parsed.
	const tle =
		"ISS (ZARYA)\n1 25544U 98067A   26314.17503267  .00009346  00000+0  17575-3 0  9990\n2 25544  51.6322 297.6644 0007292   8.9462 351.1656 15.49289712594380";
	const parsed = parseTle(tle);
	expect(parsed.n).toBeCloseTo(el.n, 7);
	expect(parsed.e).toBeCloseTo(el.e, 7);
	expect(Date.parse(parsed.epoch)).toBeCloseTo(Date.parse(`${el.epoch}Z`), -1);
	const fetch = jest
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
		.mockResolvedValueOnce(new Response(tle));
	const result = await withRecipeDeadline((signal) => fetchElements(signal));
	expect(result.n).toBeCloseTo(el.n, 7);
	expect(fetch).toHaveBeenCalledTimes(2);
});

test("valid OMM is preferred and total orbit failure propagates to last-good-data handling", async () => {
	jest.spyOn(Date, "now").mockReturnValue(now);
	const fetch = jest
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(Response.json([fixture]));
	await expect(fetchElements()).resolves.toEqual(el);
	expect(fetch).toHaveBeenCalledTimes(1);
	fetch.mockRejectedValue(new Error("offline"));
	await expect(
		withRecipeDeadline((signal) => fetchElements(signal)),
	).rejects.toThrow("offline");
});

test("orbit cache shares requests and refreshes elements crossing 48 hours before the cache expires", async () => {
	const epoch = Date.parse(`${fixture.EPOCH}Z`);
	const clock = jest.spyOn(Date, "now").mockReturnValue(epoch + 47 * 3600_000);
	const fetch = jest
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(Response.json([fixture]));
	const results = await Promise.all([currentElements(), currentElements()]);
	expect(results[0]).toEqual(results[1]);
	expect(fetch).toHaveBeenCalledTimes(1);
	clock.mockReturnValue(epoch + 49 * 3600_000);
	const freshEpoch = new Date(Date.now()).toISOString();
	fetch.mockResolvedValueOnce(
		Response.json([{ ...fixture, EPOCH: freshEpoch }]),
	);
	await expect(currentElements()).resolves.toMatchObject({ epoch: freshEpoch });
	expect(fetch).toHaveBeenCalledTimes(2);
});

test("optional NASA failure does not poison the runtime and is cached", async () => {
	const fetch = jest
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("NASA offline"));
	await expect(
		withRecipeDeadline((signal) => cloudTexture("2026-11-08", signal)),
	).resolves.toBeNull();
	await expect(cloudTexture("2026-11-08")).resolves.toBeNull();
	expect(fetch).toHaveBeenCalledTimes(1);
});
