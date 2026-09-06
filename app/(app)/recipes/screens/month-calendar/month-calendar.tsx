import { z } from "zod";
import {
	MIN_SCREEN_BODY_FONT_SIZE,
	ScreenCanvas,
	ScreenFooter,
	screenFontSize,
	screenMetric,
} from "@/components/trmnl/screen-layout";
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

const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Indexed by `Date#getUTCDay()`. */
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** Dimmed days are a mid-gray that the Floyd-Steinberg pass turns into texture. */
const DIM_COLOR = "#9ca3af";
/** Light enough that the footer dithers to a sparse pattern under black text. */
const FOOTER_BACKGROUND = "#e0e0e0";

export const paramsSchema = z.object({
	timezone: z
		.string()
		.default(DEFAULT_TIMEZONE)
		.describe("IANA timezone that decides which month and day are current")
		.meta({ title: "Timezone", placeholder: "Asia/Kolkata" }),
	weekStart: z
		.string()
		.default("sunday")
		.describe('First column of the grid: "sunday" or "monday"')
		.meta({ title: "Week starts on", placeholder: "sunday" }),
	dimWeekdays: z
		.string()
		.default("sun")
		.describe(
			'Weekdays drawn in gray instead of black, e.g. "sat,sun". Empty for none.',
		)
		.meta({ title: "Dimmed weekdays", placeholder: "sun" }),
	holidays: z
		.string()
		.default("")
		.describe(
			"Extra dates to dim, comma or newline separated. YYYY-MM-DD for one year, MM-DD to repeat annually.",
		)
		.meta({ title: "Holidays", placeholder: "2026-06-19, 12-25" }),
	label: z
		.string()
		.default("Calendar")
		.describe("Text shown on the left of the footer bar")
		.meta({ title: "Footer label", placeholder: "Calendar" }),
});

// No fetch: the whole screen is derived from the clock, so the data it renders
// against is just the validated params.
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

/** Calendar date of `date` as read in `tz`. */
function tzToday(date: Date, tz: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const byType = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return {
		year: Number(byType.year),
		month: Number(byType.month) - 1,
		day: Number(byType.day),
	};
}

function parseWeekStart(value: string | undefined): number {
	return value?.trim().toLowerCase().startsWith("mon") ? 1 : 0;
}

function parseDimWeekdays(value: string | undefined): Set<number> {
	const dimmed = new Set<number>();
	for (const token of (value ?? "").toLowerCase().split(/[\s,;]+/)) {
		if (!token) continue;
		const index = WEEKDAY_KEYS.indexOf(
			token.slice(0, 3) as (typeof WEEKDAY_KEYS)[number],
		);
		if (index >= 0) dimmed.add(index);
	}
	return dimmed;
}

/**
 * Holidays are kept as `MM-DD` strings, with the year-qualified ones prefixed.
 * A bare `MM-DD` entry repeats every year, so a list set up once keeps working.
 */
function parseHolidays(value: string | undefined): Set<string> {
	const holidays = new Set<string>();
	for (const token of (value ?? "").split(/[\s,;]+/)) {
		const trimmed = token.trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) holidays.add(trimmed);
		else if (/^\d{2}-\d{2}$/.test(trimmed)) holidays.add(trimmed);
	}
	return holidays;
}

