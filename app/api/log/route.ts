import { NextResponse } from "next/server";
import { withExplicitUserScope } from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";
import { DEVICE_SETUP_REFRESH_SECONDS } from "@/lib/device/defaults";
import { isRecord, stringifyLogValue } from "@/lib/device/log-values";
import { findDeviceByApiKey } from "@/lib/device/lookup";
import { logError, logInfo } from "@/lib/logger";
import { ByteLimitError, readJsonBody } from "@/lib/network/response-bytes";

/**
 * POST /api/log — firmware uploads buffered log entries (`{ logs: [...] }`).
 *
 * Bodies are bounded: firmware sends a handful of entries, so anything large is
 * either a bug or abuse and must not be buffered or stored.
 */
export const MAX_LOG_BODY_BYTES = 256 * 1024;
export const MAX_LOG_ENTRIES = 200;

interface LogEntry {
	creation_timestamp: number;
	message?: string;
	level?: string;
	device_status?: string;
	battery_voltage?: number;
	rssi?: number;
	firmware_version?: string;
}

type NormalizedLogEntry = LogEntry & Record<string, unknown>;

function parseLogEntries(body: unknown): unknown[] | null {
	if (!isRecord(body) || !Array.isArray(body.logs)) {
		return null;
	}
	return body.logs;
}

function normalizeIncomingLog(log: unknown): NormalizedLogEntry {
	const now = Math.floor(Date.now() / 1000);

	if (!isRecord(log)) {
		return {
			creation_timestamp: now,
			message: stringifyLogValue(log),
			timestamp: new Date().toISOString(),
		};
	}

	const creationTimestamp =
		typeof log.creation_timestamp === "number" &&
		Number.isFinite(log.creation_timestamp)
			? log.creation_timestamp
			: now;
	const normalized: NormalizedLogEntry = {
		...log,
		creation_timestamp: creationTimestamp,
		timestamp: new Date(creationTimestamp * 1000).toISOString(),
	};

	if ("message" in normalized) {
		normalized.message = stringifyLogValue(normalized.message);
	}
	if ("log_message" in normalized) {
		normalized.log_message = stringifyLogValue(normalized.log_message);
	}
	if (!("message" in normalized) && !("log_message" in normalized)) {
		normalized.message = stringifyLogValue(log);
	}

	return normalized;
}

function parseRefreshRateHeader(refreshRate: string | null): number {
	const parsed = refreshRate ? Number.parseInt(refreshRate, 10) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEVICE_SETUP_REFRESH_SECONDS;
}

function finiteOr<T>(value: number, fallback: T): number | T {
	return Number.isFinite(value) ? value : fallback;
}

export async function GET() {
	return NextResponse.json(
		{
			status: 404,
			message: "Not found",
		},
		{ status: 404 },
	);
}

