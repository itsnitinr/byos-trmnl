import { promisify } from "node:util";
import { deflate } from "node:zlib";

const compress = promisify(deflate);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function chunk(type: string, data: Buffer): Buffer {
	const out = Buffer.allocUnsafe(data.length + 12);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, 4, "ascii");
	data.copy(out, 8);
	let crc = 0xffffffff;
	for (let i = 4; i < out.length - 4; i++)
		crc = crcTable[(crc ^ out[i]) & 255] ^ (crc >>> 8);
	out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
	return out;
}
/** Lossless PNG for pixels already reduced to an exact device palette.
 * https://www.w3.org/TR/png-3/ (indexed colour, packed scanlines, PLTE and CRC).
 * Returns null if a pixel is outside the palette, so callers can safely use a generic encoder.
 */
export async function encodeIndexedPng(
	rgb: Uint8Array,
	width: number,
	height: number,
	palette: readonly (readonly number[])[],
	level = 6,
): Promise<Buffer | null> {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1 ||
		rgb.length !== width * height * 3 ||
		palette.length < 1 ||
		palette.length > 256
	)
		throw new Error("Invalid indexed PNG input");
	const depth =
		palette.length <= 2
			? 1
			: palette.length <= 4
				? 2
				: palette.length <= 16
					? 4
					: 8;
	const lookup = new Map<number, number>();
	const plte = Buffer.alloc(palette.length * 3);
	palette.forEach((color, i) => {
		if (
			color.length !== 3 ||
			color.some((c) => !Number.isInteger(c) || c < 0 || c > 255)
		)
			throw new Error("Invalid PNG palette");
		plte.set(color, i * 3);
		lookup.set((color[0] << 16) | (color[1] << 8) | color[2], i);
	});
	const stride = 1 + Math.ceil((width * depth) / 8);
	const scanlines = Buffer.alloc(stride * height); // Filter type 0; unused trailing bits stay zero.
	let previousColor = -1,
		previousIndex = 0;
	for (let y = 0, pixel = 0; y < height; y++) {
		for (let x = 0; x < width; x++, pixel += 3) {
			const color = (rgb[pixel] << 16) | (rgb[pixel + 1] << 8) | rgb[pixel + 2];
			if (color !== previousColor) {
				const index = lookup.get(color);
				if (index === undefined) return null;
				previousColor = color;
				previousIndex = index;
			}
			const bit = x * depth;
			scanlines[y * stride + 1 + (bit >>> 3)] |=
				previousIndex << (8 - depth - (bit & 7));
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = depth;
	header[9] = 3;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("PLTE", plte),
		chunk("IDAT", await compress(scanlines, { level })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
