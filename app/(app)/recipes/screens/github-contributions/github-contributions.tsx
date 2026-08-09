import { z } from "zod";
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
import getGitHubContributionsData, {
	type GitHubContributionsData,
} from "./getData";

export const paramsSchema = z.object({
	username: z
		.string()
		.default("octocat")
		.describe("GitHub username whose contribution calendar is shown")
		.meta({ title: "GitHub username", placeholder: "octocat" }),
});

const contributionDaySchema = z.object({
	date: z.string(),
	contributionCount: z.number(),
});

export const dataSchema = z.object({
	username: z.string().default("octocat"),
	totalContributions: z.number().default(0),
	currentStreak: z.number().default(0),
	longestStreak: z.number().default(0),
	mostInDay: z.number().default(0),
	averagePerDay: z.number().default(0),
	weeks: z
		.array(z.object({ contributionDays: z.array(contributionDaySchema) }))
		.default([]),
	lastUpdated: z.string().default("N/A"),
	message: z.string().optional(),
});

interface ContributionDay {
	date: string;
	contributionCount: number;
}

interface ContributionWeek {
	contributionDays: ContributionDay[];
}

interface GitHubContributionsProps {
	username?: string;
	totalContributions?: number;
	weeks?: ContributionWeek[];
	longestStreak?: number;
	currentStreak?: number;
	mostInDay?: number;
	averagePerDay?: number;
	width?: number;
	height?: number;
	screen?: ScreenProfile;
}

// Map contribution count to gray shade class
function getContributionLevel(count: number): string {
	if (count === 0) return "bg-gray-200";
	if (count <= 3) return "bg-gray-400";
	if (count <= 6) return "bg-gray-600";
	if (count <= 9) return "bg-gray-800";
	return "bg-black";
}

export default function GitHubContributions({
	username = "username",
	totalContributions = 0,
	weeks = [],
	longestStreak = 0,
	currentStreak = 0,
	mostInDay = 0,
	averagePerDay = 0,
	width = DEFAULT_IMAGE_WIDTH,
	height = DEFAULT_IMAGE_HEIGHT,
	screen,
}: GitHubContributionsProps) {
	const screenProfile = screen ?? createScreenProfile({ width, height });

	// Ensure we have exactly 52 weeks (or pad with empty weeks)
	const paddedWeeks: ContributionWeek[] = [...weeks];
	while (paddedWeeks.length < 52) {
		paddedWeeks.push({ contributionDays: [] });
	}

	// Take only the last 52 weeks
	const displayWeeks = paddedWeeks.slice(-52);

	// Ensure each week has 7 days
	const normalizedWeeks = displayWeeks.map((week) => {
		const days = [...week.contributionDays];
		while (days.length < 7) {
			days.push({ date: "", contributionCount: 0 });
		}
		return { contributionDays: days.slice(0, 7) };
	});

	// Transpose the data: 7 rows (days) x 52 columns (weeks)
	// Each row represents a day of the week (Sun, Mon, Tue, Wed, Thu, Fri, Sat)
	const transposedRows = Array.from({ length: 7 }, (_, dayIndex) =>
		normalizedWeeks.map((week) => week.contributionDays[dayIndex]),
	);

	return (
		<PreSatori
			width={screenProfile.logicalWidth}
			height={screenProfile.logicalHeight}
		>
			<div className="flex flex-col bg-white w-full h-full p-4 font-inter">
				{/* Top Section - Stats */}
				<div className="flex flex-row mb-5">
					{/* Left side - Large total contributions */}
					<div className="flex flex-col justify-center border-l-8 border-gray-400 pl-4 mr-10 min-w-[200px]">
						<div className="text-9xl font-inter">{totalContributions}</div>
						<div className="text-xl mt-2 font-inter">
							Contributions in last year
						</div>
					</div>

					{/* Right side - Stats grid */}
					<div className="flex flex-col flex-1 gap-3">
						{/* Row 1 */}
						<div className="flex flex-row gap-6">
							{/* Longest Streak */}
							<div className="flex flex-col border-l-8 border-gray-400 pl-3 flex-1">
								<div className="text-5xl leading-none font-inter">
									{longestStreak}
								</div>
								<div className="text-xl mt-1 font-inter">Longest streak</div>
							</div>

							{/* Current Streak */}
							<div className="flex flex-col border-l-8 border-gray-400 pl-3 flex-1">
								<div className="text-5xl leading-none font-inter">
									{currentStreak}
								</div>
								<div className="text-xl mt-1 font-inter">Current streak</div>
							</div>
						</div>

						{/* Row 2 */}
						<div className="flex flex-row gap-6">
							{/* Most in a day */}
							<div className="flex flex-col border-l-8 border-gray-400 pl-3 flex-1">
								<div className="text-5xl leading-none font-inter">
									{mostInDay}
								</div>
								<div className="text-xl mt-1 font-inter">Most in a day</div>
							</div>

							{/* Average per day */}
							<div className="flex flex-col border-l-8 border-gray-400 pl-3 flex-1">
								<div className="text-5xl leading-none font-inter">
									{averagePerDay.toFixed(2)}
								</div>
								<div className="text-xl mt-1 font-inter">Average per day</div>
							</div>
						</div>
					</div>
				</div>

				{/* Contribution Graph - 7 rows x 52 columns */}
				<div className="flex flex-1 flex-col justify-center gap-1">
					{transposedRows.map((row, rowIndex) => (
						<div key={`row-${rowIndex}`} className="flex flex-row gap-1">
							{row.map((day, colIndex) => (
								<div
									key={`cell-${rowIndex}-${colIndex}`}
									className={`w-3 h-6 ${getContributionLevel(day.contributionCount)}`}
								/>
							))}
						</div>
					))}
				</div>

				{/* Footer */}
				<div className="flex flex-row justify-between items-center mt-4 bg-gray-200 p-2 rounded-xl font-inter">
					<div className="flex flex-row items-center gap-2">
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="currentColor"
							xmlns="http://www.w3.org/2000/svg"
						>
							<title>GitHub</title>
							<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
						</svg>
						<span className="text-xl font-inter">GitHub Contributions</span>
					</div>
					<div className="text-xl font-inter">@{username}</div>
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
		slug: "github-contributions",
		title: "GitHub Contributions",
		description:
			"A year of GitHub contributions as a heatmap, with streak and per-day summary stats. Requires GITHUB_TOKEN.",
		published: true,
		tags: [
			"tailwind",
			"github",
			"api",
			"live-data",
			"configurable",
			"developer",
		],
		author: { name: "Nitin Ranganath", github: "itsnitinr" },
		category: "display-components",
		version: "0.1.0",
		createdAt: "2026-01-29T00:00:00Z",
		updatedAt: "2026-08-09T00:00:00Z",
		renderSettings: {
			// The heatmap's five levels are gray shades. Snapping the frame to a
			// 1-bit palette would flatten them to two, so this screen asks for the
			// grays to be dithered instead.
			paletteReduction: "floyd-steinberg",
		},
	},
	paramsSchema,
	dataSchema,
	getData: async (params) => {
		const data = await getGitHubContributionsData({
			username: params.username,
		});
		return data as z.infer<typeof dataSchema>;
	},
	Component: ({ width, height, screen, data }) => (
		<GitHubContributions
			{...(data as GitHubContributionsData)}
			width={width}
			height={height}
			screen={screen}
		/>
	),
};
