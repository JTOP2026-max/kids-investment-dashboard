const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff"
};

function errorResponse(message, status, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: JSON_HEADERS
  });
}

function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function firstLevel(v) {
  return clean(String(v || "").split("_")[0]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/quotes") {
      if (env?.ASSETS) return env.ASSETS.fetch(request);
      return errorResponse("Not found", 404);
    }

    const channels = (url.searchParams.get("ch") || "")
      .split("|")
      .map(x => x.trim())
      .filter(Boolean);

    if (!channels.includes("tse_t00.tw")) channels.push("tse_t00.tw");

    if (
      channels.length === 0 ||
      channels.length > 60 ||
      channels.some((channel) => !/^(tse|otc)_[A-Za-z0-9]+\.tw$/.test(channel))
    ) {
      return errorResponse("Invalid stock channels", 400);
    }

    try {
      // TWSE MIS is more reliable when a session cookie is established first.
      let cookie = "";
      try {
        const warmup = await fetch("https://mis.twse.com.tw/stock/index.jsp", {
          headers: {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "user-agent": "Mozilla/5.0"
          },
          cf: { cacheTtl: 0, cacheEverything: false }
        });
        cookie = warmup.headers.get("set-cookie") || "";
      } catch (_) {}

      const upstreamUrl = new URL("https://mis.twse.com.tw/stock/api/getStockInfo.jsp");
      upstreamUrl.searchParams.set("ex_ch", channels.join("|"));
      upstreamUrl.searchParams.set("json", "1");
      upstreamUrl.searchParams.set("delay", "0");
      upstreamUrl.searchParams.set("_", Date.now().toString());

      const headers = {
        "accept": "application/json,text/plain,*/*",
        "referer": "https://mis.twse.com.tw/stock/index.jsp",
        "user-agent": "Mozilla/5.0"
      };
      if (cookie) headers.cookie = cookie;

      const upstream = await fetch(upstreamUrl.toString(), {
        headers,
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!upstream.ok) {
        return errorResponse("Quote service unavailable", 502, { upstreamStatus: upstream.status });
      }

      const data = await upstream.json();
      const rows = Array.isArray(data.msgArray) ? data.msgArray : [];

      // Make the response compatible with the current front-end.
      // If last trade z is blank, use best bid/ask midpoint, then previous close.
      for (const q of rows) {
        let price = clean(q.z);
        const prev = clean(q.y);
        if (price == null) {
          const ask = firstLevel(q.a);
          const bid = firstLevel(q.b);
          if (ask != null && bid != null) price = (ask + bid) / 2;
          else if (ask != null) price = ask;
          else if (bid != null) price = bid;
          else if (prev != null) price = prev;
        }
        if (price != null) q.z = String(price);
      }

      return new Response(JSON.stringify({ ...data, msgArray: rows, proxyUpdated: new Date().toISOString() }), {
        status: 200,
        headers: JSON_HEADERS
      });
    } catch (error) {
      console.error(JSON.stringify({
        message: "TWSE quote request threw",
        error: error instanceof Error ? error.message : String(error)
      }));
      return errorResponse("Quote service unavailable", 502);
    }
  }
};
