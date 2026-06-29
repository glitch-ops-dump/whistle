export type PublicTrendMetrics = {
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  slaBreached: number;
  dueIn48h: number;
  escalatedToCmCell: number;
};

export type PublicMetricRow = PublicTrendMetrics & {
  key: string;
  label: string;
};

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

export type PublicInsights = {
  enabled: true;
  generatedAt: string;
  assetPolicy: PublicAssetPolicy;
  privacy: {
    threshold: number;
    publicationDelayHours: number;
    publicVisibleTickets: number;
    withheldRecentTickets: number;
    protectedCount: number;
    withheldSmallCellRows: number;
    withheldSmallCellTickets: number;
    excludedFields: string[];
    protectedPolicy: string;
  };
  trends: {
    month: PublicTrendMetrics;
    allTime: PublicTrendMetrics;
  };
  openIssues: {
    byDistrict: PublicMetricRow[];
    byMinistry: PublicMetricRow[];
    byCategory: PublicMetricRow[];
  };
};

const apiBase = import.meta.env.VITE_WHISTLE_API_BASE ?? "http://localhost:3001";

export async function fetchPublicInsights(signal?: AbortSignal) {
  const response = await fetch(`${apiBase}/api/public/insights`, { signal });
  if (response.status === 403) {
    return {
      disabled: true,
      message: "Public aggregate insights are currently paused by Admin policy.",
    } as const;
  }
  if (!response.ok) throw new Error(`Public insights API failed (${response.status})`);
  return (await response.json()) as { insights: PublicInsights };
}
