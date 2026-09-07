import { withExplicitUserScope } from "@/lib/database/scoped-db";
import type { RequestHeaders } from "@/lib/device/request-headers";
import type { Device } from "@/lib/types";
import { updateDeviceStatus } from "./utils";

jest.mock("@/lib/database/db", () => ({ db: {} }));
jest.mock("@/lib/database/scoped-db", () => ({
	withExplicitUserScope: jest.fn(),
}));
jest.mock("@/lib/database/utils", () => ({ checkDbConnection: jest.fn() }));
jest.mock("@/lib/auth/get-user", () => ({ getCurrentUserId: jest.fn() }));
jest.mock("@/lib/device/pending-device-claims", () => ({}));
jest.mock("@/lib/device/provisioning", () => ({}));
jest.mock("@/lib/device/request-headers", () => ({}));
jest.mock("@/lib/trmnl/model-storage", () => ({}));
jest.mock("@/lib/logger", () => ({ logError: jest.fn() }));

const device = {
	id: "device",
	user_id: "alice",
	timezone: "UTC",
} as unknown as Device;
const headers = {
	batteryVoltage: "3.9",
	rssi: "-60",
	supportsTemperatureProfile: true,
} as RequestHeaders;

test("playlist position and telemetry use one scoped write, including index zero", async () => {
	const set = jest.fn().mockReturnThis();
	const execute = jest.fn(async () => []);
	const query = { updateTable: () => query, set, where: () => query, execute };
	jest
		.mocked(withExplicitUserScope)
		.mockImplementation(async (_user, work) => work(query as never));
	await updateDeviceStatus(device, headers, 300, 0);
	expect(withExplicitUserScope).toHaveBeenCalledWith(
		"alice",
		expect.any(Function),
	);
	expect(execute).toHaveBeenCalledTimes(1);
	expect(set).toHaveBeenCalledWith(
		expect.objectContaining({
			current_playlist_index: 0,
			battery_voltage: 3.9,
			rssi: -60,
			last_refresh_duration: 300,
		}),
	);
});

test("playlist write failure is reported; telemetry-only failure remains best effort", async () => {
	jest
		.mocked(withExplicitUserScope)
		.mockRejectedValue(new Error("database unavailable"));
	await expect(updateDeviceStatus(device, headers, 300, 2)).rejects.toThrow(
		"database unavailable",
	);
	await expect(
		updateDeviceStatus(device, headers, 300),
	).resolves.toBeUndefined();
});
