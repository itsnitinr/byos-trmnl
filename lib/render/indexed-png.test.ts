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
