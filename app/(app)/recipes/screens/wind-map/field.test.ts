import {
	beaufort,
	compassPoint,
	drawWindMap,
	formatSpeed,
	windField,
} from "./field";
import { GRID_SIZE, type WindSample } from "./schema";

const uniform = (speed: number, direction: number): WindSample[] =>
	Array.from({ length: GRID_SIZE * GRID_SIZE }, () => ({ speed, direction }));

test("flow points downwind in screen space", () => {
	// A westerly blows towards the east: +x on screen.
	const west = windField(uniform(20, 270))(3, 3);
	expect(west.u).toBeCloseTo(20);
	expect(west.v).toBeCloseTo(0);
	// A northerly blows towards the south: +y on screen.
	expect(windField(uniform(10, 0))(1.5, 4.2).v).toBeCloseTo(10);
});

test("interpolates components so opposing directions cancel instead of averaging angles", () => {
	const grid = uniform(10, 350);
	for (let row = 0; row < GRID_SIZE; row++)
		grid[row * GRID_SIZE + 1] = { speed: 10, direction: 10 };
	const between = windField(grid)(0.5, 3);
	// 350° and 10° average to due north, not 180°.
	expect(between.v).toBeGreaterThan(9);
	expect(Math.abs(between.u)).toBeLessThan(1e-9);
});

test("streamlines are reproducible, finite and fill the map", () => {
	const grid = uniform(25, 225).map((sample, index) => ({
		...sample,
		direction: 200 + (index % GRID_SIZE) * 8,
	}));
	const options = { grid, width: 460, height: 400, spanKm: 300 };
	const map = drawWindMap(options);
	expect(drawWindMap(options)).toEqual(map);
	expect(map.calm).toBe(false);
	expect(map.lines).toBeGreaterThan(15);
	expect(map.svg).not.toMatch(/NaN|Infinity/);
	expect(map.ringKm).toBe(50);
});

test("still air draws no streamlines", () => {
	const map = drawWindMap({
		grid: uniform(0.2, 90),
		width: 300,
		height: 200,
		spanKm: 100,
	});
	expect(map.calm).toBe(true);
	expect(map.lines).toBe(0);
});

test("stronger wind draws heavier strokes", () => {
	const weight = (speed: number) =>
		Number(
			drawWindMap({
				grid: uniform(speed, 270),
				width: 200,
				height: 200,
				spanKm: 100,
			}).svg.match(/stroke-width="([\d.]+)"/)?.[1],
		);
	expect(weight(60)).toBeGreaterThan(weight(8));
});

test("labels and unit conversion", () => {
	expect(beaufort(0.4)).toEqual({ force: 0, name: "Calm" });
	expect(beaufort(25)).toEqual({ force: 4, name: "Moderate breeze" });
	expect(beaufort(130).force).toBe(12);
	expect(compassPoint(225)).toBe("SW");
	expect(compassPoint(-10)).toBe("N");
	expect(compassPoint(349)).toBe("N");
	expect(formatSpeed(36, "ms")).toBe("10");
	expect(formatSpeed(100, "mph")).toBe("62");
});
