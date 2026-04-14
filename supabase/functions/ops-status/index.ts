import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function parseAllowList(raw: string | undefined | null) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return json({ error: "Supabase function is missing required environment configuration." }, 500);
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
      return json({ error: "Please sign in to view system health." }, 401);
    }

    const callerEmail = String(authData.user.email || "").trim().toLowerCase();
    const allowedEmails = parseAllowList(Deno.env.get("OPS_ALLOWED_EMAILS"));
    if (!callerEmail || !allowedEmails.includes(callerEmail)) {
      return json({ error: "You do not have access to system diagnostics." }, 403);
    }

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ data: recentEvents, error: eventsError }, { data: profileStats, error: profileError }] = await Promise.all([
      adminClient
        .from("function_event_logs")
        .select("service, level, event, detail, created_at")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(12),
      adminClient
        .from("profiles")
        .select("tier, finbot_credits"),
    ]);

    if (eventsError) return json({ error: eventsError.message }, 500);
    if (profileError) return json({ error: profileError.message }, 500);

    const serviceSummary = (recentEvents || []).reduce<Record<string, { errors: number; warns: number; lastEvent: string | null; lastAt: string | null }>>((acc, row) => {
      const key = String(row.service || "unknown");
      if (!acc[key]) acc[key] = { errors: 0, warns: 0, lastEvent: null, lastAt: null };
      if (row.level === "error") acc[key].errors += 1;
      if (row.level === "warn") acc[key].warns += 1;
      if (!acc[key].lastAt) {
        acc[key].lastAt = row.created_at || null;
        acc[key].lastEvent = row.event || null;
      }
      return acc;
    }, {});

    const planCounts = (profileStats || []).reduce<Record<string, number>>((acc, row) => {
      const tier = String(row.tier || "free");
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {});

    const lowCreditUsers = (profileStats || []).filter((row) => {
      const tier = String(row.tier || "free");
      return tier !== "free" && Number(row.finbot_credits ?? 0) <= 5;
    }).length;

    return json({
      success: true,
      generated_at: new Date().toISOString(),
      service_summary: serviceSummary,
      plan_counts: planCounts,
      low_credit_users: lowCreditUsers,
      recent_events: (recentEvents || []).map((row) => ({
        service: row.service,
        level: row.level,
        event: row.event,
        detail: row.detail,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
