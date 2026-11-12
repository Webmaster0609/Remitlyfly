// RemitlyFly public indicative-rate proxy.
// The AfriRate API key is stored only in Supabase Edge Function secrets.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
};

const pairs: Record<string, string> = {
  ET: "ETB",
  KE: "KES",
  NG: "NGN",
  UG: "UGX",
};
const allowedBases = new Set(["USD", "EUR", "GBP"]);

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: corsHeaders,
    });
  }

  const url = new URL(request.url);
  const country = (url.searchParams.get("country") || "").toUpperCase();
  const base = (url.searchParams.get("base") || "").toUpperCase();
  const quote = pairs[country];

  if (!quote || !allowedBases.has(base)) {
    return new Response(JSON.stringify({ error: "Unsupported country or sender currency" }), {
      status: 400, headers: corsHeaders,
    });
  }

  const apiKey = Deno.env.get("AFRIRATE_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Rate provider is not configured" }), {
      status: 503, headers: corsHeaders,
    });
  }

  const upstream = new URL("https://afrirate.statotec.com/api/v1/rates/latest");
  upstream.searchParams.set("country", country);
  upstream.searchParams.set("base", base);
  upstream.searchParams.set("quote", quote);

  try {
    const response = await fetch(upstream, {
      headers: { "Accept": "application/json", "Authorization": `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const status = response.status === 429 ? 429 : (response.status === 404 ? 404 : 502);
      return new Response(JSON.stringify({
        error: "AfriRate could not return this currency pair",
        providerStatus: response.status,
      }), { status, headers: corsHeaders });
    }

    const rows = Array.isArray(payload.data) ? payload.data : [];
    const row = rows.find((item: Record<string, unknown>) =>
      String(item.base || "").toUpperCase() === base &&
      String(item.quote || "").toUpperCase() === quote &&
      Number(item.rate) > 0
    );
    if (!row) {
      return new Response(JSON.stringify({ error: "No published rate for this currency pair", country, base, quote }), {
        status: 404, headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({
      country, base, quote,
      rate: Number(row.rate),
      source: row.source || "AfriRate central-bank feed",
      rateDate: row.rate_date || null,
      updatedAt: row.updated_at || payload.meta?.timestamp || null,
      stale: Boolean(row.stale),
      indicativeOnly: true,
    }), { status: 200, headers: corsHeaders });
  } catch (_error) {
    return new Response(JSON.stringify({ error: "Exchange-rate request timed out or failed" }), {
      status: 504, headers: corsHeaders,
    });
  }
});
