export function clampByte(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

export function quantizeValue(value: number, levels: number): number {
	const step = 255 / (levels - 1);
	const level = Math.round(value / step);
	return clampByte(level * step);
}

export function grayPaletteIndex(value: number, levels: number): number {
	const step = 255 / (levels - 1);
	return Math.max(0, Math.min(levels - 1, Math.round(value / step)));
}

export function grayPaletteValue(index: number, levels: number): number {
	const step = 255 / (levels - 1);
	return clampByte(index * step);
}

type QuantizeNearest = (values: readonly number[]) => readonly number[];

/**
 * Floyd–Steinberg error diffusion with one pixel mapper per call.
 *
 * Keeps only two rows of accumulated values (the current row and the next),
 * seeded from the source as each row comes into reach, instead of a float
 * copy of the whole frame (63 MB at 1872×1404 RGB). Additions happen in the
 * same order as a whole-frame implementation, so output is bit-identical.
 *
 * `mapPixel` receives the clamped values of one pixel in `input` and must
 * write the chosen values into `output` (both of length `channels`).
 */
export function floydSteinbergDiffuse(
	data: Uint8Array | Buffer,
	width: number,
	height: number,
	channels: number,
	mapPixel: (input: Uint8Array, output: Uint8Array) => void,
): Uint8Array {
	const rowLength = width * channels;
	const result = new Uint8Array(data.length);
	let current = new Float64Array(rowLength);
	let next = new Float64Array(rowLength);
	for (let i = 0; i < rowLength && i < data.length; i++) current[i] = data[i];
	const input = new Uint8Array(channels);
	const chosen = new Uint8Array(channels);
	const error = new Float64Array(channels);

	for (let y = 0; y < height; y++) {
		const hasNext = y + 1 < height;
		if (hasNext) {
			const offset = (y + 1) * rowLength;
			for (let i = 0; i < rowLength; i++) next[i] = data[offset + i];
		}
		const rowOffset = y * rowLength;
		for (let x = 0; x < width; x++) {
			const index = x * channels;
			for (let c = 0; c < channels; c++) {
				input[c] = clampByte(current[index + c]);
			}
			mapPixel(input, chosen);
			for (let c = 0; c < channels; c++) {
				const value = chosen[c];
				result[rowOffset + index + c] = value;
				error[c] = input[c] - value;
			}
			// Same targets and order as the textbook loop: right, below-left,
			// below, below-right.
			if (x + 1 < width) {
				for (let c = 0; c < channels; c++)
					current[index + channels + c] += error[c] * (7 / 16);
			}
			if (hasNext) {
				if (x > 0) {
					for (let c = 0; c < channels; c++)
						next[index - channels + c] += error[c] * (3 / 16);
				}
				for (let c = 0; c < channels; c++)
					next[index + c] += error[c] * (5 / 16);
				if (x + 1 < width) {
					for (let c = 0; c < channels; c++)
						next[index + channels + c] += error[c] * (1 / 16);
				}
			}
		}
		const swap = current;
		current = next;
		next = swap;
	}
	return result;
}

/**
 * Single-channel `floydSteinbergDiffuse` with the mapping as a 256-entry
 * lookup table: the hot path for grayscale screens. Same arithmetic, scalar
 * loop.
 */
export function floydSteinbergGrayLut(
	data: Uint8Array,
	width: number,
	height: number,
	lut: Uint8Array,
): Uint8Array {
	const result = new Uint8Array(data.length);
	let current = new Float64Array(width);
	let next = new Float64Array(width);
	for (let x = 0; x < width && x < data.length; x++) current[x] = data[x];
	for (let y = 0; y < height; y++) {
		const hasNext = y + 1 < height;
		const rowOffset = y * width;
		if (hasNext) {
			const nextOffset = rowOffset + width;
			for (let x = 0; x < width; x++) next[x] = data[nextOffset + x];
		}
		for (let x = 0; x < width; x++) {
			const value = clampByte(current[x]);
			const chosen = lut[value];
			result[rowOffset + x] = chosen;
			const error = value - chosen;
			if (x + 1 < width) current[x + 1] += error * (7 / 16);
			if (hasNext) {
				if (x > 0) next[x - 1] += error * (3 / 16);
				next[x] += error * (5 / 16);
				if (x + 1 < width) next[x + 1] += error * (1 / 16);
			}
		}
		const swap = current;
		current = next;
		next = swap;
	}
	return result;
}

export function floydSteinbergQuantize(
	data: Uint8Array | Buffer,
	width: number,
	height: number,
	channels: number,
	nearest: QuantizeNearest,
): Uint8Array {
	const values = new Array<number>(channels);
	return floydSteinbergDiffuse(
		data,
		width,
		height,
		channels,
		(input, output) => {
			for (let c = 0; c < channels; c++) values[c] = input[c];
			const mapped = nearest(values);
			for (let c = 0; c < channels; c++) output[c] = clampByte(mapped[c] ?? 0);
		},
	);
}

export function floydSteinbergGray(
	data: Uint8Array | Buffer,
	width: number,
	height: number,
	levels: number,
): Uint8Array {
	return floydSteinbergQuantize(data, width, height, 1, ([value]) => [
		quantizeValue(value ?? 0, levels),
	]);
}
