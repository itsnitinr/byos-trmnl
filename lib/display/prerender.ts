import { createHash } from "node:crypto";
import { renderMixupImage } from "@/lib/mixup/render";
import { renderRecipeForDevice } from "@/lib/recipes/recipe-renderer";
import {
	getImageFilenameExtension,
	type RenderDeviceImageResult,
} from "@/lib/render/device-image";
import { diagnoseRender } from "@/lib/render/diagnostics";
import { renderErrorImage } from "@/lib/render/error-image";
import type { DeviceProfile } from "@/lib/trmnl/device-profile";

/**
 * Render the image a device is about to be sent while answering
 * `/api/display`, so the response can name it by content.
 *
 * TRMNL firmware keeps downloaded images in flash under the response's
 * `filename`. When the name is already cached it skips the download, and when
 * it is the image already on screen it skips the e-ink refresh entirely — the
 * most expensive thing the device does. Random per-request names defeated
 * both: every wake downloaded and redrew an identical picture.
 *
 * The render uses exactly the inputs of the image route that serves
 * `image_url`, so the device's follow-up download joins this render (or hits
 * the frame cache) and gets the same bytes.
 */

export type DisplayImageTarget =
	| { kind: "recipe"; slug: string }
	| { kind: "error"; message: string }
	| { kind: "mixup"; mixupId: string };

export type DisplayImageContext = {
	profile: DeviceProfile;
	width: number;
	height: number;
	userId: string | null;
};

/**
 * Longest wait inside `/api/display`. Firmware gives the API call 15 s; past
 * this the response falls back to an on-demand render (the render keeps going
 * and the image download shares it).
 */
export const PRERENDER_DEADLINE_MS = 8_000;

export type PrerenderOutcome =
	| { kind: "ready"; image: RenderDeviceImageResult; filename: string }
	| { kind: "failed"; error: unknown }
	| { kind: "timeout" };

/** Short, flash-safe name for these bytes: `<label>-<hash>.<ext>`, at most 31 chars. */
export function contentFilename(
	label: string,
	bytes: Buffer,
	profile: DeviceProfile,
): string {
	const extension = getImageFilenameExtension(profile).slice(0, 4);
	const prefix =
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 10) || "screen";
	const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 14);
	return `${prefix}-${hash}.${extension}`;
}

async function renderTarget(
	target: DisplayImageTarget,
	context: DisplayImageContext,
): Promise<RenderDeviceImageResult | null> {
	const { profile, width, height, userId } = context;
	switch (target.kind) {
		case "error":
			return renderErrorImage({
				message: target.message,
				width,
				height,
				profile,
			});
		case "recipe": {
			const { image } = await diagnoseRender(
				userId,
				target.slug,
				width,
				height,
				() =>
					renderRecipeForDevice({
						slug: target.slug,
						profile,
						width,
						height,
						userId,
					}),
			);
			return image;
		}
		case "mixup": {
			if (!userId) return null;
			const result = await renderMixupImage({
				mixupId: target.mixupId,
				userId,
				width,
				height,
				profile,
			});
			return result.kind === "ok" ? result.image : null;
		}
	}
}

function labelFor(target: DisplayImageTarget): string {
	return target.kind === "recipe" ? target.slug : target.kind;
}

export async function prerenderDisplayImage(
	target: DisplayImageTarget,
	context: DisplayImageContext,
	deadlineMs = PRERENDER_DEADLINE_MS,
): Promise<PrerenderOutcome> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const render = renderTarget(target, context).then(
		(image): PrerenderOutcome =>
			image?.buffer.length && !image.size_limit_exceeded
				? {
						kind: "ready",
						image,
						filename: contentFilename(
							labelFor(target),
							image.buffer,
							context.profile,
						),
					}
				: { kind: "failed", error: new Error("Renderer produced no image") },
		(error: unknown): PrerenderOutcome => ({ kind: "failed", error }),
	);
	const deadline = new Promise<PrerenderOutcome>((resolve) => {
		timer = setTimeout(() => resolve({ kind: "timeout" }), deadlineMs);
		timer.unref?.();
	});
	try {
		return await Promise.race([render, deadline]);
	} finally {
		clearTimeout(timer);
	}
}
