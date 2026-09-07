import { connection } from "next/server";
import { Suspense } from "react";
import { fetchPlaylists } from "@/app/actions/playlist";
import { PageTemplate } from "@/components/common/page-template";
import { PlaylistSimulator } from "@/components/tools/playlist-simulator";

async function Content() {
	await connection();
	return <PlaylistSimulator playlists={await fetchPlaylists()} />;
}
export default function Page() {
	return (
		<PageTemplate
			title="Playlist simulator"
			subtitle="See which screen would appear at each wake-up, without changing your device."
		>
			<Suspense fallback={<p>Loading playlists…</p>}>
				<Content />
			</Suspense>
		</PageTemplate>
	);
}
