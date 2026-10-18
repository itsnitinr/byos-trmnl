import { withDeviceApiKey } from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";
import {
	parseSpecialFunction,
	type SpecialFunction,
} from "@/lib/device/special-function";

export interface RequestHeaders {
	apiKey: string | null;
	macAddress: string | null;
	refreshRate: string | null;
	batteryVoltage: string | null;
	fwVersion: string | null;
	rssi: string | null;
	width: number | null;
	height: number | null;
	model: string | null;
	/**
	 * Button press: the special function the device is running, or null.
	 * Firmware sends `special_function: true` for the function the server
	 * configured, or the function's name when picked from the device menu.
	 */
	specialFunction: SpecialFunction | null;
	supportsTemperatureProfile: boolean;
	hostUrl: string;
}

export function parseRequestHeaders(request: Request): RequestHeaders {
	const headers = request.headers;
	const widthStr = headers.get("Width");
	const heightStr = headers.get("Height");

	return {
		apiKey: headers.get("Access-Token"),
		macAddress: headers.get("ID")?.toUpperCase() || null,
		refreshRate: headers.get("Refresh-Rate"),
		batteryVoltage: headers.get("Battery-Voltage"),
		fwVersion: headers.get("FW-Version"),
		rssi: headers.get("RSSI"),
		width: widthStr ? Number.parseInt(widthStr, 10) : null,
		height: heightStr ? Number.parseInt(heightStr, 10) : null,
		model: headers.get("Model")?.trim() || null,
		specialFunction: parseSpecialFunction(
			headers.get("special_function") ?? headers.get("Special-Function"),
		),
		supportsTemperatureProfile: headers.get("temperature-profile") === "true",
		hostUrl:
			(headers.get("x-forwarded-proto") || "http") +
			"://" +
			(headers.get("x-forwarded-host") || headers.get("host") || "localhost"),
	};
}

export async function resolveUserIdFromApiKey(
	apiKey: string | null,
	options: { assumeDbReady?: boolean } = {},
): Promise<string | null> {
	if (!apiKey) return null;

	if (!options.assumeDbReady) {
		const { ready } = await checkDbConnection();
		if (!ready) return null;
	}

	const device = await withDeviceApiKey(apiKey, (scopedDb) =>
		scopedDb
			.selectFrom("devices")
			.select("user_id")
			.where("api_key", "=", apiKey)
			.executeTakeFirst(),
	);

	return device?.user_id ?? null;
}
