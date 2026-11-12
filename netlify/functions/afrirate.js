// Secure AfriRate reference-rate proxy for RemitlyFly.
// The API key stays in Netlify environment variables and is never sent to the browser.
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
    "Access-Control-Allow-Origin": "https://remitlyfly.org",
    "Vary": "Origin"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const params = event.queryStringParameters || {};
  const country = String(params.country || "").toUpperCase();
  const base = String(params.base || "").toUpperCase();
  const countryCurrencies = { ET: "ETB", KE: "KES", NG: "NGN", UG: "UGX" };
  if (!Object.prototype.hasOwnProperty.call(countryCurrencies, country) ||
      !["USD", "EUR", "GBP"].includes(base)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unsupported country or sender currency" }) };
  }

  const apiKey = process.env.AFRIRATE_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: "Exchange-rate service is not configured" }) };
  }

  const quote = countryCurrencies[country];
  const url = new URL("https://afrirate.statotec.com/api/v1/rates/latest");
  url.searchParams.set("country", country);
  url.searchParams.set("base", base);
  url.searchParams.set("quote", quote);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "application/json", "Authorization": `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { statusCode: response.status === 429 ? 429 : 502, headers, body: JSON.stringify({ error: "The exchange-rate provider could not return a rate", providerStatus: response.status }) };
    }

    const rows = Array.isArray(payload.data) ? payload.data : [];
    const row = rows.find(item =>
      String(item.base || "").toUpperCase() === base &&
      String(item.quote || "").toUpperCase() === quote &&
      Number(item.rate) > 0
    );
    if (!row) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "No published rate for this currency pair", country, base, quote }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        country, base, quote, rate: Number(row.rate),
        source: row.source || "AfriRate central-bank feed",
        rateDate: row.rate_date || null,
        updatedAt: row.updated_at || payload.meta?.timestamp || null,
        stale: Boolean(row.stale),
        indicativeOnly: true
      })
    };
  } catch (error) {
    return { statusCode: 504, headers, body: JSON.stringify({ error: "Exchange-rate request timed out or failed" }) };
  }
};
