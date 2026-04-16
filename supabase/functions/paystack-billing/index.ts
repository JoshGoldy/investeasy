import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyBillingEntitlement,
  getPlanConfig,
  inferTierFromPlanCode,
  isPaidTier,
  recordBillingEvent,
  type BillingTier,
} from "../_shared/paystack.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function paystackRequest(path: string, secretKey: string, method = "GET", body?: Record<string, unknown>) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok || data?.status === false) {
    throw new Error(data?.message || `Paystack request failed (${response.status}).`);
  }
  return data;
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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    const callbackUrl = Deno.env.get("PAYSTACK_CALLBACK_URL");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !paystackSecretKey) {
      return json({ error: "Billing function is missing required environment configuration." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return json({ error: "Please sign in to manage billing." }, 401);
    }

    const { action, tier, reference } = await req.json();
    const userId = authData.user.id;
    const email = authData.user.email || "";

    if (action === "create_checkout") {
      if (!isPaidTier(tier)) {
        return json({ error: "Unsupported billing tier." }, 400);
      }
      const plan = getPlanConfig(tier as BillingTier);
      if (!plan.planCode) {
        return json({ error: `Missing Paystack plan code for ${tier}.` }, 500);
      }

      const effectiveCallbackUrl = callbackUrl || `${new URL(req.url).origin}/settings.html?billing=success`;
      const initResp = await paystackRequest("/transaction/initialize", paystackSecretKey, "POST", {
        email,
        plan: plan.planCode,
        currency: "ZAR",
        callback_url: effectiveCallbackUrl,
        metadata: {
          source: "finscope",
          user_id: userId,
          target_tier: tier,
        },
      });

      await recordBillingEvent(adminClient, {
        providerEventKey: `checkout_init:${initResp.data.reference}`,
        providerEventType: "checkout.initialize",
        userId,
        payload: initResp.data,
        processed: true,
      });

      return json({
        success: true,
        url: initResp.data.authorization_url,
        reference: initResp.data.reference,
        tier,
        price_zar: plan.priceZar,
      });
    }

    if (action === "verify_checkout") {
      const cleanReference = String(reference || "").trim();
      if (!cleanReference) return json({ error: "Missing Paystack reference." }, 400);

      const verifyResp = await paystackRequest(`/transaction/verify/${encodeURIComponent(cleanReference)}`, paystackSecretKey);
      const data = verifyResp.data || {};
      const metadata = data.metadata || {};
      const customer = data.customer || {};
      const subscription = data.subscription || {};
      const planCode = data.plan || subscription.plan?.plan_code || null;
      const inferredTier = (
        (isPaidTier(metadata.target_tier) ? metadata.target_tier : null) ||
        inferTierFromPlanCode(planCode)
      ) as BillingTier | null;

      if (data.status !== "success" || !inferredTier) {
        await recordBillingEvent(adminClient, {
          providerEventKey: `verify:${cleanReference}`,
          providerEventType: "checkout.verify_failed",
          userId,
          payload: data,
          processed: true,
        });
        return json({ error: "Payment has not completed successfully yet." }, 400);
      }

      await applyBillingEntitlement(adminClient, {
        userId,
        email,
        tier: inferredTier,
        status: subscription.status || data.status,
        customerCode: customer.customer_code || null,
        subscriptionCode: subscription.subscription_code || null,
        planCode,
        nextPaymentAt: subscription.next_payment_date || null,
        amountZar: typeof data.amount === "number" ? Number(data.amount) / 100 : getPlanConfig(inferredTier).priceZar,
        rawPayload: data,
      });

      await recordBillingEvent(adminClient, {
        providerEventKey: `verify:${cleanReference}`,
        providerEventType: "checkout.verified",
        userId,
        payload: data,
        processed: true,
      });

      return json({
        success: true,
        tier: inferredTier,
        billing_status: subscription.status || "active",
      });
    }

    return json({ error: "Unsupported billing action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected billing server error.";
    return json({ error: message }, 500);
  }
});
