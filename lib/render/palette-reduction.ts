import sharp from "sharp";
import {
	floydSteinbergGrayLut,
	floydSteinbergRgb,
	quantizeValue,
} from "@/lib/render/quantize";
import type { RGB } from "@/lib/trmnl/palette-colors";

type Lab = {
	l: number;
	a: number;
	b: number;
};

type LabPaletteColor = RGB & { lab: Lab };

export type PaletteReductionMode = "snap" | "floyd-steinberg";

function pivotRgb(value: number): number {
	const normalized = value / 255;
	return normalized <= 0.04045
		? normalized / 12.92
		: ((normalized + 0.055) / 1.055) ** 2.4;
}

function pivotXyz(value: number): number {
	return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

function rgbToLab(color: RGB): Lab {
	const r = pivotRgb(color.r);
	const g = pivotRgb(color.g);
	const b = pivotRgb(color.b);

	const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
	const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1;
	const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

	const fx = pivotXyz(x);
	const fy = pivotXyz(y);
	const fz = pivotXyz(z);

	return {
		l: 116 * fy - 16,
		a: 500 * (fx - fy),
		b: 200 * (fy - fz),
	};
}

function labDistanceSquared(a: Lab, b: Lab): number {
	return (a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
}

export function createLabPalette(palette: RGB[]): LabPaletteColor[] {
	if (!palette.length) {
		throw new Error("Cannot reduce image to an empty palette");
	}
	return palette.map((color) => ({ ...color, lab: rgbToLab(color) }));
}

export function nearestPaletteColor(
	color: RGB,
	palette: LabPaletteColor[],
): RGB {
	const lab = rgbToLab(color);
	let best = palette[0];
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const candidate of palette) {
		const distance = labDistanceSquared(lab, candidate.lab);
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}

	return best;
}

/** Direct-mapped memo size for non-gray colours (2^18 entries, 2 MiB). */
const COLOR_CACHE_BITS = 18;

function createPaletteMapper(paletteColors: RGB[]) {
	const palette = createLabPalette(paletteColors);
	const gray = new Int32Array(256).fill(-1);
	// Keys are 0xRRGGBB, so -1 marks an empty slot. Collisions just recompute.
	const cacheSize = 1 << COLOR_CACHE_BITS;
	const keys = new Int32Array(cacheSize).fill(-1);
	const values = new Int32Array(cacheSize);
	return (r: number, g: number, b: number): number => {
		if (r === g && g === b) {
			const cached = gray[r];
			if (cached !== -1) return cached;
			const color = nearestPaletteColor({ r, g, b }, palette);
			gray[r] = (color.r << 16) | (color.g << 8) | color.b;
			return gray[r];
		}
		const key = (r << 16) | (g << 8) | b;
		// Fibonacci hashing spreads neighbouring colours across the table.
		const slot = Math.imul(key, 0x9e3779b1) >>> (32 - COLOR_CACHE_BITS);
		if (keys[slot] === key) return values[slot];
		const color = nearestPaletteColor({ r, g, b }, palette);
		const packed = (color.r << 16) | (color.g << 8) | color.b;
		keys[slot] = key;
		values[slot] = packed;
		return packed;
	};
}

function isGrayPalette(palette: RGB[]): boolean {
	return palette.every((color) => color.r === color.g && color.g === color.b);
}

function isGrayImage(data: Uint8Array | Buffer): boolean {
	for (let i = 0; i < data.length; i += 3) {
		if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) return false;
	}
	return true;
}

export function snapRgbToPalette(
	data: Uint8Array | Buffer,
	paletteColors: RGB[],
): Uint8Array {
	const nearest = createPaletteMapper(paletteColors);
	const output = new Uint8Array(data.length);
	if (isGrayPalette(paletteColors) && isGrayImage(data)) {
		// Same choices as the per-pixel mapper, read from a 256-entry table.
		const lut = new Uint8Array(256);
		for (let v = 0; v < 256; v++) lut[v] = nearest(v, v, v) & 255;
		for (let index = 0; index < data.length; index += 3) {
			const value = lut[data[index]];
			output[index] = value;
			output[index + 1] = value;
			output[index + 2] = value;
		}
		return output;
	}
	for (let index = 0; index < data.length; index += 3) {
		const color = nearest(data[index], data[index + 1], data[index + 2]);
		output[index] = (color >>> 16) & 255;
		output[index + 1] = (color >>> 8) & 255;
		output[index + 2] = color & 255;
	}
	return output;
}

export function reduceRgbToPalette(
	data: Uint8Array | Buffer,
	width: number,
	height: number,
	paletteColors: RGB[],
	mode: PaletteReductionMode,
): Uint8Array {
	if (mode === "snap") return snapRgbToPalette(data, paletteColors);
	const nearest = createPaletteMapper(paletteColors);
	if (isGrayPalette(paletteColors) && isGrayImage(data)) {
		// With gray pixels and a gray palette every channel carries the same
		// value and the same error, so diffusing one channel and copying it is
		// exactly the 3-channel result at a third of the work.
		const lut = new Uint8Array(256);
		for (let v = 0; v < 256; v++) lut[v] = nearest(v, v, v) & 255;
		const luma = new Uint8Array(width * height);
		for (let i = 0, p = 0; p < luma.length; i += 3, p++) luma[p] = data[i];
		const reduced = floydSteinbergGrayLut(luma, width, height, lut);
		const output = new Uint8Array(data.length);
		for (let i = 0, p = 0; p < reduced.length; i += 3, p++) {
			output[i] = output[i + 1] = output[i + 2] = reduced[p];
		}
		return output;
	}
	return floydSteinbergRgb(data, width, height, nearest);
}

export async function reducePngToPalette(
	png: Buffer,
	paletteColors: RGB[],
	mode: PaletteReductionMode,
): Promise<Buffer> {
	const source = await sharp(png)
		.removeAlpha()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height } = source.info;
	const output = reduceRgbToPalette(
		source.data,
		width,
		height,
		paletteColors,
		mode,
	);

	return sharp(output, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer();
}

export async function quantizePngChannels(
	png: Buffer,
	channelBitDepth: number,
): Promise<Buffer> {
	if (channelBitDepth >= 8) {
		return png;
	}

	const source = await sharp(png)
		.removeAlpha()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height, channels } = source.info;
	const levels = 1 << channelBitDepth;
	const output = Buffer.alloc(source.data.length);

	for (let i = 0; i < source.data.length; i++) {
		const value = source.data[i] ?? 0;
		output[i] = quantizeValue(value, levels);
	}

	return sharp(output, { raw: { width, height, channels } }).png().toBuffer();
}
