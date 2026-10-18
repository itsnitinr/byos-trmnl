import {
	CONFIGURED_SPECIAL_FUNCTION,
	parseSpecialFunction,
} from "./special-function";

test("parses the firmware's special_function header", () => {
	expect(parseSpecialFunction("true")).toBe(CONFIGURED_SPECIAL_FUNCTION);
	expect(parseSpecialFunction("rewind")).toBe("rewind");
	expect(parseSpecialFunction(" Send_To_Me ")).toBe("send_to_me");
	for (const value of [null, "", "false", "none", "self_destruct"])
		expect(parseSpecialFunction(value)).toBeNull();
});
