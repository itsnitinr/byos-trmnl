import { connection } from "next/server";
import { Suspense } from "react";
import { PageTemplate } from "@/components/common/page-template";
import { RenderInspector } from "@/components/tools/render-inspector";
import { listReactRecipes } from "@/lib/recipes/registry";
import { listModels } from "@/lib/trmnl/registry";

async function InspectorContent() {
	await connection();
	const [recipes, models] = await Promise.all([
		listReactRecipes(),
		listModels(),
	]);
	return (
		<RenderInspector
			recipes={recipes.map(({ slug, title }) => ({ slug, title }))}
			models={models.map(({ name, label, width, height, palette_ids }) => ({
				name,
				label,
				width,
				height,
				palette_ids,
			}))}
		/>
	);
}
export default function Page() {
	return (
		<PageTemplate
			title="Render inspector"
			subtitle="Measure image generation and compare fresh renders with cache hits."
		>
			<Suspense fallback={<p>Loading renderer…</p>}>
				<InspectorContent />
			</Suspense>
		</PageTemplate>
	);
}
