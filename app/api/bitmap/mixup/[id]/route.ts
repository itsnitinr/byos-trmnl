import type { NextRequest } from "next/server";
import { getCurrentUserId } from "@/lib/auth/get-user";
import {
	withDeviceApiKey,
	withExplicitUserScope,
} from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";
import { resolveDeviceProfileForRequest } from "@/lib/device/device-profile-request";
import { parseRequestHeaders } from "@/lib/device/request-headers";
import { renderMixupImage } from "@/lib/mixup/render";
import {
	DEFAULT_IMAGE_HEIGHT,
	DEFAULT_IMAGE_WIDTH,
} from "@/lib/recipes/constants";
import { logger } from "@/lib/recipes/logger";
import { ImageBudgetError } from "@/lib/render/device-image";
import { stripImageExtension } from "@/lib/render/device-image-url";
import { renderErrorImage } from "@/lib/render/error-image";
import { parseImageRequest } from "@/lib/render/image-request";
import { imageResponse } from "@/lib/render/image-response";
import type { DeviceProfile } from "@/lib/trmnl/device-profile";

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const headers = parseRequestHeaders(req);
	// Known once the request is parsed; lets failures answer at the right size.
	let errorFrame: { width?: number; height?: number; profile?: DeviceProfile } =
		{};
	try {
		const { id } = await params;
		const mixupId = stripImageExtension(id);

		const { searchParams } = new URL(req.url);
		const imageRequest = parseImageRequest(searchParams, {
			width: DEFAULT_IMAGE_WIDTH,
			height: DEFAULT_IMAGE_HEIGHT,
		});
		if (imageRequest instanceof Response) return imageRequest;
		const accessToken =
			searchParams.get("access_token") ?? req.headers.get("Access-Token");
		const profileHeaders = { ...headers, apiKey: accessToken };
		const width = imageRequest.width ?? DEFAULT_IMAGE_WIDTH;
		const height = imageRequest.height ?? DEFAULT_IMAGE_HEIGHT;
		errorFrame = { width, height };
		const cookieHeader = req.headers.get("cookie");

		const { ready } = await checkDbConnection();
		if (!ready) {
			logger.error("Database not available for mixup rendering");
			const image = await renderErrorImage({
				message: "Database not available",
				width,
				height,
			});
			return imageResponse(image, 503);
		}

		// Two auth paths:
		//  1. Device callback — `access_token` query param or `Access-Token` header
		//     matches a device whose `mixup_id` is this one.
		//  2. Browser/admin — signed-in user owns the mixup. Used by the UI
		//     (mixup-list, device-view, device-edit-form) which can't add an
		//     access_token to <img> srcs.
		let userId: string | null = null;

		if (accessToken) {
			const device = await withDeviceApiKey(accessToken, (scopedDb) =>
				scopedDb
					.selectFrom("devices")
					.select(["user_id", "mixup_id", "model", "palette_id"])
					.where("api_key", "=", accessToken)
					.executeTakeFirst(),
			);

			if (!device || device.mixup_id !== mixupId || !device.user_id) {
				return new Response("Mixup not found", { status: 404 });
			}
			userId = device.user_id;
		} else {
			const sessionUserId = await getCurrentUserId();
			if (!sessionUserId) {
				return new Response("Access token is required", { status: 401 });
			}
			const owned = await withExplicitUserScope(sessionUserId, (scopedDb) =>
				scopedDb
					.selectFrom("mixups")
					.select("id")
					.where("id", "=", mixupId)
					.executeTakeFirst(),
			);
			if (!owned) {
				return new Response("Mixup not found", { status: 404 });
			}
			userId = sessionUserId;
		}

		const profile = await resolveDeviceProfileForRequest(profileHeaders, {
			modelName: imageRequest.modelName,
			paletteId: imageRequest.paletteId,
		});
		errorFrame = { width, height, profile };

		const result = await renderMixupImage({
			mixupId,
			userId,
			width,
			height,
			profile,
			cookies: cookieHeader || undefined,
		});
		if (result.kind === "not-found") {
			logger.warn(`Mixup not found: ${mixupId}`);
			return new Response("Mixup not found", { status: 404 });
		}
		if (result.kind === "invalid-layout") {
			logger.warn(`Invalid layout for mixup ${mixupId}: ${result.layoutId}`);
			return new Response("Invalid layout", { status: 400 });
		}
		const { image } = result;

		return imageResponse(image, 200, req);
	} catch (error) {
		if (error instanceof ImageBudgetError)
			return Response.json({ error: error.message }, { status: 422 });
		logger.error("Error generating mixup image:", error);
		const image = await renderErrorImage({
			message:
				error instanceof Error ? error.message : "Error generating image",
			...errorFrame,
		});
		return imageResponse(image, 500);
	}
}
