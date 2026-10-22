jest.mock("@/lib/database/utils", () => ({
	checkDbConnection: jest.fn(async () => ({ ready: true })),
}));
jest.mock("@/lib/device/lookup", () => ({
	findOrCreateDevice: jest.fn(async () => {
		throw new Error("connection terminated unexpectedly");
	}),
}));
jest.mock("@/lib/logger", () => ({ logError: jest.fn(), logInfo: jest.fn() }));
jest.mock("@/lib/auth/get-user", () => ({ getCurrentUserId: jest.fn() }));
jest.mock("@/lib/display/prerender", () => ({
	prerenderDisplayImage: jest.fn(),
}));
jest.mock("@/lib/display/visit", () => ({ recordDisplayVisit: jest.fn() }));
jest.mock("@/lib/display/select", () => ({
	selectDisplayForDevice: jest.fn(),
}));
jest.mock("@/lib/display/warmup", () => ({
	cancelWarmup: jest.fn(),
	scheduleWarmup: jest.fn(),
}));

import { findOrCreateDevice } from "@/lib/device/lookup";
import { prerenderDisplayImage } from "@/lib/display/prerender";
import { selectDisplayForDevice } from "@/lib/display/select";
import { recordDisplayVisit } from "@/lib/display/visit";
import { cancelWarmup, scheduleWarmup } from "@/lib/display/warmup";
import { DeviceDisplayMode } from "@/lib/mixup/constants";
import type { Device } from "@/lib/types";
import { GET } from "./route";

test("an unexpected error keeps the device's screen instead of resetting it", async () => {
	const response = await GET(
		new Request("http://byos.test/api/display", {
			headers: { "Access-Token": "token" },
		}),
	);
	const body = await response.json();
	expect(response.status).toBe(200);
	expect(body.status).not.toBe(500);
	expect(body).toMatchObject({ status: 503, reset_firmware: false });
});

test.each(
	Object.values(DeviceDisplayMode),
)("quiet hours in %s return a successful sleep instruction without rendering", async (mode) => {
	jest
		.mocked(findOrCreateDevice)
		.mockResolvedValue({ device: { id: 7, display_mode: mode } as Device });
	jest.mocked(recordDisplayVisit).mockResolvedValue({
		quietHours: true,
		refreshRate: 27000,
		playlistItem: null,
		playlistItems: [],
	});
	const response = await GET(
		new Request("http://byos.test/api/display", {
			headers: { "Access-Token": "token" },
		}),
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		status: 0,
		image_url: "",
		filename: "",
		refresh_rate: 27000,
		reset_firmware: false,
		update_firmware: false,
	});
	expect(selectDisplayForDevice).not.toHaveBeenCalled();
	expect(prerenderDisplayImage).not.toHaveBeenCalled();
	expect(scheduleWarmup).not.toHaveBeenCalled();
	expect(cancelWarmup).toHaveBeenCalledWith("7");
});
