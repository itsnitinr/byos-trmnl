import {
	buildClaimResponse,
	buildKeepScreenResponse,
	KEEP_SCREEN_STATUS,
} from "./responses";

test("transient failures keep the screen and can never reset the device", async () => {
	const response = buildKeepScreenResponse("Database not available");
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		status: KEEP_SCREEN_STATUS,
		reset_firmware: false,
	});
	// 0 = show image, 202 = unregistered, 500 = firmware factory reset.
	for (const status of [0, 202, 500])
		expect(() => buildKeepScreenResponse("x", status)).toThrow();
});

test("claim screens are named by their code so polling does not redraw them", async () => {
	const body = await buildClaimResponse(
		"6ZG4-82Q8",
		"http://byos/api/bitmap",
	).json();
	expect(body).toMatchObject({ status: 0, filename: "claim-6ZG482Q8.png" });
});
