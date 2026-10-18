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
jest.mock("@/lib/display/prerender", () => ({}));
jest.mock("@/lib/display/visit", () => ({}));
jest.mock("@/lib/display/select", () => ({}));

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
