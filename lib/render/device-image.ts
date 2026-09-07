import { createHash } from "node:crypto";
import sharp from "sharp";
import { BoundedCache, cacheKey } from "@/lib/cache/bounded-cache";
import { type BmpGrayLevel, encodeGrayBmp } from "@/lib/render/bmp-encoder";
import {
	type PaletteReductionMode,
	reduceRgbToPalette,
} from "@/lib/render/palette-reduction";
import { quantizeValue } from "@/lib/render/quantize";
import type { DeviceProfile } from "@/lib/trmnl/device-profile";
import {
	resolveDeviceRenderTarget,
	VALID_GRAY_LEVELS,
} from "@/lib/trmnl/palette-colors";

export type RenderDeviceImageInput = {
	png: Buffer;
	profile: DeviceProfile;
	/**
	 * How the finished frame is mapped onto the device palette. Defaults to
	 * `"snap"` so text, icons, and flat fills stay crisp. Recipes that rely on
	 * intermediate grays (a contribution heatmap, a photo-like screen) can opt
	 * into `"floyd-steinberg"` via `renderSettings.paletteReduction`, which
	 * renders those grays as dither texture instead of collapsing them.
	 */
	reductionMode?: PaletteReductionMode;
};

export type RenderDeviceImageResult = {
	buffer: Buffer;
	mime_type: string;
	filename_ext: string;
	size_limit_exceeded: boolean;
	fallback?: boolean;
	cacheStatus?: import("@/lib/cache/bounded-cache").CacheStatus;
};

const MIME_EXTENSION: Record<string, string> = {
	"image/bmp": "bmp",
	"image/png": "png",
	"image/webp": "webp",
};

const BMP_GRAY_LEVELS = new Set<number>(VALID_GRAY_LEVELS);

export function getImageFilenameExtension(profile: DeviceProfile): string {
	return (
		MIME_EXTENSION[profile.model.mime_type] ??
		profile.model.mime_type.split("/").at(-1) ??
		"bin"
	);
}

function bmpPaletteDepthFromTargetColorCount(
	paletteColorCount: number | undefined,
): BmpGrayLevel {
	if (paletteColorCount && BMP_GRAY_LEVELS.has(paletteColorCount)) {
		return paletteColorCount as BmpGrayLevel;
	}
	return 2;
}

type DevicePixels = { data: Buffer; width: number; height: number };

