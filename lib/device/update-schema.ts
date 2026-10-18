import { z } from "zod";
import { DeviceDisplayMode } from "@/lib/mixup/constants";
import { MAX_IMAGE_DIMENSION } from "@/lib/render/image-request";

/**
 * Server-side validation for device edits. Server actions are public
 * endpoints, so the client form's checks are a convenience, not a guarantee.
 * Shapes are normalized here (empty selections become NULL, numeric strings
 * become numbers) so what reaches the database is what the runtime expects.
 */

export function isValidTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

const clockTime = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM (24-hour)");

const refreshSeconds = z.coerce
	.number()
	.int("Refresh rate must be a whole number of seconds")
	.min(1, "Refresh rate must be at least 1 second")
	.max(86_400, "Refresh rate must be at most 86400 seconds (one day)");

export const refreshScheduleSchema = z.object({
	default_refresh_rate: refreshSeconds,
	time_ranges: z
		.array(
			z.object({
				start_time: clockTime,
				end_time: clockTime,
				refresh_rate: refreshSeconds,
			}),
		)
		.max(48)
		.default([]),
});

/** "" and undefined-like selections ("None" in a select) mean no value. */
const emptyToNull = (value: unknown) =>
	typeof value === "string" && value.trim() === "" ? null : value;

const optionalId = z.preprocess(emptyToNull, z.uuid().nullable()).optional();
const optionalText = (max: number) =>
	z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();
const dimension = z
	.preprocess(
		emptyToNull,
		z.coerce.number().int().min(1).max(MAX_IMAGE_DIMENSION).nullable(),
	)
	.optional();

export const deviceUpdateSchema = z.object({
	id: z.coerce.number().int().positive(),
	name: z.string().trim().min(1, "Name is required").max(100).optional(),
	mac_address: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.transform((value) => value.toUpperCase())
		.optional(),
	api_key: z
		.string()
		.trim()
		.min(8, "API key must be at least 8 characters")
		.max(128)
		.regex(/^\S+$/, "API key cannot contain spaces")
		.optional(),
	friendly_id: z
		.string()
		.trim()
		.min(1)
		.max(32)
		.regex(/^[A-Za-z0-9_-]+$/, "Friendly ID may only use letters and digits")
		.optional(),
	timezone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
	refresh_schedule: refreshScheduleSchema.nullable().optional(),
	screen: optionalText(200),
	playlist_id: optionalId,
	mixup_id: optionalId,
	display_mode: z.enum(DeviceDisplayMode).optional(),
	screen_width: dimension,
	screen_height: dimension,
	screen_orientation: z
		.preprocess(emptyToNull, z.enum(["landscape", "portrait"]).nullable())
		.optional(),
	model: optionalText(100),
	palette_id: optionalText(100),
	temperature_profile: z.enum(["default", "a", "b", "c"]).optional(),
});

export type DeviceUpdate = z.infer<typeof deviceUpdateSchema>;

/** First validation message, prefixed with the field, for a toast. */
export function describeValidationError(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) return "Invalid input";
	const field = issue.path.join(".");
	return field ? `${field}: ${issue.message}` : issue.message;
}
