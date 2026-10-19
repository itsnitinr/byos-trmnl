import getOverheadData, { relativePosition, selectAircraft } from "./getData";
import { flightPhase, placeTag } from "./placement";
import { project } from "./radar";
import { paramsSchema } from "./schema";

const params = paramsSchema.parse({
	latitude: 0,
	longitude: 0,
	radiusKm: 25,
	showLogo: false,
});
const ac = {
	hex: "abc123",
	lat: 0,
	lon: 0.01,
	alt_baro: 10000,
	seen_pos: 1,
	flight: "TEST1",
};
afterEach(() => jest.restoreAllMocks());
test("distance and bearing handle the equator and antimeridian", () => {
	expect(relativePosition(0, 0, 0, 1).distanceKm).toBeCloseTo(111.195, 2);
	expect(relativePosition(0, 0, 0, 1).bearing).toBe(90);
	expect(relativePosition(0, 179.99, 0, -179.99).distanceKm).toBeLessThan(3);
});
test("nearest selection excludes ground, stale, missing, malformed and out-of-range positions", () => {
	const result = selectAircraft(
		[
			{ ...ac, hex: "far", lon: 0.1 },
			ac,
			{ ...ac, hex: "ground", alt_baro: "ground", alt_geom: 1000 },
			{ ...ac, hex: "stale", seen_pos: 61 },
			{ ...ac, hex: "missing", seen_pos: undefined },
			{ ...ac, hex: "outside", lon: 1 },
			{ ...ac, hex: "bad", lat: NaN },
			{ ...ac, hex: "altitude", alt_baro: undefined },
		],
		params,
	);
	expect(result.map((a) => a.hex)).toEqual(["abc123", "far"]);
});
function feed(value: unknown) {
	return jest
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(new Response(JSON.stringify(value), { status: 200 }));
}
test("empty sky is distinct from provider failure and stale data", async () => {
	const mock = feed({ now: Date.now(), total: 0 });
	expect((await getOverheadData(params)).status).toBe("empty");
	mock.mockRejectedValueOnce(new Error("offline"));
	expect((await getOverheadData(params)).status).toBe("error");
	mock.mockResolvedValueOnce(
		new Response(JSON.stringify({ ac: [ac], now: Date.now() - 180000 })),
	);
	expect((await getOverheadData(params)).status).toBe("error");
});
test("optional enrichment failure preserves flight and missing metrics", async () => {
	const mock = feed({ ac: [ac], now: Date.now() });
	mock
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ ac: [ac], now: Date.now() })),
		)
		.mockRejectedValueOnce(new Error("route unavailable"));
	const data = await getOverheadData(params);
	expect(data.status).toBe("live");
	expect(data.aircraft?.callsign).toBe("TEST1");
	expect(data.aircraft?.speed).toBeNull();
	expect(data.aircraft?.origin).toBe("—");
});
test("demo is explicit and does not request live positions", async () => {
	const mock = jest.spyOn(globalThis, "fetch");
	const data = await getOverheadData({ ...params, demo: true });
	expect(data.status).toBe("demo");
	expect(mock).not.toHaveBeenCalled();
});
test("logo misses do not drop resolved route", async () => {
	const mock = feed({ ac: [{ ...ac, flight: "KLM880" }], now: Date.now() });
	mock
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ ac: [{ ...ac, flight: "KLM880" }], now: Date.now() }),
			),
		)
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					response: {
						flightroute: {
							origin: { icao_code: "VOBL", iata_code: "BLR" },
							destination: { icao_code: "EHAM", iata_code: "AMS" },
							airline: { icao: "KLM", name: "KLM" },
						},
					},
				}),
			),
		)
		.mockResolvedValueOnce(new Response("missing", { status: 404 }));
	const data = await getOverheadData({ ...params, showLogo: true });
	expect(data.aircraft?.origin).toBe("BLR");
	expect(data.aircraft?.logo).toBeUndefined();
	expect(data.status).toBe("live");
});
test("route progress comes from airport coordinates and other traffic is kept", async () => {
	const other = { ...ac, hex: "other", lon: 0.05, track: 90, alt_baro: 20000 };
	const mock = feed({ ac: [ac, other], now: Date.now() });
	mock
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					ac: [{ ...ac, baro_rate: -1200 }, other],
					now: Date.now(),
				}),
			),
		)
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					response: {
						flightroute: {
							origin: { icao_code: "AAAA", latitude: 0, longitude: -1 },
							destination: { icao_code: "BBBB", latitude: 0, longitude: 3 },
						},
					},
				}),
			),
		);
	const data = await getOverheadData(params);
	expect(data.aircraft?.verticalRate).toBe(-1200);
	expect(data.aircraft?.routeFlownKm).toBeCloseTo(112.3, 0);
	expect(data.aircraft?.routeRemainingKm).toBeCloseTo(332.5, 0);
	expect(data.traffic.map((t) => t.hex)).toEqual(["other"]);
	expect(data.traffic[0]).toMatchObject({ heading: 90, altitude: 20000 });
});
test("routes without airport coordinates have no progress", async () => {
	const mock = feed({ ac: [ac], now: Date.now() });
	mock
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ ac: [ac], now: Date.now() })),
		)
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					response: {
						flightroute: {
							origin: { icao_code: "AAAA" },
							destination: { icao_code: "BBBB" },
						},
					},
				}),
			),
		);
	const data = await getOverheadData(params);
	expect(data.aircraft?.origin).toBe("AAAA");
	expect(data.aircraft?.routeFlownKm).toBeNull();
});
test("flight phase follows vertical rate, then altitude", () => {
	expect(flightPhase(5000, 1500)?.label).toBe("Climbing");
	expect(flightPhase(5000, -800)?.label).toBe("Descending");
	expect(flightPhase(37000, 0)?.label).toBe("Cruising");
	expect(flightPhase(8000, null)?.label).toBe("Level");
	expect(flightPhase(null, null)).toBeNull();
});
test("radar projection puts north up and clamps to the ring", () => {
	const east = project(10, 90, 20, 100);
	expect(east.x).toBeCloseTo(50);
	expect(east.y).toBeCloseTo(0);
	const north = project(40, 0, 20, 100);
	expect(north.y).toBeCloseTo(-100);
});
test("callsign tag never covers the observer at the centre", () => {
	const spot = placeTag({
		target: { x: 100, y: 120, size: 20 },
		centre: 100,
		size: 200,
		width: 70,
		height: 24,
		gap: 4,
		keepOut: 10,
	});
	// Just south of centre: a tag placed above the plane would sit on the observer.
	const overlaps =
		spot.left < 110 &&
		spot.left + 70 > 90 &&
		spot.top < 110 &&
		spot.top + 24 > 90;
	expect(overlaps).toBe(false);
});
