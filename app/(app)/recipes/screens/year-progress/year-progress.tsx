import { z } from "zod";
import { screenMetric } from "@/components/trmnl/screen-layout";
import {
	DEFAULT_IMAGE_HEIGHT,
	DEFAULT_IMAGE_WIDTH,
} from "@/lib/recipes/constants";
import type { RecipeDefinition } from "@/lib/recipes/types";
import {
	createScreenProfile,
	type ScreenProfile,
} from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";

const DAY_MS = 86_400_000;
const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Columns in the dot grid. 30 keeps a 365-day year at 13 readable rows. */
const COLUMNS = 30;

export const paramsSchema = z.object({
	timezone: z
		.string()
		.default(DEFAULT_TIMEZONE)
		.describe("IANA timezone the year boundaries are measured in")
		.meta({ title: "Timezone", placeholder: "Asia/Kolkata" }),
});

// No fetch: the screen is derived entirely from the clock, so the data it
// renders against is just the validated params.
export const dataSchema = paramsSchema;

function safeTimezone(value: string | undefined): string {
	const timezone = value?.trim() || DEFAULT_TIMEZONE;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
		return timezone;
	} catch {
		return DEFAULT_TIMEZONE;
	}
}

/** Calendar fields of `date` as read in `tz`. */
function tzParts(date: Date, tz: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(date);
	const byType = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return {
		year: Number(byType.year),
		month: Number(byType.month) - 1,
		day: Number(byType.day),
		hour: Number(byType.hour) % 24,
		minute: Number(byType.minute),
		second: Number(byType.second),
	};
}

/** How far `tz` sits from UTC, in ms, at the given instant. */
function offsetMs(date: Date, tz: string): number {
	const parts = tzParts(date, tz);
	const asUtc = Date.UTC(
		parts.year,
		parts.month,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which `tz` reads midnight on the given calendar day.
 * Resolved in two passes because the offset itself depends on the instant;
 * one correction settles every boundary except a midnight that DST skips,
 * which no timezone currently does on 1 January.
 */
function zonedMidnight(year: number, month: number, day: number, tz: string) {
	const guess = Date.UTC(year, month, day);
	const firstPass = offsetMs(new Date(guess), tz);
	const secondPass = offsetMs(new Date(guess - firstPass), tz);
	return new Date(guess - secondPass);
}

interface YearProgressProps {
	timezone?: string;
	width?: number;
	height?: number;
	screen?: ScreenProfile;
}

export default function YearProgress({
	timezone = DEFAULT_TIMEZONE,
	width = DEFAULT_IMAGE_WIDTH,
	height = DEFAULT_IMAGE_HEIGHT,
	screen,
}: YearProgressProps) {
	const screenProfile = screen ?? createScreenProfile({ width, height });
	const tz = safeTimezone(timezone);

	const now = new Date();
	const today = tzParts(now, tz);
	const year = today.year;

	const startOfYear = zonedMidnight(year, 0, 1, tz);
	const endOfYear = zonedMidnight(year + 1, 0, 1, tz);

	// Rounded rather than floored. Ordinary DST cancels out here, since both
	// endpoints are New Year's midnight and share an offset — but a zone that
	// permanently changes its standard offset mid-year leaves the span a few
	// hours short, and truncating would then drop a dot from the grid.
	const daysInYear = Math.round(
		(endOfYear.getTime() - startOfYear.getTime()) / DAY_MS,
	);

	// Counted from calendar dates so a DST shift cannot move the boundary — this
	// is 0 on 1 January and always matches the date the device is showing.
	const daysElapsed = Math.round(
		(Date.UTC(year, today.month, today.day) - Date.UTC(year, 0, 1)) / DAY_MS,
	);

	// Progress stays continuous (time-based, not day-based) so the figure still
	// advances over the course of a day.
	const progressPercentage =
		((now.getTime() - startOfYear.getTime()) /
			(endOfYear.getTime() - startOfYear.getTime())) *
		100;
	const formattedProgress = progressPercentage.toFixed(2);

	// Laid out as nested flex rows rather than CSS grid: the recipe renderers
	// implement flexbox only, so `display: grid` would collapse to a single
	// stack of 365 dots.
	const rows = Array.from(
		{ length: Math.ceil(daysInYear / COLUMNS) },
		(_, rowIndex) =>
			Array.from(
				{ length: Math.min(COLUMNS, daysInYear - rowIndex * COLUMNS) },
				(_, columnIndex) => rowIndex * COLUMNS + columnIndex,
			),
	);

	const dotSize = screenMetric(screenProfile, 12);
	const dotGap = screenMetric(screenProfile, 8);

	return (
		<PreSatori
			width={screenProfile.logicalWidth}
			height={screenProfile.logicalHeight}
		>
			<div className="flex h-full w-full flex-col bg-white p-8 font-inter">
				{/* Header */}
				<div className="flex items-center justify-between mb-6 pb-4">
					<div className="text-4xl lg:text-6xl text-black">{year}</div>
					<div className="text-3xl lg:text-5xl text-black">
						{formattedProgress}%
					</div>
				</div>

				{/* Dot grid */}
				<div className="flex-1 flex flex-col justify-center items-center">
					<div className="flex flex-col" style={{ gap: `${dotGap}px` }}>
						{rows.map((row) => (
							<div
								key={`row-${row[0]}`}
								className="flex flex-row"
								style={{ gap: `${dotGap}px` }}
							>
								{row.map((dayIndex) => (
									<div
										key={dayIndex}
										className={`rounded-full ${
											dayIndex < daysElapsed ? "bg-black" : "bg-gray-400"
										}`}
										style={{ width: `${dotSize}px`, height: `${dotSize}px` }}
									/>
								))}
							</div>
						))}
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-center mt-6 pt-4">
					<div className="text-2xl lg:text-4xl text-black">
						{daysElapsed} / {daysInYear}
					</div>
				</div>
			</div>
		</PreSatori>
	);
}

export const definition: RecipeDefinition<
	typeof paramsSchema,
	typeof dataSchema
> = {
	meta: {
		slug: "year-progress",
		title: "Year Progress",
		description:
			"How far through the year you are, as a percentage and a dot per day. Needs no API — the screen is derived from the clock in a configurable timezone.",
		published: true,
		tags: ["tailwind", "time", "progress", "configurable", "no-api"],
		author: { name: "Nitin Ranganath", github: "itsnitinr" },
		category: "display-components",
		version: "0.1.0",
		createdAt: "2026-09-02T00:00:00Z",
		updatedAt: "2026-09-02T00:00:00Z",
		renderSettings: {
			// Days still to come are a single mid-gray. Snapping to a 1-bit palette
			// would push them to white and erase the remainder of the year, so the
			// grays are dithered instead.
			paletteReduction: "floyd-steinberg",
		},
	},
	paramsSchema,
	dataSchema,
	Component: ({ width, height, screen, data }) => (
		<YearProgress
			timezone={data.timezone as string}
			width={width}
			height={height}
			screen={screen}
		/>
	),
};
