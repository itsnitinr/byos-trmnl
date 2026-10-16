import getWindData, { gridPoints } from "./getData";
import { GRID_SIZE, paramsSchema } from "./schema";

const params = paramsSchema.parse({ latitude: 52.52, longitude: 13.4 });
const total = GRID_SIZE * GRID_SIZE;

function point(index: number) {
	return {
		current: {
			time: "2026-10-16T13:30",
			wind_speed_10m: index,
			wind_direction_10m: 270,
			wind_gusts_10m: index * 2,
		},
		hourly: {
			time: Array.from(
				{ length: 13 },
				(_, hour) => `2026-10-16T${String(13 + hour).padStart(2, "0")}:00`,
			),
			wind_speed_10m: Array.from({ length: 13 }, (_, hour) => hour),
			wind_direction_10m: Array.from({ length: 13 }, () => 180),
		},
	};
}
const feed = (body: unknown, status = 200) =>
	jest
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(new Response(JSON.stringify(body), { status }));
afterEach(() => jest.restoreAllMocks());

test("grid is centred, north-up and spans the requested width", () => {
	const points = gridPoints(52.52, 13.4, 300);
	expect(points).toHaveLength(total);
	expect(points[Math.floor(total / 2)]).toEqual({
		latitude: 52.52,
		longitude: 13.4,
	});
	expect(points[0].latitude).toBeGreaterThan(points[total - 1].latitude);
	expect(points[0].longitude).toBeLessThan(points[GRID_SIZE - 1].longitude);
	// 300 km north to south is ~2.7° of latitude.
	expect(points[0].latitude - points[total - 1].latitude).toBeCloseTo(2.695, 2);
});

test("grid wraps across the antimeridian", () => {
	const points = gridPoints(0, 179.9, 300);
	expect(points[GRID_SIZE - 1].longitude).toBeLessThan(-178);
	for (const p of points)
		expect(Math.abs(p.longitude)).toBeLessThanOrEqual(180);
});

test("one request returns the grid, centre gusts and a two-hourly outlook", async () => {
	const mock = feed(Array.from({ length: total }, (_, index) => point(index)));
	const data = await getWindData(params);
	expect(mock).toHaveBeenCalledTimes(1);
	const url = new URL(String(mock.mock.calls[0][0]));
	expect(url.searchParams.get("latitude")?.split(",")).toHaveLength(total);
	expect(data.grid).toHaveLength(total);
	expect(data.grid[0]).toEqual({ speed: 0, direction: 270 });
	expect(data.gusts).toBe(48);
	expect(data.updated).toBe("2026-10-16T13:30");
	expect(data.forecast.map((hour) => hour.speed)).toEqual([2, 4, 6, 8, 10, 12]);
	expect(data.forecast[0].time).toBe("2026-10-16T15:00");
});

test("provider failures and incomplete grids throw so the last map is kept", async () => {
	feed({ error: true }, 429);
	await expect(getWindData(params)).rejects.toThrow("429");
	feed([point(0), point(1)]);
	await expect(getWindData(params)).rejects.toThrow("incomplete");
});
