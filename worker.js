const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function errorResponse(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: JSON_HEADERS
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/quotes") {
      return errorResponse("Not found", 404);
    }

    const channels = (url.searchParams.get("ch") || "").split("|").filter(Boolean);
    if (
      channels.length === 0 ||
      channels.length > 31 ||
      channels.some((channel) => !/^(tse|otc)_[A-Za-z0-9]+\.tw$/.test(channel))
    ) {
      return errorResponse("Invalid stock channels", 400);
    }

    const upstreamUrl = new URL("https://mis.twse.com.tw/stock/api/getStockInfo.jsp");
    upstreamUrl.searchParams.set("ex_ch", channels.join("|"));
    upstreamUrl.searchParams.set("json", "1");
    upstreamUrl.searchParams.set("delay", "0");
    upstreamUrl.searchParams.set("_", Date.now().toString());

    try {
      const upstream = await fetch(upstreamUrl, {
        headers: {
          "accept": "application/json,text/plain,*/*",
          "referer": "https://mis.twse.com.tw/",
          "user-agent": "Mozilla/5.0"
        }
      });

      if (!upstream.ok || !upstream.body) {
        console.error(JSON.stringify({
          message: "TWSE quote request failed",
          status: upstream.status
        }));
        return errorResponse("Quote service unavailable", 502);
      }

      return new Response(upstream.body, {
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
