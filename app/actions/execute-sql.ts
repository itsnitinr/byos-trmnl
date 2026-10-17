"use server";

import { auth } from "@/lib/auth/auth";
import { getCurrentUser } from "@/lib/auth/get-user";
import { type MigrationResult, runMigrations } from "@/lib/database/migrate";
import { SQL_STATEMENTS } from "@/lib/database/sql-statements";
import {
	getDatabaseSetupStatus,
	invalidateDbReadiness,
} from "@/lib/database/utils";

export type SqlExecutionStatus =
	| "idle"
	| "loading"
	| "success"
	| "error"
	| "warning";

export interface SqlExecutionResult {
	status: SqlExecutionStatus;
	result: Record<string, unknown>[];
	notices: Record<string, unknown>[];
	error?: string;
	executionTime?: number;
}

export type SqlExecutionState = {
	[key in keyof typeof SQL_STATEMENTS]: SqlExecutionResult;
};

async function canRunSetupSql(): Promise<boolean> {
	if (!auth) {
		return true;
	}

	const user = await getCurrentUser().catch(() => null);
	if (user?.role === "admin") {
		return true;
	}

	// Before an admin exists, setup must be reachable without a session.
	const status = await getDatabaseSetupStatus();
	return status.needsSetup;
}

function stateForAll(result: SqlExecutionResult): SqlExecutionState {
	return Object.fromEntries(
		Object.keys(SQL_STATEMENTS).map((key) => [key, { ...result }]),
	) as SqlExecutionState;
}

export async function executeSqlStatements(): Promise<SqlExecutionState> {
	if (!(await canRunSetupSql())) {
		return stateForAll({
			status: "error",
			result: [],
			notices: [],
			error: "Unauthorized",
		});
	}

	if (!process.env.DATABASE_URL) {
		return stateForAll({
			status: "error",
			result: [],
			notices: [],
			error: "DATABASE_URL is not defined",
		});
	}

	// Statements after a failure are reported as not run.
	const state = stateForAll({ status: "idle", result: [], notices: [] });
	try {
		const { results } = await runMigrations(process.env.DATABASE_URL, {
			log: console.log,
		});
		for (const [key, result] of Object.entries(results)) {
			state[key as keyof typeof SQL_STATEMENTS] = result as MigrationResult;
		}
	} catch (error) {
		console.error("Unexpected error during SQL execution:", error);
		state.validate_schema = {
			status: "error",
			result: [],
			notices: [],
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		invalidateDbReadiness();
	}
	return state;
}
