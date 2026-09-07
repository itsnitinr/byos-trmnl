import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const base = process.env.RENDER_TEST_URL || "http://127.0.0.1:3011";
const update = process.argv.includes("--update");
const cases = [
	{width:800,height:480,model:"og_plus",palette:"bw"},
	{width:480,height:800,model:"og_plus",palette:"gray-4"},
	{width:1872,height:1404,model:"v2",palette:"gray-16"},
];
const dir = path.resolve("tests/rendering");
await mkdir(dir,{recursive:true});
for(const item of cases) {
	const query=new URLSearchParams({width:String(item.width),height:String(item.height),model:item.model,palette_id:item.palette});
	const response=await fetch(`${base}/api/bitmap/device-calibration.png?${query}`,{signal:AbortSignal.timeout(60_000)});
	if(!response.ok) throw new Error(`Render failed: ${response.status}`);
	const png=Buffer.from(await response.arrayBuffer());
	const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
	if(info.width!==item.width || info.height!==item.height) throw new Error("Wrong output dimensions");
	const file=path.join(dir,`${item.width}x${item.height}-${item.palette}.png`);
	if(update) await writeFile(file,png);
	else {
		const expected=await sharp(await readFile(file)).removeAlpha().raw().toBuffer();
		if(!data.equals(expected)) {
			await writeFile(file.replace(".png",".actual.png"),png);
			throw new Error(`Visual regression: ${path.basename(file)} (actual image saved)`);
		}
	}
	console.log(`${update ? "Recorded" : "Passed"} ${path.basename(file)} (${png.length} bytes)`);
}
