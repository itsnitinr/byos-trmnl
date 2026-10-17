import { connection, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/get-user";
import type { db } from "@/lib/database/db";
import { withExplicitUserScope } from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";
import {
	DEFAULT_DEVICE_SCREEN,
	DEVICE_SLEEP_REFRESH_SECONDS,
} from "@/lib/device/defaults";
import { findDeviceByApiKey } from "@/lib/device/lookup";
import { createProvisionedDevice } from "@/lib/device/provisioning";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { resolveModelForStorage } from "@/lib/trmnl/model-storage";
import { generateApiKey, generateFriendlyId } from "@/utils/helpers";

/**
 * GET /api/setup — first-boot registration. Returns the device's API key and
 * friendly ID for its MAC (`ID` header), creating the device when the owner
 * is known: from the `Access-Token` of an existing device, a session, or the
 * single-user account.
 */

type Conn = typeof db;

function setupResponse(
	status: number,
	body: {
		api_key?: string | null;
		friendly_id?: string | null;
		message: string;
	},
) {
	return NextResponse.json(
		{
			status,
			api_key: body.api_key ?? null,
			friendly_id: body.friendly_id ?? null,
			image_url: null,
			...(status === 200 ? { filename: null } : {}),
			message: body.message,
		},
		{ status },
	);
}

function timestampSeed(): string {
	return new Date().toISOString().replace(/[-:Z]/g, "");
}

async function createDevice(
	conn: Conn,
	ownerId: string,
	macAddress: string,
	apiKey: string | null,
	model: string,
) {
	const friendlyId = generateFriendlyId(macAddress, timestampSeed());
	const deviceApiKey = apiKey || generateApiKey(macAddress, timestampSeed());
	const modelResolution = await resolveModelForStorage(model);
	try {
		const created = await createProvisionedDevice(conn, {
			macAddress,
			name: `TRMNL Device ${friendlyId}`,
			friendlyId,
			apiKey: deviceApiKey,
			userId: ownerId,
			nextExpectedRefreshSeconds: DEVICE_SLEEP_REFRESH_SECONDS,
			screen: DEFAULT_DEVICE_SCREEN,
			model: modelResolution.modelName ?? null,
		});
		if (!created) throw new Error("Failed to create new device record");

		logInfo(`New device ${created.friendly_id} created!`, {
			source: "api/setup",
			metadata: { friendly_id: created.friendly_id, mac_address: macAddress },
		});
		if (modelResolution.reportedUnknown) {
			logWarn(
				"Device setup reported unknown TRMNL model; using default model",
				{
					source: "api/setup",
					metadata: {
						friendly_id: created.friendly_id,
						reportedModel: modelResolution.reportedUnknown,
						resolvedModel: modelResolution.resolvedModelName,
						defaulted: modelResolution.defaulted,
					},
				},
			);
		}
		return setupResponse(200, {
			api_key: created.api_key,
			friendly_id: created.friendly_id,
			message: `Device ${created.friendly_id} added to BYOS!`,
		});
	} catch (error) {
		logError("Error creating device", {
			source: "api/setup",
			metadata: { macAddress, friendly_id: friendlyId, error },
		});
		return NextResponse.json(
			{
				status: 500,
				reset_firmware: false,
				message: `Error creating new device. ${friendlyId}`,
			},
			{ status: 500 },
		);
	}
}

async function setupForOwner(
	conn: Conn,
	ownerId: string,
	macAddress: string,
	apiKey: string | null,
	model: string,
) {
	const device = await conn
		.selectFrom("devices")
		.selectAll()
		.where("mac_address", "=", macAddress)
		.executeTakeFirst();

	if (!device) {
		// New MAC, known token: the device was re-flashed or moved boards.
		if (apiKey) {
			const byKey = await conn
				.selectFrom("devices")
				.selectAll()
				.where("api_key", "=", apiKey)
				.executeTakeFirst();
			if (byKey) {
				try {
					await conn
						.updateTable("devices")
						.set({
							mac_address: macAddress,
							updated_at: new Date().toISOString(),
						})
						.where("id", "=", byKey.id)
						.execute();
					logInfo("Updated device MAC address", {
						source: "api/setup",
						metadata: { device_id: byKey.friendly_id, mac_address: macAddress },
					});
					return setupResponse(200, {
						api_key: byKey.api_key,
						friendly_id: byKey.friendly_id,
						message: `Device ${byKey.friendly_id} updated with new MAC address!`,
					});
				} catch (error) {
					// Fall through and register a new device for this MAC.
					logError("Error updating MAC address for device", {
						source: "api/setup",
						metadata: {
							device_id: byKey.friendly_id,
							mac_address: macAddress,
							error,
						},
					});
				}
			}
		}
		return createDevice(conn, ownerId, macAddress, apiKey, model);
	}

	// Known MAC: only its owner, or a caller holding its token, may set it up.
	const canManage = apiKey === device.api_key || device.user_id === ownerId;
	if (!canManage) {
		logError("Refusing setup for device without owner or valid access token", {
			source: "api/setup",
			metadata: {
				friendly_id: device.friendly_id,
				mac_address: macAddress,
				hasApiKey: Boolean(apiKey),
			},
		});
		return setupResponse(403, {
			message: "Device setup requires a valid access token or owner session",
		});
	}

	let currentApiKey = device.api_key;
	if (apiKey && apiKey !== device.api_key) {
		try {
			await conn
				.updateTable("devices")
				.set({ api_key: apiKey, updated_at: new Date().toISOString() })
				.where("id", "=", device.id)
				.execute();
			currentApiKey = apiKey;
			logInfo("Updated API key for device", {
				source: "api/setup",
				metadata: { device_id: device.friendly_id, mac_address: macAddress },
			});
		} catch (error) {
			logError("Error updating API key for device", {
				source: "api/setup",
				metadata: {
					device_id: device.friendly_id,
					mac_address: macAddress,
					error,
				},
			});
		}
	}

	logInfo(`Device ${device.friendly_id} set up`, {
		source: "api/setup",
		metadata: { friendly_id: device.friendly_id, mac_address: macAddress },
	});
	return setupResponse(200, {
		api_key: currentApiKey,
		friendly_id: device.friendly_id,
		message: `Device ${device.friendly_id} added to BYOS!`,
	});
}

export async function GET(request: Request) {
	// Tell the cache-components prerender the route is request-scoped so it
	// doesn't try to evaluate the body at build time and bail on header reads.
	await connection();
	try {
		const macAddress = request.headers.get("ID")?.toUpperCase();
		const apiKey = request.headers.get("Access-Token");
		const model = request.headers.get("Model");
		const { ready } = await checkDbConnection();

		if (!ready) {
			console.warn("Database not available, skipping device setup");
			return NextResponse.json(
				{
					status: 503,
					message: "Device setup skipped",
				},
				{ status: 503 },
			);
		}

		if (!macAddress) {
			logError("Device setup without ID header", {
				source: "api/setup",
				metadata: { hasApiKey: Boolean(apiKey), model: model || null },
			});
			return setupResponse(400, { message: "ID header is required" });
		}

		// TRMNL API requires Model header
		if (!model) {
			return setupResponse(400, { message: "Model header is required" });
		}

		const ownerId =
			(apiKey ? (await findDeviceByApiKey(apiKey))?.user_id : null) ??
			(await getCurrentUserId());
		if (!ownerId) {
			logError("Refusing to set up an unowned device", {
				source: "api/setup",
				metadata: { macAddress, hasApiKey: Boolean(apiKey), model },
			});
			return setupResponse(403, {
				message: "Device setup requires an authenticated owner",
			});
		}

		return await withExplicitUserScope(ownerId, (conn) =>
			setupForOwner(conn, ownerId, macAddress, apiKey, model),
		);
	} catch (error) {
		logError(error instanceof Error ? error : new Error(String(error)), {
			source: "api/setup",
		});
		return NextResponse.json(
			{
				status: 500,
				error: "Internal server error",
			},
			{ status: 500 },
		);
	}
}
