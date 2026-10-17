import { getCurrentUserId } from "@/lib/auth/get-user";
import type { db } from "@/lib/database/db";
import { mapDeviceRow } from "@/lib/database/mappers";
import {
	withDeviceApiKey,
	withExplicitUserScope,
} from "@/lib/database/scoped-db";
import {
	DEFAULT_DEVICE_SCREEN,
	DEVICE_SLEEP_REFRESH_SECONDS,
} from "@/lib/device/defaults";
import { createOrRefreshPendingDeviceClaim } from "@/lib/device/pending-device-claims";
import { createProvisionedDevice } from "@/lib/device/provisioning";
import type { RequestHeaders } from "@/lib/device/request-headers";
import { logError, logInfo, logWarn } from "@/lib/logger";
import {
	type ModelStorageResolution,
	resolveModelForStorage,
} from "@/lib/trmnl/model-storage";
import type { Device } from "@/lib/types";
import {
	generateApiKey,
	generateFriendlyId,
	generateMockMacAddress,
} from "@/utils/helpers";

export type DeviceLookupResult = {
	device: Device | null;
	claimCode?: string;
};

type Conn = typeof db;

/**
 * The device row for an access token, through the narrow api-key RLS policy
 * (any owner, exactly one row). One scoped round trip; callers that need the
 * device should use this instead of resolving the owner and re-reading it.
 */
export async function findDeviceByApiKey(
	apiKey: string,
): Promise<Device | null> {
	const row = await withDeviceApiKey(apiKey, (scopedDb) =>
		scopedDb
			.selectFrom("devices")
			.selectAll()
			.where("api_key", "=", apiKey)
			.executeTakeFirst(),
	);
	return row ? mapDeviceRow(row) : null;
}

function timestampSeed(): string {
	return new Date().toISOString().replace(/[-:Z]/g, "");
}

function logUnknownReportedModel(
	modelResolution: ModelStorageResolution,
	deviceId: string,
): void {
	if (!modelResolution.reportedUnknown) return;

	logWarn("Device reported unknown TRMNL model; using stored/default model", {
		source: "api/display",
		metadata: {
			deviceId,
			reportedModel: modelResolution.reportedUnknown,
			resolvedModel: modelResolution.resolvedModelName,
			preservedExisting: modelResolution.preservedExisting,
			defaulted: modelResolution.defaulted,
		},
	});
}

/**
 * Changes needed to bring stored identity (MAC, API key, model) in line with
 * what the device reports, or null when nothing changed.
 */
