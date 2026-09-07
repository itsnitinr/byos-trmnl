import { getCurrentUserId } from "@/lib/auth/get-user";
import { getRenderDiagnostics } from "@/lib/render/diagnostics";
export async function GET() {
	const userId = await getCurrentUserId();
	if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
	return Response.json(
		{ renders: getRenderDiagnostics(userId) },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
