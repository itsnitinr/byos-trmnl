import { findModel } from "./registry";
import { DEFAULT_MODEL_NAME } from "./types";

export type ModelStorageResolution = {
	modelName?: string;
	reportedUnknown?: string;
	resolvedModelName?: string;
	preservedExisting: boolean;
	defaulted: boolean;
};

/**
 * Firmware reports its build's DEVICE_MODEL (usetrmnl/trmnl-firmware
 * platformio.ini), not a registry model name. Where a board maps
 * unambiguously, list the registry models it can be configured as; the first
 * is the default. A stored model inside the family is the owner's choice
 * (e.g. 1-bit `og_png` vs 2-bit `og_plus` on the same OG panel) and is kept.
 * Boards whose panel varies (DIY kits, generic Waveshare drivers) are not
 * listed and keep whatever model was configured.
 */
const FIRMWARE_MODEL_FAMILIES: Record<string, readonly string[]> = {
	og: [DEFAULT_MODEL_NAME, "og_png"],
	og_4clr: ["og_bwry"],
	x: ["v2"],
	reterminal_e1003: ["seeed_e1003"],
	m5_papers3: ["m5_paper_s3"],
};

export function firmwareModelFamily(
	reportedModel: string,
): readonly string[] | undefined {
	return FIRMWARE_MODEL_FAMILIES[reportedModel.toLowerCase()];
}

export async function resolveModelForStorage(
	reportedModel: string | null | undefined,
	existingModel?: string | null,
): Promise<ModelStorageResolution> {
	const reported = reportedModel?.trim();
	if (!reported) {
		return { preservedExisting: false, defaulted: false };
	}
	const existing = existingModel?.trim();

	if (await findModel(reported)) {
		return {
			modelName: reported,
			resolvedModelName: reported,
			preservedExisting: false,
			defaulted: false,
		};
	}

	const family = firmwareModelFamily(reported);
	if (family) {
		if (existing && family.includes(existing)) {
			return {
				resolvedModelName: existing,
				preservedExisting: true,
				defaulted: false,
			};
		}
		if (await findModel(family[0])) {
			return {
				modelName: family[0],
				resolvedModelName: family[0],
				preservedExisting: false,
				defaulted: false,
			};
		}
	}

	if (existing && (await findModel(existing))) {
		return {
			reportedUnknown: reported,
			resolvedModelName: existing,
			preservedExisting: true,
			defaulted: false,
		};
	}

	return {
		modelName: DEFAULT_MODEL_NAME,
		reportedUnknown: reported,
		resolvedModelName: DEFAULT_MODEL_NAME,
		preservedExisting: false,
		defaulted: true,
	};
}
