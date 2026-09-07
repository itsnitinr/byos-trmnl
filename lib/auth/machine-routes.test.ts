import {
	createBrowserRenderContext,
	readBrowserRenderContext,
} from "../recipes/render/browser-context";
import { isMachineAuthenticatedRoute } from "./machine-routes";

test("only delegated machine routes bypass the session proxy", () => {
	for (const path of [
		"/recipes/weather/preview",
		"/api/plugin_settings/11111111-1111-4111-8111-111111111111/data",
	])
		expect(isMachineAuthenticatedRoute(path)).toBe(true);
	for (const path of [
		"/api/plugin_settings",
		"/api/plugin_settings/123/data",
		"/recipes/weather",
		"/recipes/weather/preview/extra",
		"/api/plugin_settings/not-a-uuid/data",
	])
		expect(isMachineAuthenticatedRoute(path)).toBe(false);
});

test("render tokens preserve tenant, expire, reject tampering and cannot cross recipes", () => {
	jest.useFakeTimers();
	const token = createBrowserRenderContext("alice", "weather");
	expect(readBrowserRenderContext(token, "weather")?.userId).toBe("alice");
	expect(readBrowserRenderContext(token, "calendar")).toBeNull();
	expect(
		readBrowserRenderContext(`e30.${token.split(".")[1]}`, "weather"),
	).toBeNull();
	jest.advanceTimersByTime(30_001);
	expect(readBrowserRenderContext(token, "weather")).toBeNull();
	jest.useRealTimers();
});
