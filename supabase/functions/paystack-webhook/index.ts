import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyBillingEntitlement,
  hmacSha512Hex,
  inferTierFromPlanCode,
  isPaidTier,
  normalizeBillingStatus,
  recordBillingEvent,
  type BillingTier,
} from "../_shared/paystack.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractUserId(payload: Record<string, any>) {
  return payload?.metadata?.user_id
    || payload?.customer?.metadata?.user_id
    || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !paystackSecretKey) {
      return json({ error: "Webhook is missing required environment configuration." }, 500);
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature") || "";
    const expected = await hmacSha512Hex(paystackSecretKey, rawBody);
    if (!signature || signature !== expected) {
      return json({ error: "Invalid webhook signature." }, 401);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const event = JSON.parse(rawBody);
    const eventType = String(event?.event || "");
    const data = event?.data || {};
    const metadata = data?.metadata || {};
    const customer = data?.customer || {};
    const subscription = data?.subscription || data || {};
    const userId = extractUserId(data) || extractUserId(subscription);
    const email = customer?.email || data?.customer?.email || data?.email || "";
    const planCode = subscription?.plan?.plan_code || data?.plan?.plan_code || data?.plan || null;
    const tier = (
      (isPaidTier(metadata.target_tier) ? metadata.target_tier : null) ||
      inferTierFromPlanCode(planCode)
    ) as BillingTier | null;
    const eventKey = String(
      subscription?.subscription_code ||
      data?.reference ||
      data?.invoice_code ||
      eventType + ":" + (data?.id || crypto.randomUUID())
    );

    await recordBillingEvent(adminClient, {
      providerEventKey: `paystack:${eventKey}:${eventType}`,
      providerEventType: eventType,
      userId,
      payload: event,
      processed: false,
    });

    if (userId && email && tier) {
      const normalizedStatus = eventType === "subscription.disable"
        ? "cancelled"
        : eventType === "invoice.payment_failed"
          ? "failed"
          : normalizeBillingStatus(subscription?.status || data?.status || eventType);

      await applyBillingEntitlement(adminClient, {
        userId,
        email,
        tier,
        status: normalizedStatus,
        customerCode: customer?.customer_code || subscription?.customer?.customer_code || null,
        subscriptionCode: subscription?.subscription_code || null,
        planCode,
        nextPaymentAt: subscription?.next_payment_date || null,
        amountZar: typeof data?.amount === "number" ? Number(data.amount) / 100 : null,
        rawPayload: event,
      });
    }

    await recordBillingEvent(adminClient, {
      providerEventKey: `paystack:${eventKey}:${eventType}`,
      providerEventType: eventType,
      userId,
      payload: event,
      processed: true,
    });

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected webhook error.";
    return json({ error: message }, 500);
  }
});
