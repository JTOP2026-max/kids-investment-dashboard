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

const PRIORITY_COLUMNS_SCRIPT = `<script>
(() => {
  const order = [0,8,9,10,11,12,1,2,3,4,5,6,7];
  const reorder = (row) => {
    if (!row || row.dataset.kidOrder === '1' || row.children.length !== 13) return;
    const cells = Array.from(row.children);
    order.forEach(i => row.appendChild(cells[i]));
    row.dataset.kidOrder = '1';
  };
  const apply = () => {
    const table = document.querySelector('.table-wrap table');
    if (!table) return;
    reorder(table.querySelector('thead tr'));
    table.querySelectorAll('tbody tr').forEach(reorder);
  };
  const start = () => {
    apply();
    const body = document.getElementById('rows');
    if (body) new MutationObserver(apply).observe(body, {childList:true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
</script>`;

class BodyInjector {
  element(element) {
    element.append(PRIORITY_COLUMNS_SCRIPT, { html: true });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/quotes") {
      if (env?.ASSETS) {
        const response = await env.ASSETS.fetch(request);
        const type = response.headers.get("content-type") || "";
        if (type.includes("text/html")) {
          return new HTMLRewriter().on("body", new BodyInjector()).transform(response);
        }
        return response;
      }
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
