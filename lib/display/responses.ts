import { NextResponse } from "next/server";
import { DEVICE_SETUP_REFRESH_SECONDS } from "@/lib/device/defaults";

/**
 * JSON bodies for the TRMNL `/api/display` contract. Errors still answer
 * HTTP 200 with an error image: firmware shows `image_url`, and a non-200
 * would leave the previous screen up with no explanation.
 */

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

export function buildClaimResponse(
	claimCode: string,
	baseUrl: string,
	uniqueId: string,
) {
	const message = `Claim code: ${claimCode}`;
	return buildDisplayResponse(
		`${baseUrl}/error.png?message=${encodeURIComponent(message)}`,
		`claim_${uniqueId}.png`,
		DEVICE_SETUP_REFRESH_SECONDS,
	);
}

export function buildErrorResponse(
	message: string,
	baseUrl: string,
	uniqueId: string,
	status = 500,
	options: { resetFirmware?: boolean } = {},
) {
	return NextResponse.json(
		{
			status,
			reset_firmware: options.resetFirmware ?? false,
			message,
			image_url: `${baseUrl}/error.png?message=${encodeURIComponent(message)}`,
			filename: `error_${uniqueId}.png`,
		},
		{ status: 200 },
	);
}
