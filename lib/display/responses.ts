import { NextResponse } from "next/server";
import { DEVICE_SETUP_REFRESH_SECONDS } from "@/lib/device/defaults";

/**
 * JSON bodies for the TRMNL `/api/display` contract. Firmware reads the body's
 * `status`, not the HTTP code, so every answer is HTTP 200:
 *
 * - `status: 0` — show `image_url` (named `filename`) and sleep `refresh_rate`.
 * - `status: 202` — device not registered; firmware shows its friendly-ID screen.
 * - `status: 500` — **factory reset**: firmware erases its Wi-Fi settings and
 *   credentials and reboots into the setup portal. Never send it for a server
 *   error; this module has no way to produce it.
 * - any other status — firmware keeps the current screen and sleeps its
 *   previous interval. Used for transient failures.
 */

/**
 * Seconds the firmware waits for the image download (its default is 15).
 * Images render on demand, and a cold Liquid/browser render (10 s data
 * deadline plus page load) can take longer than that.
 */
export const IMAGE_URL_TIMEOUT_SECONDS = 30;

/** Status for "try again later": not 0 (show), 202 (unregistered) or 500 (reset). */
export const KEEP_SCREEN_STATUS = 503;

export function buildDisplayResponse(
	imageUrl: string,
	filename: string,
	refreshRate: number,
	extra: Record<string, unknown> = {},
) {
	return NextResponse.json(
		{
			status: 0,
			image_url: imageUrl,
			image_url_timeout: IMAGE_URL_TIMEOUT_SECONDS,
			filename,
			refresh_rate: refreshRate,
			reset_firmware: false,
			update_firmware: false,
			firmware_url: null,
			special_function: "restart_playlist",
			...extra,
		},
		{ status: 200 },
	);
}

/**
 * Shows the claim code. The name is derived from the code, so a device polling
 * while it waits to be claimed does not redownload and redraw the same screen.
 */
export function buildClaimResponse(claimCode: string, baseUrl: string) {
	const message = `Claim code: ${claimCode}`;
	return buildDisplayResponse(
		`${baseUrl}/error.png?message=${encodeURIComponent(message)}`,
		`claim-${claimCode.replace(/[^A-Za-z0-9]/g, "")}.png`,
		DEVICE_SETUP_REFRESH_SECONDS,
	);
}

/**
 * A problem the owner has to fix (e.g. the device cannot be identified):
 * replace the screen with an explanation and check again later.
 */
export function buildErrorScreenResponse(
	message: string,
	baseUrl: string,
	uniqueId: string,
	refreshRate = DEVICE_SETUP_REFRESH_SECONDS,
) {
	return buildDisplayResponse(
		`${baseUrl}/error.png?message=${encodeURIComponent(message)}`,
		`error-${uniqueId}.png`,
		refreshRate,
	);
}

/**
 * A transient failure (database unavailable, unexpected exception): keep the
 * current screen and retry on the device's normal schedule.
 */
export function buildKeepScreenResponse(
	message: string,
	status = KEEP_SCREEN_STATUS,
) {
	if (status === 0 || status === 202 || status === 500) {
		throw new Error(`Status ${status} cannot mean "keep the current screen"`);
	}
	return NextResponse.json(
		{ status, message, reset_firmware: false, update_firmware: false },
		{ status: 200 },
	);
}
