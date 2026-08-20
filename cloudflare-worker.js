export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store, max-age=0'
    };
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
    if (request.method !== 'GET') return new Response('Method Not Allowed',{status:405,headers:cors});

    // The Worker URL can also be used as the dashboard URL.  Proxy the
    // GitHub Pages UI so its existing /api/quotes request becomes same-origin.
    if (!url.pathname.startsWith('/api/quotes')) {
      const target = new URL('https://jtop2026-max.github.io/kids-investment-dashboard/');
      target.pathname = '/kids-investment-dashboard' + (url.pathname === '/' ? '/' : url.pathname);
      target.search = url.search;
      const r = await fetch(target.toString(), {cf:{cacheTtl:30}});
      const h = new Headers(r.headers);
      h.set('Cache-Control','no-cache');
      return new Response(r.body,{status:r.status,headers:h});
    }

    // Accept both the current frontend parameter (?ch=...) and the newer
    // explicit form (?symbols=...).
    const raw = (url.searchParams.get('symbols') || url.searchParams.get('ch') || '').trim();
    const parts = raw.split('|').map(s=>s.trim()).filter(Boolean);
    const safe = parts.filter(s=>/^(tse|otc)_[0-9A-Za-z]+\.tw$/.test(s));
    if (!safe.includes('tse_t00.tw')) safe.push('tse_t00.tw');
    if (!safe.length || safe.length > 60) return Response.json({ok:false,error:'invalid symbols'},{status:400,headers:cors});

    const endpoint = new URL('https://mis.twse.com.tw/stock/api/getStockInfo.jsp');
    endpoint.searchParams.set('ex_ch',safe.join('|'));
    endpoint.searchParams.set('json','1');
    endpoint.searchParams.set('delay','0');
    endpoint.searchParams.set('_',String(Date.now()));
    try {
      const upstream = await fetch(endpoint.toString(),{
        headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*','Referer':'https://mis.twse.com.tw/'},
        cf:{cacheTtl:0,cacheEverything:false}
      });
      if(!upstream.ok) throw new Error('TWSE HTTP '+upstream.status);
      const data=await upstream.json();
      // Return the native TWSE shape because the existing dashboard already
      // knows how to parse msgArray, z (last), y (previous close), c and ch.
      return Response.json(data,{headers:cors});
    } catch(err) {
      return Response.json({ok:false,error:String(err?.message||err)},{status:502,headers:cors});
    }
  }
};
