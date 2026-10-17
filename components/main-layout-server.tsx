import { connection } from "next/server";
import tools from "@/app/(app)/tools/tools.json";
import { ClientMainLayout } from "@/components/client-main-layout";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getInitData } from "@/lib/getInitData";
import { listAllRecipes } from "@/lib/recipes/catalog";

const AUTH_ENABLED = process.env.AUTH_ENABLED !== "false";

/**
 * Server Component that handles all data fetching and passes it to client components.
 *
 * This component:
 * 1. Centralizes data fetching through getInitData(), which is cached per
 *    request and shared with the page being rendered
 * 2. Processes recipe and tool data on the server
 * 3. Passes the complete set of server data to ClientMainLayout
 */
export default async function MainLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await connection();

	// getInitData() is cached per request, so the page reuses this result.
	// The sidebar lists built-in React recipes (registry) + installed liquid
	// recipes (DB); built-ins show up even on a cold-install database.
	const [{ devices, dbStatus }, user, allRecipes] = await Promise.all([
		getInitData(),
		getCurrentUser(),
		listAllRecipes(),
	]);
	const recipeSidebarItems = allRecipes.map((r) => ({
		slug: r.slug,
		name: r.name,
	}));

	const toolsComponents = Object.entries(tools)
		.filter(
			([, config]) => process.env.NODE_ENV !== "production" || config.published,
		)
		.sort((a, b) => a[1].title.localeCompare(b[1].title));

	// Pass all data to the ClientMainLayout
	// This ensures data is shared across pages through the centralized cache
	return (
		<ClientMainLayout
			devices={devices}
			dbStatus={dbStatus}
			recipeSidebarItems={recipeSidebarItems}
			toolsComponents={toolsComponents}
			user={user}
			authEnabled={AUTH_ENABLED}
		>
			{children}
		</ClientMainLayout>
	);
}
