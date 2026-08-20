export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/quotes') {
      const raw = (url.searchParams.get('ch') || '').trim();
      const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
      const safe = parts.filter(s => /^(tse|otc)_[0-9A-Za-z]+\.tw$/.test(s));
      if (!safe.includes('tse_t00.tw')) safe.push('tse_t00.tw');
      if (!safe.length || safe.length > 60) {
        return Response.json({ msgArray: [], error: 'invalid channels' }, { status: 400, headers: { 'Cache-Control':'no-store' } });
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
        return Response.json(data, { headers: { 'Cache-Control':'no-store, max-age=0' } });
      } catch (err) {
        return Response.json({ msgArray: [], error: String(err?.message || err) }, { status: 502, headers: { 'Cache-Control':'no-store' } });
      }
    }

    if (env?.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
