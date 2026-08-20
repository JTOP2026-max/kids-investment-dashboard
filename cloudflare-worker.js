export default {
  async fetch(request) {
    const url = new URL(request.url);
    const allowedOrigin = 'https://jtop2026-max.github.io';
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origin === allowedOrigin ? allowedOrigin : '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store, max-age=0'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: cors });

    const raw = (url.searchParams.get('symbols') || '').trim();
    const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
    const safe = parts.filter(s => /^(tse|otc)_[0-9A-Za-z]+\.tw$/.test(s));
    if (!safe.includes('tse_t00.tw')) safe.push('tse_t00.tw');
    if (!safe.length || safe.length > 60) {
      return Response.json({ ok:false, error:'invalid symbols' }, { status:400, headers:cors });
    }

    const endpoint = new URL('https://mis.twse.com.tw/stock/api/getStockInfo.jsp');
    endpoint.searchParams.set('ex_ch', safe.join('|'));
    endpoint.searchParams.set('json', '1');
    endpoint.searchParams.set('delay', '0');
    endpoint.searchParams.set('_', String(Date.now()));

    try {
      const upstream = await fetch(endpoint.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json,text/plain,*/*',
          'Referer': 'https://mis.twse.com.tw/'
        },
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      if (!upstream.ok) throw new Error('TWSE HTTP ' + upstream.status);
      const data = await upstream.json();
      const quotes = {};
      let market = null;
      const clean = v => {
        if (v === undefined || v === null) return null;
        const s = String(v).replace(/,/g,'').trim();
        if (!s || s === '-') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
      for (const q of (data.msgArray || [])) {
        const code = String(q.c || '').trim();
        let price = clean(q.z);
        const prev = clean(q.y);
        if (price == null) {
          const ask = clean(String(q.a || '').split('_')[0]);
          const bid = clean(String(q.b || '').split('_')[0]);
          if (ask != null && bid != null) price = (ask + bid) / 2;
          else if (prev != null) price = prev;
        }
        if (code === 't00' || String(q.ch || '').includes('t00')) {
          if (price != null && prev != null) market = { price, prev };
        } else if (code && price != null) {
          quotes[code] = {
            code,
            name: q.n || code,
            price,
            prev: prev != null ? prev : price,
            time: q.t || null,
            date: q.d || null
          };
        }
      }
      return Response.json({
        ok: true,
        source: 'TWSE MIS via Cloudflare Worker',
        updated: new Date().toISOString(),
        market,
        quotes
      }, { headers: cors });
    } catch (err) {
      return Response.json({ ok:false, error:String(err?.message || err) }, { status:502, headers:cors });
    }
  }
};
