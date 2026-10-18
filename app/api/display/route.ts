import { randomBytes } from "node:crypto";
import { getCurrentUserId } from "@/lib/auth/get-user";
import { afterResponse } from "@/lib/cache/after-response";
import { checkDbConnection } from "@/lib/database/utils";
import { findOrCreateDevice } from "@/lib/device/lookup";
import { parseRequestHeaders } from "@/lib/device/request-headers";
import {
	type DisplayImageTarget,
	prerenderDisplayImage,
} from "@/lib/display/prerender";
import {
	buildClaimResponse,
	buildDisplayResponse,
	buildErrorScreenResponse,
	buildKeepScreenResponse,
} from "@/lib/display/responses";
import { selectDisplayForDevice } from "@/lib/display/select";
import { recordDisplayVisit } from "@/lib/display/visit";
import {
	firmwareUpdatesEnabled,
	getLatestFirmware,
	isUpdateAvailable,
	peekLatestFirmware,
} from "@/lib/firmware";
import { logError, logInfo } from "@/lib/logger";
import { DeviceDisplayMode } from "@/lib/mixup/constants";
import {
	buildDeviceImageFilename,
	buildDeviceImageUrl,
} from "@/lib/render/device-image-url";
import type { Device } from "@/lib/types";

/**
 * GET /api/display — the device's wake-up call: which image to show next,
 * when to wake again, and whether to update firmware.
 *
 * Common path: one api-key-scoped device read, one user-scoped session for
 * the playlist read + status write, the image rendered inline so it can be
 * named by content (unchanged screens are neither downloaded nor redrawn),
 * and log rows flushed after the response.
 */

/** `DISPLAY_FORCE_REFRESH=true` restores per-request names: every wake redraws. */
function contentAddressedNames(): boolean {
	return process.env.DISPLAY_FORCE_REFRESH !== "true";
}

function errorImageQuery(baseQueryParams: string, message: string): string {
	const params = new URLSearchParams(baseQueryParams);
	params.set("message", message);
	return params.toString();
}

function firmwareFields(device: Device): Record<string, unknown> {
	if (!firmwareUpdatesEnabled()) return {};
	const latest = peekLatestFirmware();
	// Refresh the cached release after responding; never on the device's clock.
	afterResponse(async () => {
		await getLatestFirmware();
	});
	if (!latest || !isUpdateAvailable(device.firmware_version, latest.version)) {
		return {};
	}
	logInfo("Firmware update available", {
		source: "api/display",
		metadata: {
			deviceId: device.friendly_id,
			currentVersion: device.firmware_version,
			latestVersion: latest.version,
		},
	});
	return { update_firmware: true, firmware_url: latest.downloadUrl };
}

