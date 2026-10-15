import { z } from "zod";
import { paramsSchema } from "@/app/(app)/recipes/screens/generative-print/generative-print";
import { zodObjectToParamDefinitions } from "./zod-form";

// Parameter extraction does not need the recipe's rendering wrapper or Next fonts.
jest.mock("@/utils/pre-satori", () => ({ PreSatori: () => null }));

test("the print style is an editable dropdown with its default and description", () => {
	const fields = zodObjectToParamDefinitions(paramsSchema);
	expect(Object.keys(fields)).toEqual(["timezone", "date", "style", "seed"]);
	expect(fields.style).toEqual({
		label: "Print style",
		type: "string",
		default: "daily",
		description: "Rotate styles each day, or choose a single style",
		options: ["daily", "contours", "orbits", "tiles"],
	});
});

test("wrapped string enums retain choices without changing primitive fields", () => {
	const fields = zodObjectToParamDefinitions(
		z.object({
			choice: z.enum(["", "one", "two"]).optional().default("one").readonly(),
			message: z.string().default("hello"),
			count: z.number().default(3),
			enabled: z.boolean().default(false),
			complex: z.object({ nested: z.string() }),
			numericEnum: z.enum({ One: 1, Two: 2 }),
		}),
	);
	expect(fields.choice.options).toEqual(["", "one", "two"]);
	expect(fields.choice.default).toBe("one");
	expect(fields.message).toEqual({
		label: "Message",
		type: "string",
		default: "hello",
	});
	expect(fields.count).toEqual({ label: "Count", type: "number", default: 3 });
	expect(fields.enabled).toEqual({
		label: "Enabled",
		type: "boolean",
		default: false,
	});
	expect(fields.complex).toBeUndefined();
	expect(fields.numericEnum).toBeUndefined();
});