export async function POST(request: Request) {
	const macAddress = request.headers.get("ID")?.toUpperCase();
	const apiKey = request.headers.get("Access-Token");

	// TRMNL API requires Access-Token header
	if (!apiKey) {
		return NextResponse.json(
			{
				error: "Access-Token header is required",
			},
			{ status: 401 },
		);
	}

	let body: unknown;
	try {
		body = await readJsonBody(request, MAX_LOG_BODY_BYTES);
	} catch (error) {
		if (error instanceof ByteLimitError) {
			return NextResponse.json(
				{ error: `Log body exceeds ${MAX_LOG_BODY_BYTES} bytes` },
				{ status: 413 },
			);
		}
		return NextResponse.json(
			{ error: "Request body must be valid JSON" },
			{ status: 422 },
		);
	}

	const logsArray = parseLogEntries(body);
	if (!logsArray) {
		return NextResponse.json(
			{
				error: "Invalid request body. Expected { 'logs': [] }",
			},
			{ status: 422 },
		);
	}

	const refreshRate = request.headers.get("Refresh-Rate");
	const batteryVoltage = request.headers.get("Battery-Voltage");
	const fwVersion = request.headers.get("FW-Version");
	const rssi = request.headers.get("RSSI");

	try {
		const { ready } = await checkDbConnection();
		if (!ready) {
			console.warn("Database not available, skipping device log upload");
			return NextResponse.json(
				{
					status: 503,
					message: "Database not available",
				},
				{ status: 503 },
			);
		}

		const device = await findDeviceByApiKey(apiKey);
		if (!device?.user_id) {
			logError("Refusing logs for device without an owner", {
				source: "api/log",
				metadata: { macAddress, hasApiKey: true },
			});
			return NextResponse.json(
				{
					status: 400,
					message: "Device owner is required before logs can be accepted",
				},
				{ status: 400 },
			);
		}

		return await withExplicitUserScope(device.user_id, async (scopedDb) => {
			const update: Record<string, unknown> = {
				last_update_time: new Date().toISOString(),
				next_expected_update: new Date(
					Date.now() + parseRefreshRateHeader(refreshRate) * 1000,
				).toISOString(),
				battery_voltage: batteryVoltage
					? finiteOr(Number.parseFloat(batteryVoltage), device.battery_voltage)
					: device.battery_voltage,
				firmware_version: fwVersion || device.firmware_version,
				rssi: rssi
					? finiteOr(Number.parseInt(rssi, 10), device.rssi)
					: device.rssi,
				updated_at: new Date().toISOString(),
			};

			if (macAddress && macAddress !== device.mac_address) {
				const existingDeviceWithMac = await scopedDb
					.selectFrom("devices")
					.select(["id", "friendly_id"])
					.where("mac_address", "=", macAddress)
					.executeTakeFirst();

				if (
					existingDeviceWithMac &&
					String(existingDeviceWithMac.id) !== String(device.id)
				) {
					logError("Refusing logs with mismatched device identity", {
						source: "api/log",
						metadata: {
							token_device_id: device.friendly_id,
							mac_device_id: existingDeviceWithMac.friendly_id,
							mac_address: macAddress,
						},
					});
					return NextResponse.json(
						{
							status: 409,
							message:
								"Access token and MAC address refer to different devices",
						},
						{ status: 409 },
					);
				}
				update.mac_address = macAddress;
			}

			// Telemetry is best effort; the log upload itself is what must succeed.
			const writeMetrics = (values: Record<string, unknown>) =>
				scopedDb
					.updateTable("devices")
					.set(values)
					.where("id", "=", String(device.id))
					.execute();
			try {
				await writeMetrics(update);
			} catch (error) {
				logError("Error updating device metrics", {
					source: "api/log",
					metadata: { device_id: device.friendly_id, error },
				});
				// A MAC taken by a device this owner cannot see must not cost the
				// telemetry as well.
				if (update.mac_address) {
					const { mac_address: _mac, ...metrics } = update;
					await writeMetrics(metrics).catch(() => undefined);
				}
			}

			// Keep the newest entries if a device sends an oversized batch.
			const dropped = Math.max(0, logsArray.length - MAX_LOG_ENTRIES);
			const logData = {
				logs_array: logsArray.slice(dropped).map(normalizeIncomingLog),
				...(dropped > 0 ? { dropped_entries: dropped } : {}),
			};

			try {
				await scopedDb
					.insertInto("logs")
					.values({
						friendly_id: device.friendly_id,
						log_data: JSON.stringify(logData),
					})
					.execute();
			} catch (error) {
				logError("Error inserting device logs", {
					source: "api/log",
					metadata: { device_id: device.friendly_id, error },
				});
				return NextResponse.json(
					{
						status: 500,
						message: "Failed to save logs",
					},
					{ status: 500 },
				);
			}

			logInfo("Device logs saved", {
				source: "api/log",
				metadata: {
					device_id: device.friendly_id,
					logs_count: logsArray.length,
					dropped_entries: dropped,
					battery_voltage: batteryVoltage,
					fw_version: fwVersion,
					rssi,
				},
			});

			return new NextResponse(null, { status: 204 });
		});
	} catch (error) {
		logError(error instanceof Error ? error : new Error(String(error)), {
			source: "api/log",
		});
		return NextResponse.json(
			{
				status: 500,
				message: "Internal server error",
			},
			{ status: 500 },
		);
	}
}
