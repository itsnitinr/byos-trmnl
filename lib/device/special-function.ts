/**
 * Device button "special functions". On a press, firmware sends
 * `special_function: true` (run the function the server assigned) or a
 * function name chosen on the device menu, and acts only when the response's
 * `action` names that function (usetrmnl/trmnl-firmware display_session.cpp).
 */

/** Names as in usetrmnl/trmnl-firmware special_function.cpp. */
export const SPECIAL_FUNCTIONS = [
	"identify",
	"sleep",
	"add_wifi",
	"restart_playlist",
	"rewind",
	"send_to_me",
	"guest_mode",
] as const;
export type SpecialFunction = (typeof SPECIAL_FUNCTIONS)[number];

/** The function the server assigns to the device button. */
export const CONFIGURED_SPECIAL_FUNCTION: SpecialFunction = "restart_playlist";

export function parseSpecialFunction(
	value: string | null,
): SpecialFunction | null {
	const normalized = value?.trim().toLowerCase();
	if (!normalized || normalized === "false" || normalized === "none") {
		return null;
	}
	if (normalized === "true") return CONFIGURED_SPECIAL_FUNCTION;
	return (SPECIAL_FUNCTIONS as readonly string[]).includes(normalized)
		? (normalized as SpecialFunction)
		: null;
}
