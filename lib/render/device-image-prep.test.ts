import sharp from "sharp";
import { trmnlModelSchema } from "@/lib/trmnl/types";
import { prepareImageForDevice } from "./device-image-prep";

test("reuses preparation by source bytes and isolates dimensions and palettes", async () => {
	const source = await sharp({
		create: { width: 8, height: 8, channels: 3, background: "#888888" },
	})
		.png()
		.toBuffer();
	const profile = {
		model: trmnlModelSchema.parse({
			name: "test",
			label: "Test",
			width: 8,
			height: 8,
			colors: 2,
			bit_depth: 1,
			scale_factor: 1,
			rotation: 0,
			mime_type: "image/png",
			offset_x: 0,
			offset_y: 0,
			palette_ids: [],
		}),
		palette: { id: "bw", name: "BW", grays: 2 },
	};
	const original = await prepareImageForDevice({
		src: source,
		profile,
		width: 8,
	});
	const repeated = await prepareImageForDevice({
		src: Buffer.from(source),
		profile,
		width: 8,
	});
	expect(repeated).toBe(original);
	const resized = await prepareImageForDevice({
		src: source,
		profile,
		width: 4,
	});
	expect(await sharp(resized.buffer).metadata()).toMatchObject({
		width: 4,
		height: 4,
	});
	const gray = await prepareImageForDevice({
		src: source,
		profile: { ...profile, palette: { id: "gray", name: "Gray", grays: 4 } },
		width: 8,
	});
	expect(gray).not.toBe(original);
	expect(gray.buffer.equals(original.buffer)).toBe(false);
});
