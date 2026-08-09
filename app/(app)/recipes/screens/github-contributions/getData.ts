import { unstable_cache } from "next/cache";

// Live data — always fetch fresh.
export const dynamic = "force-dynamic";

type GitHubContributionsParams = {
	username?: string;
};

export type ContributionDay = {
	/** ISO date, or "" for a padding slot outside the calendar range. */
	date: string;
	contributionCount: number;
};

export type ContributionWeek = {
	contributionDays: ContributionDay[];
};

export type GitHubContributionsData = {
	username: string;
	totalContributions: number;
	currentStreak: number;
	longestStreak: number;
	mostInDay: number;
	averagePerDay: number;
	weeks: ContributionWeek[];
	lastUpdated: string;
	message?: string;
};

interface GitHubGraphQLResponse {
	data?: {
		user?: {
			login: string;
			contributionsCollection: {
				contributionCalendar: {
					totalContributions: number;
					weeks: Array<{
						firstDay: string;
						contributionDays: Array<{
							date: string;
							contributionCount: number;
							weekday: number;
						}>;
					}>;
				};
			};
		};
	};
	errors?: Array<{ message: string }>;
}

const GITHUB_CONTRIBUTIONS_QUERY = `
query ($username: String!) {
  user(login: $username) {
    login
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          firstDay
          contributionDays {
            date
            contributionCount
            weekday
          }
        }
      }
    }
  }
}
`;

const DEFAULT_USERNAME = "octocat";
const EMPTY_DAY: ContributionDay = { date: "", contributionCount: 0 };

function formatUpdatedLabel(date: Date): string {
	return date.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/**
 * GitHub returns week-aligned columns, but the first and last week are partial.
 * Place each day in its weekday row (0 = Sunday) so the 7×N grid never shears.
 */
function normalizeWeeks(
	weeks: Array<{
		contributionDays: Array<{
			date: string;
			contributionCount: number;
			weekday: number;
		}>;
	}>,
): ContributionWeek[] {
	return weeks.map((week) => {
		const days: ContributionDay[] = Array.from({ length: 7 }, () => ({
			...EMPTY_DAY,
		}));
		for (const day of week.contributionDays) {
			const weekday =
				Number.isInteger(day.weekday) && day.weekday >= 0 && day.weekday <= 6
					? day.weekday
					: new Date(day.date).getUTCDay();
			days[weekday] = {
				date: day.date,
				contributionCount: day.contributionCount,
			};
		}
		return { contributionDays: days };
	});
}

function dayNumber(isoDate: string): number {
	// Whole days since epoch, computed in UTC so DST never shifts a column.
	return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
}

/**
 * Longest run of consecutive calendar days with at least one contribution, and
 * the run ending today (or yesterday — a day with no commits yet does not
 * break the streak until it is over).
 */
function calculateStreaks(days: Array<{ date: string; count: number }>): {
	currentStreak: number;
	longestStreak: number;
} {
	const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

	let longestStreak = 0;
	let run = 0;
	let previousDay: number | null = null;

	for (const day of sorted) {
		const current = dayNumber(day.date);
		if (day.count > 0) {
			run = previousDay !== null && current - previousDay === 1 ? run + 1 : 1;
			longestStreak = Math.max(longestStreak, run);
			previousDay = current;
		} else {
			run = 0;
			previousDay = current;
		}
	}

	// Current streak: walk backwards from the newest day. Today counts as a
	// grace day when it has no contributions yet.
	let currentStreak = 0;
	let expected: number | null = null;
	for (let index = sorted.length - 1; index >= 0; index--) {
		const day = sorted[index];
		const current = dayNumber(day.date);
		if (expected !== null && current !== expected) break;
		if (day.count > 0) {
			currentStreak++;
		} else if (index !== sorted.length - 1) {
			break;
		}
		expected = current - 1;
	}

	return { currentStreak, longestStreak };
}

async function fetchContributions(
	username: string,
): Promise<GitHubContributionsData> {
	const token = process.env.GITHUB_TOKEN;
	if (!token) {
		throw new Error("MISSING_TOKEN");
	}

	const response = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json",
			"User-Agent": "byos-trmnl",
		},
		body: JSON.stringify({
			query: GITHUB_CONTRIBUTIONS_QUERY,
			variables: { username },
		}),
		next: { revalidate: 0 },
	});

	if (!response.ok) {
		if (response.status === 401) throw new Error("BAD_TOKEN");
		if (response.status === 403 || response.status === 429) {
			throw new Error("RATE_LIMITED");
		}
		throw new Error(`GitHub API responded with status: ${response.status}`);
	}

	const result: GitHubGraphQLResponse = await response.json();

	if (result.errors?.length) {
		const message = result.errors[0].message;
		if (message.includes("Could not resolve to a User")) {
			throw new Error("USER_NOT_FOUND");
		}
		throw new Error(message);
	}

	const user = result.data?.user;
	if (!user) throw new Error("USER_NOT_FOUND");

	const calendar = user.contributionsCollection.contributionCalendar;
	const weeks = normalizeWeeks(calendar.weeks);

	const realDays = weeks
		.flatMap((week) => week.contributionDays)
		.filter((day) => day.date !== "")
		.map((day) => ({ date: day.date, count: day.contributionCount }));

	const { currentStreak, longestStreak } = calculateStreaks(realDays);
	const mostInDay = realDays.reduce((max, day) => Math.max(max, day.count), 0);
	const totalCounted = realDays.reduce((sum, day) => sum + day.count, 0);
	const averagePerDay =
		realDays.length > 0 ? totalCounted / realDays.length : 0;

	return {
		username: user.login,
		totalContributions: calendar.totalContributions,
		currentStreak,
		longestStreak,
		mostInDay,
		averagePerDay,
		weeks,
		lastUpdated: formatUpdatedLabel(new Date()),
	};
}

function messageFor(error: unknown, username: string): string {
	const code = error instanceof Error ? error.message : String(error);
	switch (code) {
		case "MISSING_TOKEN":
			return "Set GITHUB_TOKEN in your environment to show contributions.";
		case "BAD_TOKEN":
			return "GITHUB_TOKEN was rejected by GitHub. Check the token.";
		case "RATE_LIMITED":
			return "GitHub rate limit exceeded. Try again later.";
		case "USER_NOT_FOUND":
			return `GitHub user "${username}" was not found.`;
		default:
			return "GitHub contributions are unavailable right now.";
	}
}

function emptyData(username: string, message: string): GitHubContributionsData {
	return {
		username,
		totalContributions: 0,
		currentStreak: 0,
		longestStreak: 0,
		mostInDay: 0,
		averagePerDay: 0,
		weeks: [],
		lastUpdated: "N/A",
		message,
	};
}

export default async function getData(
	params?: GitHubContributionsParams,
): Promise<GitHubContributionsData> {
	const username = params?.username?.trim() || DEFAULT_USERNAME;

	try {
		// Throwing inside the cached function keeps failures out of the cache.
		const cached = unstable_cache(
			() => fetchContributions(username),
			["github-contributions", username],
			{
				tags: ["github-contributions", username],
				revalidate: 3600,
			},
		);
		return await cached();
	} catch (error) {
		console.error(
			`Error fetching GitHub contributions for ${username}:`,
			error,
		);
		return emptyData(username, messageFor(error, username));
	}
}