async function transformToDevicePixels(
	png: Buffer,
	profile: DeviceProfile,
): Promise<DevicePixels> {
	const image = sharp(png)
		.flatten({ background: "#ffffff" })
		.resize(profile.model.width, profile.model.height, { fit: "cover" });
	if (profile.model.rotation !== 0) image.rotate(profile.model.rotation);
	const { data, info } = await image
		.removeAlpha()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

async function encode(
	pixels: DevicePixels,
	mimeType: string,
	imageSizeLimit?: number,
	options: { paletteColorCount?: number } = {},
): Promise<{ buffer: Buffer; sizeLimitExceeded: boolean }> {
	const image = () =>
		sharp(pixels.data, {
			raw: { width: pixels.width, height: pixels.height, channels: 3 },
		});
	if (mimeType === "image/bmp") {
		const levels = bmpPaletteDepthFromTargetColorCount(
			options.paletteColorCount,
		);
		const source = await image()
			.removeAlpha()
			.grayscale()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const buffer = Buffer.from(
			encodeGrayBmp({
				gray: source.data,
				width: source.info.width,
				height: source.info.height,
				levels,
			}),
		);
		return {
			buffer,
			sizeLimitExceeded: Boolean(
				imageSizeLimit && buffer.length > imageSizeLimit,
			),
		};
	}

	if (mimeType === "image/webp") {
		for (const quality of [90, 80, 70, 60, 50]) {
			const buffer = await image().webp({ quality }).toBuffer();
			if (
				!imageSizeLimit ||
				buffer.length <= imageSizeLimit ||
				quality === 50
			) {
				return {
					buffer,
					sizeLimitExceeded: Boolean(
						imageSizeLimit && buffer.length > imageSizeLimit,
					),
				};
			}
		}
	}

	if (mimeType === "image/png") {
		const candidates: Buffer[] = [
			await image().png({ compressionLevel: 9, effort: 10 }).toBuffer(),
		];
		if (options.paletteColorCount && options.paletteColorCount <= 256) {
			candidates.push(
				await image()
					.png({
						palette: true,
						colours: options.paletteColorCount,
						colors: options.paletteColorCount,
						compressionLevel: 9,
						effort: 10,
						dither: 0,
					})
					.toBuffer(),
			);
		}

		const buffer = candidates.reduce((smallest, candidate) =>
			candidate.length < smallest.length ? candidate : smallest,
		);
		return {
			buffer,
			sizeLimitExceeded: Boolean(
				imageSizeLimit && buffer.length > imageSizeLimit,
			),
		};
	}

	const buffer = await image()
		.png({ compressionLevel: 9, effort: 10 })
		.toBuffer();
	return {
		buffer,
		sizeLimitExceeded: Boolean(
			imageSizeLimit && buffer.length > imageSizeLimit,
		),
	};
}

async function encodeDeviceImage({
	png,
	profile,
	reductionMode = "snap",
}: RenderDeviceImageInput): Promise<RenderDeviceImageResult> {
	const pixels = await transformToDevicePixels(png, profile);
	const target = resolveDeviceRenderTarget(profile.palette);
	let paletteColorCount: number | undefined;
	if (target.targetPalette && profile.model.bit_depth < 24) {
		paletteColorCount = target.targetPalette.length;
		pixels.data = Buffer.from(
			reduceRgbToPalette(
				pixels.data,
				pixels.width,
				pixels.height,
				target.targetPalette,
				reductionMode,
			),
		);
	} else if (
		typeof target.channelBitDepth === "number" &&
		target.channelBitDepth < 8
	) {
		const levels = 1 << target.channelBitDepth;
		for (let i = 0; i < pixels.data.length; i++)
			pixels.data[i] = quantizeValue(pixels.data[i], levels);
	}

	const { buffer, sizeLimitExceeded } = await encode(
		pixels,
		profile.model.mime_type,
		profile.model.image_size_limit,
		{ paletteColorCount },
	);

	return {
		buffer,
		mime_type: profile.model.mime_type,
		filename_ext: getImageFilenameExtension(profile),
		size_limit_exceeded: sizeLimitExceeded,
	};
}

export class ImageBudgetError extends Error {
	constructor() {
		super("Device image budget is too small for a valid image");
		this.name = "ImageBudgetError";
	}
}

async function encodeWithinBudget(
	input: RenderDeviceImageInput,
): Promise<RenderDeviceImageResult> {
	const image = await encodeDeviceImage(input);
	if (!image.size_limit_exceeded) return image;
	const { width, height } = input.profile.model;
	const size = Math.max(10, Math.min(24, Math.round(width / 30)));
	const svg = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><text x="12" y="${Math.round(height / 2)}" font-family="sans-serif" font-size="${size}" fill="black">Image exceeds device limit</text><text x="12" y="${Math.round(height / 2) + size * 2}" font-family="sans-serif" font-size="${Math.round(size * 0.7)}" fill="black">Choose a simpler layout or fewer images.</text></svg>`,
	);
	const png = await sharp(svg).png().toBuffer();
	const fallback = await encodeDeviceImage({
		...input,
		png,
		reductionMode: "snap",
	});
	if (fallback.size_limit_exceeded) throw new ImageBudgetError();
	return { ...fallback, fallback: true };
}

const encodedFrames = new BoundedCache<RenderDeviceImageResult>(
	32 * 1024 * 1024,
);

export async function renderDeviceImage(
	input: RenderDeviceImageInput,
): Promise<RenderDeviceImageResult> {
	const key = cacheKey({
		profile: input.profile,
		reduction: input.reductionMode,
		png: createHash("sha256").update(input.png).digest("hex"),
	});
	const result = await encodedFrames.get(
		key,
		30_000,
		() => encodeWithinBudget(input),
		(image) => image.buffer.length,
	);
	return { ...result.value, cacheStatus: result.status };
}
