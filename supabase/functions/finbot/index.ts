import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_CREDITS: Record<string, number> = {
  free: 0,
  pro: 50,
  enterprise: 200,
};

const REQUEST_COST: Record<string, number> = {
  news: 2,
  finbot: 5,
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resetNeeded(creditsResetAt?: string | null) {
  if (!creditsResetAt) return true;
  const resetAt = new Date(creditsResetAt);
  if (Number.isNaN(resetAt.getTime())) return true;
  return Date.now() - resetAt.getTime() >= 30 * 24 * 60 * 60 * 1000;
}

function getPromptBody(payload: Record<string, unknown>) {
  if (payload.request_type === "news") {
    return {
      system: "You are FinBot, an expert financial analyst AI. Reply in Markdown and keep the analysis concise but useful.",
      message: String(payload.prompt || "").trim(),
    };
  }

  return {
    system: String(payload.system || "You are FinBot, an expert financial analyst AI. Reply in Markdown.").trim(),
    message: String(payload.user || payload.prompt || "").trim(),
  };
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
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return json({ error: "Supabase function is missing required environment configuration." }, 500);
    }
    if (!anthropicApiKey) {
      return json({ error: "ANTHROPIC_API_KEY is not configured for the FinBot function." }, 500);
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
      return json({ error: "Please sign in to use FinBot." }, 401);
    }

    const payload = (await req.json()) as Record<string, unknown>;
    const requestType = String(payload.request_type || "finbot");
    const cost = REQUEST_COST[requestType] ?? REQUEST_COST.finbot;
    const prompt = getPromptBody(payload);
    if (!prompt.message) {
      return json({ error: "No prompt was provided." }, 400);
    }

    const { data: currentProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, tier, finbot_credits, credits_reset_at")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      return json({ error: profileError.message }, 500);
    }

    const tier = String(currentProfile?.tier || "free");
    if (tier === "free") {
      return json({
        error: "FinBot requires a Pro or Enterprise plan.",
        code: "upgrade_required",
        credits_remaining: 0,
      }, 403);
    }

    let creditsRemaining = Number(currentProfile?.finbot_credits ?? DEFAULT_CREDITS[tier] ?? 0);
    let creditsResetAt = currentProfile?.credits_reset_at ?? null;

    if (resetNeeded(creditsResetAt)) {
      creditsRemaining = DEFAULT_CREDITS[tier] ?? creditsRemaining;
      creditsResetAt = new Date().toISOString();
      const { error: resetError } = await adminClient
        .from("profiles")
        .update({ finbot_credits: creditsRemaining, credits_reset_at: creditsResetAt })
        .eq("id", authData.user.id);
      if (resetError) {
        return json({ error: resetError.message }, 500);
      }
    }

    if (creditsRemaining < cost) {
      return json({
        error: "Insufficient credits. Please upgrade your plan or contact support.",
        code: "no_credits",
        credits_remaining: creditsRemaining,
      }, 402);
    }

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: requestType === "news" ? 1800 : 2600,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.message }],
      }),
    });

    const anthropicData = await anthropicResp.json();
    if (!anthropicResp.ok) {
      const apiError = anthropicData?.error?.message || anthropicData?.error || "Anthropic request failed.";
      return json({ error: String(apiError) }, 502);
    }

    const text = Array.isArray(anthropicData?.content)
      ? anthropicData.content
          .filter((block: { type?: string }) => block?.type === "text")
          .map((block: { text?: string }) => block.text || "")
          .join("\n\n")
          .trim()
      : "";

    if (!text) {
      return json({ error: "FinBot returned an empty response." }, 502);
    }

    creditsRemaining -= cost;
    const { error: debitError } = await adminClient
      .from("profiles")
      .update({ finbot_credits: creditsRemaining, credits_reset_at: creditsResetAt || new Date().toISOString() })
      .eq("id", authData.user.id);

    if (debitError) {
      return json({ error: debitError.message }, 500);
    }

    return json({
      success: true,
      text,
      credits_remaining: creditsRemaining,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return json({ error: message }, 500);
  }
});