async function identityPatch(
	device: Device,
	headers: RequestHeaders,
	options: { rotateApiKey: boolean },
): Promise<Partial<Device> | null> {
	const patch: Partial<Device> = {};
	const modelResolution = await resolveModelForStorage(
		headers.model,
		device.model,
	);
	logUnknownReportedModel(modelResolution, device.friendly_id);

	if (headers.macAddress && headers.macAddress !== device.mac_address) {
		patch.mac_address = headers.macAddress;
	}
	if (
		options.rotateApiKey &&
		headers.apiKey &&
		headers.apiKey !== device.api_key
	) {
		patch.api_key = headers.apiKey;
	}
	if (modelResolution.modelName && modelResolution.modelName !== device.model) {
		patch.model = modelResolution.modelName;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Best effort: a conflicting value (e.g. a MAC already used by another row) is
 * logged and must not stop the device from getting its screen.
 */
async function applyIdentityPatch(
	conn: Conn,
	device: Device,
	patch: Partial<Device>,
): Promise<Device> {
	const fields = Object.keys(patch);
	try {
		await conn
			.updateTable("devices")
			.set({ ...patch, updated_at: new Date().toISOString() })
			.where("id", "=", String(device.id))
			.execute();
	} catch (error) {
		logError("Could not update device identity from headers", {
			source: "api/display",
			metadata: { deviceId: device.friendly_id, fields, error },
		});
		return device;
	}
	logInfo("Updated device identity from headers", {
		source: "api/display",
		metadata: { deviceId: device.friendly_id, fields },
	});
	return { ...device, ...patch };
}

async function createDevice(
	conn: Conn,
	headers: RequestHeaders,
	ownerId: string,
): Promise<Device | null> {
	const { apiKey, macAddress } = headers;
	if (!apiKey) return null;

	// New device by explicit MAC
	if (macAddress) {
		const modelResolution = await resolveModelForStorage(headers.model);
		const friendlyId = generateFriendlyId(macAddress, timestampSeed());
		try {
			const created = await createProvisionedDevice(conn, {
				macAddress,
				name: `TRMNL Device ${friendlyId}`,
				friendlyId,
				apiKey,
				userId: ownerId,
				nextExpectedRefreshSeconds: headers.refreshRate
					? Number.parseInt(headers.refreshRate, 10)
					: DEVICE_SLEEP_REFRESH_SECONDS,
				screen: DEFAULT_DEVICE_SCREEN,
				model: modelResolution.modelName ?? null,
			});
			if (created) {
				logUnknownReportedModel(modelResolution, friendlyId);
				logInfo("Created new device with provided MAC address", {
					source: "api/display",
					metadata: { friendly_id: friendlyId },
				});
				return mapDeviceRow(created);
			}
		} catch (error) {
			logError("Error creating device with provided MAC", {
				source: "api/display",
				metadata: { error },
			});
		}
	}

	// No usable MAC: fall back to a placeholder derived from the API key.
	const mockMacAddress = generateMockMacAddress(apiKey);
	const existingMock = await conn
		.selectFrom("devices")
		.selectAll()
		.where("mac_address", "=", mockMacAddress)
		.executeTakeFirst();

	if (existingMock) {
		const device = mapDeviceRow(existingMock);
		if (macAddress) {
			await conn
				.updateTable("devices")
				.set({ mac_address: macAddress })
				.where("id", "=", String(device.id))
				.execute();
		}
		logInfo("Using existing mock device", {
			source: "api/display",
			metadata: { friendly_id: device.friendly_id },
		});
		return device;
	}

	const modelResolution = await resolveModelForStorage(headers.model);
	const friendlyId = generateFriendlyId(mockMacAddress, timestampSeed());
	try {
		const created = await createProvisionedDevice(conn, {
			macAddress: macAddress || mockMacAddress,
			name: `TRMNL Device ${friendlyId}`,
			friendlyId,
			apiKey: macAddress
				? apiKey
				: generateApiKey(mockMacAddress, timestampSeed()),
			userId: ownerId,
			nextExpectedRefreshSeconds: DEVICE_SLEEP_REFRESH_SECONDS,
			screen: DEFAULT_DEVICE_SCREEN,
			model: modelResolution.modelName ?? null,
		});
		if (created) {
			logUnknownReportedModel(modelResolution, friendlyId);
			logInfo(`Created new mock device: ${friendlyId}`, {
				source: "api/display",
				metadata: { friendly_id: friendlyId },
			});
			return mapDeviceRow(created);
		}
	} catch (error) {
		logError("Error creating mock device", {
			source: "api/display",
			metadata: { error },
		});
	}
	return null;
}

/**
 * Resolve the device behind a `/api/display` request, creating it when the
 * owner is known (mono-user mode or a session) and the device is new. Devices
 * without an owner get a claim code instead.
 *
 * Common case (known token): a single api-key-scoped read.
 */
export async function findOrCreateDevice(
	headers: RequestHeaders,
): Promise<DeviceLookupResult> {
	const { apiKey, macAddress } = headers;
	const byKey = apiKey ? await findDeviceByApiKey(apiKey) : null;
	const ownerId = byKey?.user_id ?? (await getCurrentUserId());

	if (!ownerId) {
		const claim = apiKey
			? await createOrRefreshPendingDeviceClaim({
					apiKey,
					macAddress,
					model: headers.model,
					width: headers.width,
					height: headers.height,
				})
			: null;
		logError("Refusing unauthenticated device lookup", {
			source: "api/display",
			metadata: {
				macAddress,
				hasApiKey: Boolean(apiKey),
				model: headers.model,
				claimReady: Boolean(claim),
			},
		});
		return { device: null, claimCode: claim?.claimCode };
	}

	// 1. The token identifies the device. Only touch the database again when the
	// reported identity changed.
	if (byKey) {
		const patch = await identityPatch(byKey, headers, { rotateApiKey: false });
		if (!patch) return { device: byKey };
		return {
			device: await withExplicitUserScope(ownerId, (scopedDb) =>
				applyIdentityPatch(scopedDb, byKey, patch),
			),
		};
	}

	return withExplicitUserScope(ownerId, async (scopedDb) => {
		// 2. Known MAC, new token: adopt the token only for the owner's own device.
		if (macAddress) {
			const row = await scopedDb
				.selectFrom("devices")
				.selectAll()
				.where("mac_address", "=", macAddress)
				.executeTakeFirst();
			if (row) {
				const device = mapDeviceRow(row);
				if (apiKey && apiKey !== device.api_key && device.user_id !== ownerId) {
					logError("Refusing to rotate device API key from MAC-only match", {
						source: "api/display",
						metadata: {
							deviceId: device.friendly_id,
							macAddress,
							hasApiKey: true,
						},
					});
					return { device: null };
				}
				const patch = await identityPatch(device, headers, {
					rotateApiKey: true,
				});
				return {
					device: patch
						? await applyIdentityPatch(scopedDb, device, patch)
						: device,
				};
			}
		}

		// 3. New device.
		return { device: await createDevice(scopedDb, headers, ownerId) };
	});
}