export async function GET(request: Request) {
	const headers = parseRequestHeaders(request);
	const baseUrl = `${headers.hostUrl}/api/bitmap`;
	// Fallback name when the image cannot be named by content.
	const uniqueId = randomBytes(5).toString("hex");

	if (!headers.apiKey) {
		return buildKeepScreenResponse("Access-Token header is required", 401);
	}

	const { ready } = await checkDbConnection();
	if (!ready) {
		logError("Database not available for display request", {
			source: "api/display",
		});
		return buildKeepScreenResponse("Database not available");
	}

	try {
		const lookup = await findOrCreateDevice(headers);
		const { device } = lookup;

		if (!device) {
			if (lookup.claimCode) {
				logInfo("Returning pending device claim code", {
					source: "api/display",
					metadata: {
						apiKey: headers.apiKey.slice(0, 6),
						macAddress: headers.macAddress,
					},
				});
				return buildClaimResponse(lookup.claimCode, baseUrl);
			}
			logError("Error fetching/creating device", {
				source: "api/display",
				metadata: { apiKey: headers.apiKey.slice(0, 6) },
			});
			return buildErrorScreenResponse(
				"This device could not be identified. Check it in the BYOS dashboard.",
				baseUrl,
				uniqueId,
			);
		}

		const selection = await selectDisplayForDevice(device, {
			hostUrl: headers.hostUrl,
			width: headers.width,
			height: headers.height,
		});
		const { playlistItem, refreshRate } = await recordDisplayVisit(
			device,
			headers,
		);

		const imageFor = (imagePath: string, query = selection.baseQueryParams) =>
			buildDeviceImageUrl({
				baseUrl,
				imagePath,
				profile: selection.profile,
				query,
			});
		const errorScreen = (message: string) => ({
			screen: "error",
			target: { kind: "error", message } as DisplayImageTarget,
			imageUrl: imageFor(
				"error",
				errorImageQuery(selection.baseQueryParams, message),
			),
		});

		let shown: {
			screen: string;
			target: DisplayImageTarget;
			imageUrl: string;
		} = {
			screen: selection.screen,
			target: { kind: "recipe", slug: selection.screen },
			imageUrl: selection.imageUrl,
		};
		if (device.display_mode === DeviceDisplayMode.PLAYLIST) {
			shown = playlistItem
				? {
						screen: playlistItem.screen_id,
						target: { kind: "recipe", slug: playlistItem.screen_id },
						imageUrl: imageFor(playlistItem.screen_id),
					}
				: errorScreen(
						device.playlist_id
							? "No active playlist item"
							: "Playlist mode needs a playlist",
					);
		} else if (
			device.display_mode === DeviceDisplayMode.MIXUP &&
			device.mixup_id
		) {
			shown = {
				screen: "mixup",
				target: { kind: "mixup", mixupId: device.mixup_id },
				// The mixup route authorizes by token; firmware only sends headers
				// to same-origin URLs, so the token also rides in the query.
				imageUrl: imageFor(
					`mixup/${device.mixup_id}`,
					`${selection.baseQueryParams}&access_token=${encodeURIComponent(headers.apiKey)}`,
				),
			};
		}

		let filename = buildDeviceImageFilename(
			shown.screen,
			uniqueId,
			selection.profile,
		);
		let renderOutcome = "on-demand";
		if (contentAddressedNames()) {
			const context = {
				profile: selection.profile,
				width: selection.width,
				height: selection.height,
				userId: device.user_id ?? (await getCurrentUserId()),
			};
			let outcome = await prerenderDisplayImage(shown.target, context);
			if (outcome.kind === "failed" && shown.target.kind !== "error") {
				// Nothing renderable (and no last good frame): explain on screen
				// instead of handing the device a URL that will fail to download.
				logError(`Could not render ${shown.screen}`, {
					source: "api/display",
					metadata: { deviceId: device.friendly_id, error: outcome.error },
				});
				shown = errorScreen(`Could not render ${shown.screen}`);
				outcome = await prerenderDisplayImage(shown.target, context);
			}
			renderOutcome = outcome.kind;
			if (outcome.kind === "ready") filename = outcome.filename;
		}

		logInfo("Display request successful", {
			source: "api/display",
			metadata: {
				deviceId: device.friendly_id,
				screen: shown.screen,
				filename,
				render: renderOutcome,
				refreshRate,
				displayMode: device.display_mode,
			},
		});

		const orientation = device.screen_orientation || "landscape";
		return buildDisplayResponse(shown.imageUrl, filename, refreshRate, {
			// 0 = portrait (no rotation), 1 = landscape (90° rotation).
			image_rotate: orientation === "landscape" ? 1 : 0,
			// Display tuning profile. Firmware reads this only when it sent
			// `temperature-profile: true` in the request.
			temperature_profile: device.temperature_profile ?? "default",
			...firmwareFields(device),
		});
	} catch (error) {
		logError(error instanceof Error ? error : new Error(String(error)), {
			source: "api/display",
			metadata: {
				apiKey: headers.apiKey.slice(0, 6),
				reportedModel: headers.model,
				uniqueId,
			},
		});
		// Never status 500: firmware would erase its Wi-Fi and credentials.
		return buildKeepScreenResponse("Internal server error");
	}
}
