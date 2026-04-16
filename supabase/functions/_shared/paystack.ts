export type BillingTier = "basic" | "pro" | "enterprise";

export const DEFAULT_CREDITS: Record<BillingTier, number> = {
  basic: 15,
  pro: 50,
  enterprise: 200,
};

export const DEFAULT_PRICES_ZAR: Record<BillingTier, number> = {
  basic: 99,
  pro: 199,
  enterprise: 499,
};

const PLAN_ENV_KEYS: Record<BillingTier, string> = {
  basic: "PAYSTACK_PLAN_BASIC_MONTHLY",
  pro: "PAYSTACK_PLAN_PRO_MONTHLY",
  enterprise: "PAYSTACK_PLAN_ENTERPRISE_MONTHLY",
};

const PRICE_ENV_KEYS: Record<BillingTier, string> = {
  basic: "PAYSTACK_PRICE_BASIC_ZAR",
  pro: "PAYSTACK_PRICE_PRO_ZAR",
  enterprise: "PAYSTACK_PRICE_ENTERPRISE_ZAR",
};

export function isPaidTier(value: unknown): value is BillingTier {
  return value === "basic" || value === "pro" || value === "enterprise";
}

export function getPlanConfig(tier: BillingTier) {
  const planCode = Deno.env.get(PLAN_ENV_KEYS[tier])?.trim() || "";
  const price = Number(Deno.env.get(PRICE_ENV_KEYS[tier]) || DEFAULT_PRICES_ZAR[tier]);
  return {
    tier,
    planCode,
    priceZar: Number.isFinite(price) ? price : DEFAULT_PRICES_ZAR[tier],
    credits: DEFAULT_CREDITS[tier],
  };
}

export function inferTierFromPlanCode(planCode?: string | null): BillingTier | null {
  if (!planCode) return null;
  const tiers: BillingTier[] = ["basic", "pro", "enterprise"];
  for (const tier of tiers) {
    if (getPlanConfig(tier).planCode === planCode) return tier;
  }
  return null;
}

export function normalizeBillingStatus(input?: string | null) {
  const status = String(input || "").trim().toLowerCase();
  if (["success", "paid", "active"].includes(status)) return "active";
  if (["non-renewing", "non_renewing"].includes(status)) return "non_renewing";
  if (["attention", "past_due"].includes(status)) return "past_due";
  if (["invoice.payment_failed", "payment_failed", "failed"].includes(status)) return "failed";
  if (["subscription.disable", "disable", "cancelled", "canceled"].includes(status)) return "cancelled";
  return "pending";
}

export async function hmacSha512Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function recordBillingEvent(
  adminClient: any,
  {
    providerEventKey,
    providerEventType,
    userId = null,
    payload = {},
    processed = false,
  }: {
    providerEventKey: string;
    providerEventType: string;
    userId?: string | null;
    payload?: Record<string, unknown>;
    processed?: boolean;
  },
) {
  await adminClient.from("billing_events").upsert({
    provider: "paystack",
    provider_event_key: providerEventKey,
    provider_event_type: providerEventType,
    user_id: userId,
    payload,
    processed,
    processed_at: processed ? new Date().toISOString() : null,
  }, { onConflict: "provider_event_key" });
}

export async function applyBillingEntitlement(
  adminClient: any,
  {
    userId,
    email,
    tier,
    status,
    customerCode = null,
    subscriptionCode = null,
    planCode = null,
    nextPaymentAt = null,
    amountZar = null,
    rawPayload = {},
  }: {
    userId: string;
    email: string;
    tier: BillingTier;
    status: string;
    customerCode?: string | null;
    subscriptionCode?: string | null;
    planCode?: string | null;
    nextPaymentAt?: string | null;
    amountZar?: number | null;
    rawPayload?: Record<string, unknown>;
  },
) {
  const normalizedStatus = normalizeBillingStatus(status);
  const nowIso = new Date().toISOString();

  await adminClient.from("billing_customers").upsert({
    user_id: userId,
    provider: "paystack",
    provider_customer_code: customerCode,
    email,
    raw_payload: rawPayload,
  }, { onConflict: "user_id" });

  if (subscriptionCode) {
    await adminClient.from("billing_subscriptions").upsert({
      user_id: userId,
      provider: "paystack",
      provider_subscription_code: subscriptionCode,
      provider_plan_code: planCode,
      provider_customer_code: customerCode,
      tier,
      status: normalizedStatus,
      amount_zar: amountZar,
      currency: "ZAR",
      next_payment_at: nextPaymentAt,
      cancel_at_period_end: normalizedStatus === "non_renewing",
      raw_payload: rawPayload,
    }, { onConflict: "provider_subscription_code" });
  }

  const profilePatch: Record<string, unknown> = {
    billing_provider: "paystack",
    billing_status: normalizedStatus,
    billing_customer_code: customerCode,
    billing_subscription_code: subscriptionCode,
    current_period_end: nextPaymentAt,
  };

  if (normalizedStatus === "active" || normalizedStatus === "pending" || normalizedStatus === "non_renewing") {
    profilePatch.tier = tier;
    profilePatch.finbot_credits = DEFAULT_CREDITS[tier];
    profilePatch.credits_reset_at = nowIso;
  } else if (normalizedStatus === "cancelled") {
    profilePatch.tier = "free";
    profilePatch.finbot_credits = 0;
    profilePatch.credits_reset_at = nowIso;
  }

  await adminClient.from("profiles").update(profilePatch).eq("id", userId);
}
