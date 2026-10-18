import sharp from "sharp";
import { withExplicitUserScope } from "@/lib/database/scoped-db";
import { getLayoutById, type LayoutSlot } from "@/lib/mixup/constants";
import { logger } from "@/lib/recipes/logger";
import { renderRecipeToImage } from "@/lib/recipes/recipe-renderer";
import {
	type RenderDeviceImageResult,
	renderDeviceImage,
} from "@/lib/render/device-image";
import type { DeviceProfile } from "@/lib/trmnl/device-profile";

export type MixupRenderResult =
	| { kind: "ok"; image: RenderDeviceImageResult }
	| { kind: "not-found" }
	| { kind: "invalid-layout"; layoutId: string };

/**
 * Render one slot. Slots get the same model/palette inputs as a full-screen
 * render (UI scale, model CSS), so a recipe looks the same in a slot as on
 * its own. A failed slot is left blank rather than failing the whole mixup.
 */
async function renderSlot(
	slot: LayoutSlot,
	recipeSlug: string,
	profile: DeviceProfile,
	userId: string,
	cookies?: string,
): Promise<Buffer | null> {
	try {
		const renders = await renderRecipeToImage({
			slug: recipeSlug,
			imageWidth: slot.width,
			imageHeight: slot.height,
			deviceProfile: profile,
			model: profile.model,
			palette: profile.palette,
			paletteId: profile.palette?.id ?? null,
			userId,
			cookies,
		});
		return renders.png;
	} catch (error) {
		logger.error(
			`Error rendering slot ${slot.id} with recipe ${recipeSlug}:`,
			error,
		);
		return null;
	}
}

async function compositeSlots(
	slots: LayoutSlot[],
	assignments: Record<string, string | null>,
	width: number,
	height: number,
	profile: DeviceProfile,
	userId: string,
	cookies?: string,
): Promise<Buffer> {
	const slotRenders = await Promise.all(
		slots.map(async (slot) => {
			const recipeSlug = assignments[slot.id];
			return {
				slot,
				buffer: recipeSlug
					? await renderSlot(slot, recipeSlug, profile, userId, cookies)
					: null,
			};
		}),
	);

	const overlays: sharp.OverlayOptions[] = [];
	for (const { slot, buffer } of slotRenders) {
		if (!buffer) continue;
		try {
			overlays.push({
				input: await sharp(buffer)
					.resize(slot.width, slot.height, { fit: "cover" })
					.toBuffer(),
				left: slot.x,
				top: slot.y,
			});
		} catch (error) {
			logger.error(`Error resizing slot ${slot.id}:`, error);
		}
	}

	return sharp({
		create: {
			width,
			height,
			channels: 3,
			background: { r: 255, g: 255, b: 255 },
		},
	})
		.composite(overlays)
		.png()
		.toBuffer();
}

/**
 * Render a mixup owned by `userId` into the device image format. Callers are
 * responsible for authorizing access to the mixup.
 */
export async function renderMixupImage({
	mixupId,
	userId,
	width,
	height,
	profile,
	cookies,
}: {
	mixupId: string;
	userId: string;
	width: number;
	height: number;
	profile: DeviceProfile;
	cookies?: string;
}): Promise<MixupRenderResult> {
	const [mixup, slots] = await withExplicitUserScope(userId, (scopedDb) =>
		Promise.all([
			scopedDb
				.selectFrom("mixups")
				.selectAll()
				.where("id", "=", mixupId)
				.executeTakeFirst(),
			scopedDb
				.selectFrom("mixup_slots")
				.leftJoin("recipes", "recipes.id", "mixup_slots.recipe_id")
				.select(["mixup_slots.slot_id", "recipes.slug as resolved_slug"])
				.where("mixup_slots.mixup_id", "=", mixupId)
				.orderBy("mixup_slots.order_index", "asc")
				.execute(),
		]),
	);

	if (!mixup) return { kind: "not-found" };

	const layout = getLayoutById(mixup.layout_id, width, height);
	if (!layout) return { kind: "invalid-layout", layoutId: mixup.layout_id };

	const assignments: Record<string, string | null> = {};
	for (const slot of slots) {
		assignments[slot.slot_id] = slot.resolved_slug ?? null;
	}

	const png = await compositeSlots(
		layout.slots,
		assignments,
		width,
		height,
		profile,
		userId,
		cookies,
	);
	return { kind: "ok", image: await renderDeviceImage({ png, profile }) };
}
