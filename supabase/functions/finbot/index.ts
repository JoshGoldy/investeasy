import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_CREDITS: Record<string, number> = {
  free: 0,
  basic: 15,
  pro: 50,
  enterprise: 200,
};

const REQUEST_COST: Record<string, number> = {
  news: 2,
  chat: 1,
  finbot: 5,
};

const RATE_LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  chat: { limit: 12, windowSeconds: 5 * 60 },
  news: { limit: 8, windowSeconds: 10 * 60 },
  finbot: { limit: 6, windowSeconds: 15 * 60 },
};

const MODE_TOKEN_LIMITS: Record<string, number> = {
  news: 1800,
  chat: 900,
  screener: 2200,
  technical: 2200,
  earnings: 2400,
  dcf: 3200,
  risk: 3600,
  builder: 4200,
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

function trimText(value: unknown, max = 2400) {
  return String(value || "").trim().slice(0, max);
}

async function consumeRateLimit(
  adminClient: ReturnType<typeof createClient>,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
) {
  const { data, error } = await adminClient.rpc("consume_rate_limit", {
    p_scope: scope,
    p_subject: subject,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    const resetAt = row?.reset_at ? new Date(row.reset_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "soon";
    throw new Error(`Rate limit reached. Please wait and try again after ${resetAt}.`);
  }
}

async function logFunctionEvent(
  adminClient: ReturnType<typeof createClient>,
  service: string,
  level: string,
  subject: string | null,
  event: string,
  detail?: string,
  meta: Record<string, unknown> = {},
) {
  try {
    await adminClient.rpc("log_function_event", {
      p_service: service,
      p_level: level,
      p_subject: subject,
      p_event: event,
      p_detail: detail ?? null,
      p_meta: meta,
    });
  } catch (_) {
    // Logging should never block a user-facing response.
  }
}

function getPromptBody(payload: Record<string, unknown>) {
  if (payload.request_type === "chat") {
    const latest = trimText(payload.prompt || payload.user || payload.message || "", 1800);
    const history = Array.isArray(payload.history)
      ? payload.history
          .map((entry) => {
            const role = entry && typeof entry === "object" ? String((entry as Record<string, unknown>).role || "") : "";
            const content = entry && typeof entry === "object" ? trimText((entry as Record<string, unknown>).content || "", 1200) : "";
            if (!content.trim() || (role !== "user" && role !== "assistant")) return null;
            return { role, content: content.trim() };
          })
          .filter(Boolean)
          .slice(-8) as Array<{ role: "user" | "assistant"; content: string }>
      : [];
    return {
      system:
        "You are FinBot, a concise educational financial assistant. Help users understand investing concepts, portfolio decisions, market news, and risk in clear language. Keep answers practical and reasonably short. Do not give personalized financial advice or guarantees. If a user asks what to buy or sell, frame your answer as general education and key factors to consider.",
      messages: [...history, { role: "user" as const, content: latest }],
    };
  }

  if (payload.request_type === "news") {
    return {
      system: "You are FinBot, an expert financial analyst AI. Reply in Markdown and keep the analysis concise but useful.",
      messages: [{ role: "user" as const, content: trimText(payload.prompt || "", 3200) }],
    };
  }

  return {
    system: String(payload.system || "You are FinBot, an expert financial analyst AI. Reply in Markdown.").trim(),
    messages: [{ role: "user" as const, content: trimText(payload.user || payload.prompt || "", 3600) }],
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
      await logFunctionEvent(adminClient, "finbot", "warn", null, "auth_failed", authError?.message || "Missing authenticated user");
      return json({ error: "Please sign in to use FinBot." }, 401);
    }

    const payload = (await req.json()) as Record<string, unknown>;
    const requestType = String(payload.request_type || "finbot");
    const mode = String(payload.mode || requestType || "finbot");
    const cost = REQUEST_COST[requestType] ?? REQUEST_COST.finbot;
    const rateLimit = RATE_LIMITS[requestType] ?? RATE_LIMITS.finbot;
    const prompt = getPromptBody(payload);
    const maxTokens = MODE_TOKEN_LIMITS[mode] ?? MODE_TOKEN_LIMITS[requestType] ?? 2600;
    const lastMessage = prompt.messages?.[prompt.messages.length - 1]?.content || "";
    if (!lastMessage) {
      await logFunctionEvent(adminClient, "finbot", "warn", authData.user.id, "invalid_request", "Missing prompt", { requestType, mode });
      return json({ error: "No prompt was provided." }, 400);
    }
    if (lastMessage.length < 8) {
      await logFunctionEvent(adminClient, "finbot", "warn", authData.user.id, "invalid_request", "Prompt too short", { requestType, mode });
      return json({ error: "Please provide a bit more detail so FinBot can help." }, 400);
    }
    if (Array.isArray(payload.history) && payload.history.length > 20) {
      await logFunctionEvent(adminClient, "finbot", "warn", authData.user.id, "invalid_request", "History too long", { historyLength: payload.history.length, requestType, mode });
      return json({ error: "Chat history is too long. Start a fresh conversation and try again." }, 400);
    }

    const { data: currentProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, tier, finbot_credits, credits_reset_at")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      await logFunctionEvent(adminClient, "finbot", "error", authData.user.id, "profile_lookup_failed", profileError.message);
      return json({ error: profileError.message }, 500);
    }

    const tier = String(currentProfile?.tier || "free");
    if (tier === "free") {
      await logFunctionEvent(adminClient, "finbot", "info", authData.user.id, "upgrade_required", "Free tier attempted FinBot access", { requestType, mode });
      return json({
        error: "FinBot requires a paid plan.",
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
        await logFunctionEvent(adminClient, "finbot", "error", authData.user.id, "credit_reset_failed", resetError.message);
        return json({ error: resetError.message }, 500);
      }
    }

    if (creditsRemaining < cost) {
      await logFunctionEvent(adminClient, "finbot", "info", authData.user.id, "insufficient_credits", "Request blocked due to insufficient credits", { creditsRemaining, cost, requestType, mode });
      return json({
        error: "Insufficient credits. Please upgrade your plan or contact support.",
        code: "no_credits",
        credits_remaining: creditsRemaining,
      }, 402);
    }

    await consumeRateLimit(
      adminClient,
      `finbot:${requestType}:${mode}`,
      authData.user.id,
      rateLimit.limit,
      rateLimit.windowSeconds,
    ).catch(async (error) => {
      const message = error instanceof Error ? error.message : "Rate limit reached.";
      await logFunctionEvent(adminClient, "finbot", "warn", authData.user.id, "rate_limited", message, { requestType, mode });
      throw error;
    });

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: maxTokens,
        system: prompt.system,
        messages: prompt.messages,
      }),
    });

    const anthropicData = await anthropicResp.json();
    if (!anthropicResp.ok) {
      const apiError = anthropicData?.error?.message || anthropicData?.error || "Anthropic request failed.";
      await logFunctionEvent(adminClient, "finbot", "error", authData.user.id, "anthropic_error", String(apiError), {
        requestType,
        mode,
        status: anthropicResp.status,
      });
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
      await logFunctionEvent(adminClient, "finbot", "error", authData.user.id, "empty_response", "Anthropic returned no text", { requestType, mode });
      return json({ error: "FinBot returned an empty response." }, 502);
    }

    creditsRemaining -= cost;
    const { error: debitError } = await adminClient
      .from("profiles")
      .update({ finbot_credits: creditsRemaining, credits_reset_at: creditsResetAt || new Date().toISOString() })
      .eq("id", authData.user.id);

    if (debitError) {
      await logFunctionEvent(adminClient, "finbot", "error", authData.user.id, "credit_debit_failed", debitError.message, { requestType, mode });
      return json({ error: debitError.message }, 500);
    }

    await logFunctionEvent(adminClient, "finbot", "info", authData.user.id, "request_succeeded", `Processed ${requestType}`, {
      requestType,
      mode,
      cost,
      creditsRemaining,
    });

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
