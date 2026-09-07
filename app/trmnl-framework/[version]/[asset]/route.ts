import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ version: string; asset: string }> },
) {
	const { version, asset } = await params;
	if (version !== "3.3.1" || !["plugins.css", "plugins.js"].includes(asset))
		return new Response("Not found", { status: 404 });
	const filename = `${asset.replace(".", ".min.")}.gz`;
	const buffer = await readFile(
		path.join(process.cwd(), "public/vendor/trmnl", version, filename),
	);
	return new Response(new Uint8Array(buffer), {
		headers: {
			"Content-Type": asset.endsWith(".css")
				? "text/css; charset=utf-8"
				: "application/javascript; charset=utf-8",
			"Content-Encoding": "gzip",
			"Cache-Control": "public, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
