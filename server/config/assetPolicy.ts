import type { AdminConfigSnapshot } from "./types.js";

export type PublicAssetUse = {
  approved: boolean;
  src: string | null;
  label: string;
  fallbackLabel: string;
};

export type PublicAssetPolicy = {
  logo: PublicAssetUse;
  emblem: PublicAssetUse;
  portrait: PublicAssetUse;
  disclaimer: {
    approved: boolean;
    text: string;
  };
};

function appControlApproved(config: AdminConfigSnapshot, id: string) {
  return config.appControls.find((control) => control.id === id)?.value === true;
}

function assetUse(input: { approved: boolean; src: string; label: string; fallbackLabel: string }): PublicAssetUse {
  return {
    approved: input.approved,
    src: input.approved ? input.src : null,
    label: input.label,
    fallbackLabel: input.fallbackLabel,
  };
}

export function publicAssetPolicyFromConfig(config: AdminConfigSnapshot): PublicAssetPolicy {
  const disclaimerApproved = appControlApproved(config, "asset-public-disclaimer-approved");
  return {
    logo: assetUse({
      approved: appControlApproved(config, "asset-logo-approved"),
      src: "/assets/brand/whistle-fake-logo.svg",
      label: "Whistle logo",
      fallbackLabel: "Whistle",
    }),
    emblem: assetUse({
      approved: appControlApproved(config, "asset-tn-emblem-approved"),
      src: "/assets/brand/whistle-civic-mark.svg",
      label: "Neutral civic service mark",
      fallbackLabel: "Civic",
    }),
    portrait: assetUse({
      approved: appControlApproved(config, "asset-portrait-approved"),
      src: "/assets/brand/whistle-service-portrait.svg",
      label: "Neutral citizen-service illustration",
      fallbackLabel: "Service",
    }),
    disclaimer: {
      approved: disclaimerApproved,
      text: disclaimerApproved
        ? "Whistle is running in local UAT mode with neutral approved app identity. Official marks can be enabled after public-use approval."
        : "Unapproved public marks, emblems, and likenesses are hidden from public surfaces until Admin review is complete.",
    },
  };
}
