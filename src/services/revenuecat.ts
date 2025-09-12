import { config as appConfig } from "../config/env.js";

const RC_API_BASE =
  process.env.REVENUECAT_API_URL || "https://api.revenuecat.com/v2";
const RC_API_KEY =
  process.env.REVENUECAT_API_KEY || process.env.REVENUECAT_SECRET_KEY || "";

if (!RC_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[revenuecat] REVENUECAT_API_KEY is not set. /api/revenuecat/grant will not work."
  );
}

export async function fetchRevenueCatCustomer(appUserId: string): Promise<any> {
  const url = `${RC_API_BASE}/customers/${encodeURIComponent(appUserId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${RC_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || "Failed to query RevenueCat API");
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
