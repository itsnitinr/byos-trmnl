import { randomBytes } from "node:crypto";
import { afterResponse } from "@/lib/cache/after-response";
import { checkDbConnection } from "@/lib/database/utils";
import { findOrCreateDevice } from "@/lib/device/lookup";
import { parseRequestHeaders } from "@/lib/device/request-headers";
import {
	buildClaimResponse,
	buildDisplayResponse,
	buildErrorResponse,
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
 * the playlist read + status write, and log rows flushed after the response.
 */

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
	// Unique per response so firmware treats each image as new.
	const uniqueId = randomBytes(5).toString("hex");

	if (!headers.apiKey) {
		return buildErrorResponse(
			"Access-Token header is required",
			baseUrl,
			uniqueId,
			401,
		);
	}

	const { ready } = await checkDbConnection();
	if (!ready) {
		logError("Database not available for display request", {
			source: "api/display",
		});
		return buildErrorResponse("Database not available", baseUrl, uniqueId, 503);
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
				return buildClaimResponse(lookup.claimCode, baseUrl, uniqueId);
			}
			logError("Error fetching/creating device", {
				source: "api/display",
				metadata: { apiKey: headers.apiKey.slice(0, 6) },
			});
			return buildErrorResponse("Device not found", baseUrl, uniqueId);
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

		let screen = selection.screen;
		let imageUrl = selection.imageUrl;
		const imageFor = (imagePath: string, query = selection.baseQueryParams) =>
			buildDeviceImageUrl({
				baseUrl,
				imagePath,
				profile: selection.profile,
				query,
			});

		if (device.display_mode === DeviceDisplayMode.PLAYLIST) {
			if (playlistItem) {
				screen = playlistItem.screen_id;
				imageUrl = imageFor(screen);
			} else {
				screen = "error";
				imageUrl = imageFor(
					"error",
					errorImageQuery(
						selection.baseQueryParams,
						device.playlist_id
							? "No active playlist item"
							: "Playlist mode needs a playlist",
					),
				);
			}
		} else if (
			device.display_mode === DeviceDisplayMode.MIXUP &&
			device.mixup_id
		) {
			// Firmware fetches images without headers, so the token rides in the URL.
			imageUrl = imageFor(
				`mixup/${device.mixup_id}`,
				`${selection.baseQueryParams}&access_token=${encodeURIComponent(headers.apiKey)}`,
			);
		}

		logInfo("Display request successful", {
			source: "api/display",
			metadata: {
				deviceId: device.friendly_id,
				screen,
				refreshRate,
				displayMode: device.display_mode,
			},
		});

		const orientation = device.screen_orientation || "landscape";
		return buildDisplayResponse(
			imageUrl,
			buildDeviceImageFilename(screen, uniqueId, selection.profile),
			refreshRate,
			{
				// 0 = portrait (no rotation), 1 = landscape (90° rotation).
				image_rotate: orientation === "landscape" ? 1 : 0,
				// Display tuning profile. Firmware reads this only when it sent
				// `temperature-profile: true` in the request.
				temperature_profile: device.temperature_profile ?? "default",
				...firmwareFields(device),
			},
		);
	} catch (error) {
		logError(error instanceof Error ? error : new Error(String(error)), {
			source: "api/display",
			metadata: {
				apiKey: headers.apiKey.slice(0, 6),
				reportedModel: headers.model,
				uniqueId,
			},
		});
		return buildErrorResponse("Internal server error", baseUrl, uniqueId);
	}
}
