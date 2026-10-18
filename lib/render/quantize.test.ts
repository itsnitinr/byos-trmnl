import { reduceRgbToPalette } from "./palette-reduction";
import { clampByte, floydSteinbergGray, quantizeValue } from "./quantize";

/** The previous whole-frame implementation, kept as the reference. */
function referenceFloydSteinberg(
	data: Uint8Array,
	width: number,
	height: number,
	channels: number,
	nearest: (values: readonly number[]) => readonly number[],
): Uint8Array {
	const pixels = new Float64Array(data.length);
	for (let i = 0; i < data.length; i++) pixels[i] = data[i] ?? 0;
	const output = new Uint8Array(data.length);
	const oldValues = new Array<number>(channels);
	const error = new Array<number>(channels);
	const spread = (x: number, y: number, factor: number) => {
		if (x < 0 || x >= width || y < 0 || y >= height) return;
		const index = (y * width + x) * channels;
		for (let c = 0; c < channels; c++)
			pixels[index + c] += (error[c] ?? 0) * factor;
	};
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = (y * width + x) * channels;
			for (let c = 0; c < channels; c++)
				oldValues[c] = clampByte(pixels[index + c] ?? 0);
			const next = nearest(oldValues);
			for (let c = 0; c < channels; c++) {
				const value = clampByte(next[c] ?? 0);
				output[index + c] = value;
				error[c] = (oldValues[c] ?? 0) - value;
			}
			spread(x + 1, y, 7 / 16);
			spread(x - 1, y + 1, 3 / 16);
			spread(x, y + 1, 5 / 16);
			spread(x + 1, y + 1, 1 / 16);
		}
	}
	return output;
}

function randomImage(
	width: number,
	height: number,
	channels: number,
	seed: number,
) {
	let state = seed;
	const random = () => {
		state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
	const data = new Uint8Array(width * height * channels);
	for (let i = 0; i < data.length; i += channels) {
		// Mix of flat areas, gradients and noise, like rendered screens.
		const x = (i / channels) % width;
		const base =
			x < width / 3
				? 255
				: x < (2 * width) / 3
					? (x * 7) % 256
					: random() * 255;
		for (let c = 0; c < channels; c++)
			data[i + c] = channels === 3 && random() < 0.2 ? random() * 255 : base;
	}
	return data;
}

const palettes = {
	bw: [0, 255],
	gray4: [0, 85, 170, 255],
	gray16: Array.from({ length: 16 }, (_, i) => i * 17),
};

test.each(
	Object.entries(palettes),
)("palette reduction matches the reference ditherer exactly (%s)", (_name, grays) => {
	const palette = grays.map((v) => ({ r: v, g: v, b: v }));
	const color6 = [
		{ r: 0, g: 0, b: 0 },
		{ r: 255, g: 255, b: 255 },
		{ r: 255, g: 0, b: 0 },
		{ r: 0, g: 255, b: 0 },
		{ r: 0, g: 0, b: 255 },
		{ r: 255, g: 255, b: 0 },
	];
	for (const [seed, colors] of [
		[1, palette],
		[2, color6],
	] as const) {
		const image = randomImage(97, 61, 3, seed);
		const nearest = (values: readonly number[]) => {
			// Same nearest-colour choice as the production mapper, via a snap.
			const snapped = reduceRgbToPalette(
				Uint8Array.from(values),
				1,
				1,
				[...colors],
				"snap",
			);
			return [snapped[0], snapped[1], snapped[2]];
		};
		expect(
			Buffer.from(
				reduceRgbToPalette(image, 97, 61, [...colors], "floyd-steinberg"),
			),
		).toEqual(Buffer.from(referenceFloydSteinberg(image, 97, 61, 3, nearest)));
	}
});

test("the gray fast path matches the 3-channel reference exactly", () => {
	const gray = randomImage(97, 61, 1, 5);
	const rgb = new Uint8Array(gray.length * 3);
	for (let i = 0; i < gray.length; i++)
		rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = gray[i];
	for (const grays of Object.values(palettes)) {
		const palette = grays.map((v) => ({ r: v, g: v, b: v }));
		const nearest = (values: readonly number[]) => {
			const snapped = reduceRgbToPalette(
				Uint8Array.from(values),
				1,
				1,
				palette,
				"snap",
			);
			return [snapped[0], snapped[1], snapped[2]];
		};
		expect(
			Buffer.from(reduceRgbToPalette(rgb, 97, 61, palette, "floyd-steinberg")),
		).toEqual(Buffer.from(referenceFloydSteinberg(rgb, 97, 61, 3, nearest)));
	}
});

test("gray dithering matches the reference exactly", () => {
	const image = randomImage(83, 47, 1, 3);
	for (const levels of [2, 4, 16]) {
		expect(Buffer.from(floydSteinbergGray(image, 83, 47, levels))).toEqual(
			Buffer.from(
				referenceFloydSteinberg(image, 83, 47, 1, ([v]) => [
					quantizeValue(v ?? 0, levels),
				]),
			),
		);
	}
});

test("handles single-row and single-column frames", () => {
	for (const [w, h] of [
		[1, 1],
		[17, 1],
		[1, 13],
	]) {
		const image = randomImage(w, h, 1, 4);
		expect(Buffer.from(floydSteinbergGray(image, w, h, 2))).toEqual(
			Buffer.from(
				referenceFloydSteinberg(image, w, h, 1, ([v]) => [
					quantizeValue(v ?? 0, 2),
				]),
			),
		);
	}
});

test("the gray snap fast path matches per-pixel nearest-colour snapping", () => {
	const gray = randomImage(61, 37, 1, 6);
	const rgb = new Uint8Array(gray.length * 3);
	for (let i = 0; i < gray.length; i++)
		rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = gray[i];
	// One colored pixel forces the general path for comparison.
	const mixed = Uint8Array.from(rgb);
	mixed[0] = 255;
	mixed[1] = 0;
	for (const grays of Object.values(palettes)) {
		const palette = grays.map((v) => ({ r: v, g: v, b: v }));
		const fast = reduceRgbToPalette(rgb, 61, 37, palette, "snap");
		const general = reduceRgbToPalette(mixed, 61, 37, palette, "snap");
		expect(Buffer.from(fast.subarray(3))).toEqual(
			Buffer.from(general.subarray(3)),
		);
	}
});
