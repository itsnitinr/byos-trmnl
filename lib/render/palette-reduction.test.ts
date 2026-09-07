import {
	createLabPalette,
	nearestPaletteColor,
	reduceRgbToPalette,
	snapRgbToPalette,
} from "./palette-reduction";
import { floydSteinbergQuantize } from "./quantize";

const palettes = [
	Array.from({ length: 16 }, (_, i) => ({ r: i * 17, g: i * 17, b: i * 17 })),
	[
		{ r: 0, g: 0, b: 0 },
		{ r: 255, g: 255, b: 255 },
		{ r: 255, g: 0, b: 0 },
	],
];
const rgb = Buffer.from(
	Array.from({ length: 900 }, (_, i) => (i * 71 + (i % 17)) % 256),
);

test.each(
	palettes.map((palette) => [palette]),
)("memoized palette snapping preserves nearest-Lab output", (palette) => {
	const lab = createLabPalette(palette);
	const source = Buffer.concat([
		rgb,
		Buffer.from(Array.from({ length: 768 }, (_, i) => Math.floor(i / 3))),
	]);
	const expected = Buffer.alloc(source.length);
	for (let i = 0; i < source.length; i += 3) {
		const c = nearestPaletteColor(
			{ r: source[i], g: source[i + 1], b: source[i + 2] },
			lab,
		);
		expected.set([c.r, c.g, c.b], i);
	}
	expect(Buffer.from(snapRgbToPalette(source, palette))).toEqual(expected);
	const reference = floydSteinbergQuantize(rgb, 20, 15, 3, ([r, g, b]) => {
		const c = nearestPaletteColor({ r, g, b }, lab);
		return [c.r, c.g, c.b];
	});
	expect(reduceRgbToPalette(rgb, 20, 15, palette, "floyd-steinberg")).toEqual(
		reference,
	);
});
