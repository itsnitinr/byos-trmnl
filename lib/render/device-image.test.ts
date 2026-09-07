import sharp from "sharp";
import { trmnlModelSchema } from "@/lib/trmnl/types";
import { ImageBudgetError, renderDeviceImage } from "./device-image";

const model = trmnlModelSchema.parse({
	name: "test",
	label: "Test",
	width: 400,
	height: 240,
	colors: 16777216,
	bit_depth: 24,
	scale_factor: 1,
	rotation: 0,
	mime_type: "image/png",
	offset_x: 0,
	offset_y: 0,
	palette_ids: [],
	image_size_limit: 4000,
});

test("replaces oversized output with a valid same-format, same-size image", async () => {
	let seed = 1;
	const rgb = Buffer.from(
		Array.from({ length: 400 * 240 * 3 }, () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed >>> 24;
		}),
	);
	const png = await sharp(rgb, {
		raw: { width: 400, height: 240, channels: 3 },
	})
		.png()
		.toBuffer();
	const image = await renderDeviceImage({
		png,
		profile: { model, palette: null },
	});
	expect(image.fallback).toBe(true);
	expect(image.buffer.length).toBeLessThanOrEqual(4000);
	expect(await sharp(image.buffer).metadata()).toMatchObject({
		width: 400,
		height: 240,
		format: "png",
	});
});

test("rejects physically impossible budgets instead of sending an invalid payload", async () => {
	const png = await sharp({
		create: { width: 400, height: 240, channels: 3, background: "white" },
	})
		.png()
		.toBuffer();
	await expect(
		renderDeviceImage({
			png,
			profile: {
				model: {
					...model,
					mime_type: "image/bmp",
					image_size_limit: 1,
					bit_depth: 1,
				},
				palette: { id: "bw", name: "Black and white", grays: 2 },
			},
		}),
	).rejects.toBeInstanceOf(ImageBudgetError);
});
