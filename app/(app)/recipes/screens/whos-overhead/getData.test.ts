import getOverheadData, { relativePosition, selectAircraft } from "./getData";
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