function isHoliday(
	holidays: Set<string>,
	year: number,
	month: number,
	day: number,
): boolean {
	if (holidays.size === 0) return false;
	const monthDay = `${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	return holidays.has(monthDay) || holidays.has(`${year}-${monthDay}`);
}

type DayCell = {
	key: string;
	day: number | null;
	dimmed: boolean;
	today: boolean;
};

interface MonthCalendarProps {
	timezone?: string;
	weekStart?: string;
	dimWeekdays?: string;
	holidays?: string;
	label?: string;
	width?: number;
	height?: number;
	screen?: ScreenProfile;
}

export default function MonthCalendar({
	timezone = DEFAULT_TIMEZONE,
	weekStart = "sunday",
	dimWeekdays = "sun",
	holidays = "",
	label = "Calendar",
	width = DEFAULT_IMAGE_WIDTH,
	height = DEFAULT_IMAGE_HEIGHT,
	screen,
}: MonthCalendarProps) {
	const screenProfile = screen ?? createScreenProfile({ width, height });
	const tz = safeTimezone(timezone);
	const weekStartIndex = parseWeekStart(weekStart);
	const dimmedWeekdays = parseDimWeekdays(dimWeekdays);
	const holidayDates = parseHolidays(holidays);

	const now = new Date();
	const today = tzToday(now, tz);

	// Built in UTC so the grid is pure calendar arithmetic — the timezone has
	// already been applied when resolving which day "today" is.
	const firstWeekday = new Date(
		Date.UTC(today.year, today.month, 1),
	).getUTCDay();
	const daysInMonth = new Date(
		Date.UTC(today.year, today.month + 1, 0),
	).getUTCDate();
	const leadingBlanks = (firstWeekday - weekStartIndex + 7) % 7;
	const weekCount = Math.ceil((leadingBlanks + daysInMonth) / 7);

	const weeks: DayCell[][] = [];
	for (let weekIndex = 0; weekIndex < weekCount; weekIndex++) {
		const week: DayCell[] = [];
		for (let column = 0; column < 7; column++) {
			const day = weekIndex * 7 + column - leadingBlanks + 1;
			if (day < 1 || day > daysInMonth) {
				week.push({
					key: `blank-${weekIndex}-${column}`,
					day: null,
					dimmed: false,
					today: false,
				});
				continue;
			}
			const weekday = (weekStartIndex + column) % 7;
			week.push({
				key: `day-${day}`,
				day,
				dimmed:
					dimmedWeekdays.has(weekday) ||
					isHoliday(holidayDates, today.year, today.month, day),
				today: day === today.day,
			});
		}
		weeks.push(week);
	}

	const weekdayInitials = Array.from({ length: 7 }, (_, column) => {
		const weekday = (weekStartIndex + column) % 7;
		return { key: WEEKDAY_KEYS[weekday], initial: WEEKDAY_INITIALS[weekday] };
	});

	const monthLabel = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		month: "long",
		year: "numeric",
	}).format(now);

	const pad = screenMetric(screenProfile, screenProfile.isCompact ? 14 : 20);
	const gap = screenMetric(screenProfile, screenProfile.isCompact ? 8 : 12);
	const footerHeight = screenMetric(
		screenProfile,
		screenProfile.isCompact ? 32 : 40,
	);
	const weekdayFontSize = screenFontSize(
		screenProfile,
		screenProfile.isCompact ? 16 : 20,
		MIN_SCREEN_BODY_FONT_SIZE,
	);
	const headerHeight = Math.round(weekdayFontSize * 1.4);

	// Cells are sized from the space that is actually left — canvas padding, the
	// weekday row and the gap under it, the canvas gap above the footer, and the
	// footer itself — so a 6-week month tightens up instead of pushing the footer
	// off the bottom of the screen.
	const gridHeight =
		screenProfile.logicalHeight -
		pad * 2 -
		(headerHeight + gap) -
		gap -
		footerHeight;
	const columnWidth = Math.floor((screenProfile.logicalWidth - pad * 2) / 7);
	// A row never grows much taller than a column is wide, and a column never
	// grows much wider than a row is tall, so cells stay squarish on every
	// aspect ratio. Whatever height that leaves over becomes margin, because the
	// grid is centered in the canvas.
	const rowHeight = Math.min(
		Math.floor(gridHeight / weekCount),
		Math.round(columnWidth * 1.5),
	);
	const cellWidth = Math.min(columnWidth, Math.round(rowHeight * 1.25));
	const gridWidth = cellWidth * 7;

	const markerHeight = Math.min(
		Math.round(rowHeight * 0.92),
		Math.round(cellWidth * 0.86),
	);
	const markerWidth = Math.min(
		cellWidth - screenMetric(screenProfile, 6),
		Math.round(markerHeight * 1.2),
	);
	// Capped by width as well as height so two-digit days never touch the edges
	// of the highlight on narrow columns.
	const dayFontSize = Math.max(
		MIN_SCREEN_BODY_FONT_SIZE,
		Math.min(Math.round(markerHeight * 0.62), Math.round(markerWidth * 0.55)),
	);
	const iconSize = screenMetric(
		screenProfile,
		screenProfile.isCompact ? 16 : 20,
	);

	return (
		<PreSatori
			width={screenProfile.logicalWidth}
			height={screenProfile.logicalHeight}
		>
			<ScreenCanvas screen={screenProfile} style={{ padding: pad, gap }}>
				<div
					style={{
						display: "flex",
						flex: 1,
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					{/* Rows carry their own height, so the column is gapless and the one
					    deliberate space sits under the weekday initials. */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							flex: "none",
							width: gridWidth,
							height: headerHeight,
							marginBottom: gap,
						}}
					>
						{weekdayInitials.map(({ key, initial }) => (
							<div
								key={key}
								className="font-inter"
								style={{
									display: "flex",
									width: cellWidth,
									alignItems: "center",
									justifyContent: "center",
									fontFamily: "Inter, sans-serif",
									fontSize: weekdayFontSize,
									lineHeight: 1,
								}}
							>
								{initial}
							</div>
						))}
					</div>

					{weeks.map((week) => (
						<div
							key={week[0].key}
							style={{
								display: "flex",
								flexDirection: "row",
								flex: "none",
								width: gridWidth,
								height: rowHeight,
								alignItems: "center",
							}}
						>
							{week.map((cell) => (
								<div
									key={cell.key}
									style={{
										display: "flex",
										width: cellWidth,
										height: rowHeight,
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									<div
										className="font-inter"
										style={{
											display: "flex",
											width: markerWidth,
											height: markerHeight,
											alignItems: "center",
											justifyContent: "center",
											borderRadius: screenMetric(screenProfile, 18),
											backgroundColor: cell.today ? "#000" : "transparent",
											color: cell.today
												? "#fff"
												: cell.dimmed
													? DIM_COLOR
													: "#000",
											fontFamily: "Inter, sans-serif",
											fontSize: dayFontSize,
											lineHeight: 1,
										}}
									>
										{cell.day === null ? "" : String(cell.day)}
									</div>
								</div>
							))}
						</div>
					))}
				</div>

				<ScreenFooter
					screen={screenProfile}
					left={
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: screenMetric(screenProfile, 8),
							}}
						>
							<CalendarGlyph screen={screenProfile} size={iconSize} />
							<div style={{ display: "flex" }}>{label}</div>
						</div>
					}
					right={monthLabel}
					// The dimmed days need `paletteReduction: "floyd-steinberg"`, which
					// also turns the shared gray-500 footer into a 50% checkerboard —
					// white text on that is unreadable, so this screen inverts to black
					// text on a light bar instead.
					style={{
						height: footerHeight,
						backgroundColor: FOOTER_BACKGROUND,
						color: "#000",
					}}
				/>
			</ScreenCanvas>
		</PreSatori>
	);
}

/** A calendar mark drawn from boxes: SVG and icon fonts are renderer-dependent. */
function CalendarGlyph({
	screen,
	size,
}: {
	screen: ScreenProfile;
	size: number;
}) {
	const border = Math.max(2, screenMetric(screen, 2));
	const dot = Math.max(2, Math.round(size * 0.14));
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				flex: "none",
				width: size,
				height: size,
				borderWidth: border,
				borderStyle: "solid",
				borderColor: "#000",
				borderRadius: Math.max(2, Math.round(size * 0.18)),
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "flex",
					width: "100%",
					height: Math.max(3, Math.round(size * 0.24)),
					backgroundColor: "#000",
				}}
			/>
			<div
				style={{
					display: "flex",
					flex: 1,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "center",
					gap: dot,
				}}
			>
				<div
					style={{
						display: "flex",
						width: dot,
						height: dot,
						backgroundColor: "#000",
					}}
				/>
				<div
					style={{
						display: "flex",
						width: dot,
						height: dot,
						backgroundColor: "#000",
					}}
				/>
			</div>
		</div>
	);
}

export const definition: RecipeDefinition<
	typeof paramsSchema,
	typeof dataSchema
> = {
	meta: {
		slug: "month-calendar",
		title: "Month Calendar",
		description:
			"The current month as a full-screen grid, with today highlighted and weekends or holidays dimmed. Needs no API — the screen is derived from the clock in a configurable timezone.",
		published: true,
		tags: ["tailwind", "calendar", "time", "configurable", "no-api"],
		author: { name: "Nitin Ranganath", github: "itsnitinr" },
		category: "display-components",
		version: "0.1.0",
		createdAt: "2026-09-07T00:00:00Z",
		updatedAt: "2026-09-07T00:00:00Z",
		renderSettings: {
			// Dimmed days are a single mid-gray. Snapping to a 1-bit palette would
			// push them to white and erase them, so the grays are dithered instead.
			paletteReduction: "floyd-steinberg",
		},
	},
	paramsSchema,
	dataSchema,
	Component: ({ width, height, screen, data }) => (
		<MonthCalendar
			timezone={data.timezone as string}
			weekStart={data.weekStart as string}
			dimWeekdays={data.dimWeekdays as string}
			holidays={data.holidays as string}
			label={data.label as string}
			width={width}
			height={height}
			screen={screen}
		/>
	),
};
