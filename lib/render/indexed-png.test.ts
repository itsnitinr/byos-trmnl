import { inflateSync } from "node:zlib";
import sharp from "sharp";
import { encodeIndexedPng } from "./indexed-png";

test.each([
	2, 4, 6, 16, 256,
])("lossless %i-colour PNG handles odd-width row padding and packed bit depths", async (count) => {
	const palette = Array.from({ length: count }, (_, i) => [
		i,
		(i * 31) % 256,
		255 - i,
	]);
	const width = 19,
		height = 7;
	const rgb = Buffer.from(
		Array.from({ length: width * height }, (_, i) => palette[i % count]).flat(),
	);
	const png = await encodeIndexedPng(rgb, width, height, palette);
	expect(png).not.toBeNull();
	const decoded = await sharp(png as Buffer)
		.removeAlpha()
		.toColourspace("srgb")
		.raw()
		.toBuffer();
	expect(decoded).toEqual(rgb);
});
test("unknown palette colours are returned to the generic encoder without lossy mapping", async () => {
	expect(
		await encodeIndexedPng(Buffer.from([1, 2, 3]), 1, 1, [
			[0, 0, 0],
			[255, 255, 255],
		]),
	).toBeNull();
	await expect(
		encodeIndexedPng(Buffer.alloc(2), 1, 1, [[0, 0, 0]]),
	).rejects.toThrow("Invalid indexed PNG input");
});

test.each([
	["black first", [0, 0, 0], [255, 255, 255]],
	["white first", [255, 255, 255], [0, 0, 0]],
])("black-and-white palette (%s) is written as 1-bit grayscale, 0 = black", async (_, first, second) => {
	// A black pixel followed by seven white ones: one packed byte, 0b01111111.
	const width = 8;
	const rgb = Buffer.from([
		0,
		0,
		0,
		...Array.from({ length: width - 1 }, () => [255, 255, 255]).flat(),
	]);
	const png = (await encodeIndexedPng(rgb, width, 1, [
		first,
		second,
	])) as Buffer;
	expect(png[24]).toBe(1); // bit depth
	expect(png[25]).toBe(0); // colour type: grayscale, so firmware draws samples as-is
	expect(png.includes(Buffer.from("PLTE"))).toBe(false);
	const idat = png.indexOf("IDAT");
	const scanline = inflateSync(
		png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)),
	);
	expect([...scanline]).toEqual([0, 0b01111111]);
	const decoded = await sharp(png).toColourspace("srgb").raw().toBuffer();
	expect(decoded).toEqual(rgb);
});
