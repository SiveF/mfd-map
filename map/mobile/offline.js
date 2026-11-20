/* map/mobile/offline.js - OFFL: rutorna inom en rektangel sparas pa telefonen (Cache API, CACHE).
   sw.js svarar med en sparad ruta fore natet. LM/LMGR sparas under gpkg.js egen nyckel; den
   letar i alla cachar, sa sparade omraden rensas inte av LM-cachens tak.
     MapOffline.raster(l) / .dem(url, max) / .gpkg(url, max) / .vt(tilejson, max) -> Promise<kalla>
       kalla = { max, key(z, x, y), get(z, x, y) -> Promise<Response | null> }  null = rutan finns inte
     MapOffline.count(kallor, box, Z)  -> antal rutor niva 0..Z   box = { w, e, s, n } (grader)
     MapOffline.depth(kallor, box, tak) -> hogsta Z som ryms under taket (-1 = inte ens niva 0)
     MapOffline.save(kallor, box, Z, steg(klara, alla, fel)) -> { cancel(), done: Promise<{ ok, fail, full }> }
       fail = misslyckade rutor, utom nivaer som inte finns (allt fel dar, men kallan fungerar lagre ner)
   ponytail: sparade omraden tas aldrig bort och fornyas aldrig. Lagg till en rensning nar
   telefonen fylls (OFFL FULL) eller kartorna blir gamla. */
(function(root){
  const CACHE = 'mfd-offline', AT_ONCE = 6;

  function range(b, z){
    const n = Math.pow(2, z), c = function(v){ return Math.max(0, Math.min(n - 1, Math.floor(v))); };
    const X = function(lon){ return (lon + 180) / 360 * n; };
    const Y = function(lat){ const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; };
    return [c(X(b.w)), c(X(b.e)), c(Y(b.n)), c(Y(b.s))];
  }
  function count(srcs, b, Z){
    let t = 0;
    srcs.forEach(function(s){
      for(let z = 0; z <= Math.min(Z, s.max); z++){ const r = range(b, z); t += (r[1] - r[0] + 1) * (r[3] - r[2] + 1); }
    });
    return t;
  }
  function depth(srcs, b, cap){
    for(let Z = 19; Z >= 0; Z--) if(count(srcs, b, Z) <= cap) return Z;
    return -1;
  }

  // Natet: 404/204 = rutan finns inte (Esri blankTile=false), ovriga fel = misslyckad ruta.
  const net = function(url){
    return fetch(url, { mode: 'cors' }).then(function(r){
      if(r.status === 404 || r.status === 204) return null;
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    });
  };
  const xyz = function(tpl, z, x, y){ return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); };
  const urlSrc = function(f, max){ return { max: max, key: f, get: function(z, x, y){ return net(f(z, x, y)); } }; };

  // Samma adress som layers.js tileLayer bygger - annars hittar sw.js inte rutan.
  function raster(l){
    const subs = l.subdomains || 'abc';
    return Promise.resolve(urlSrc(function(z, x, y){
      return xyz(l.url.replace('{s}', subs[(x + y) % subs.length]), z, x, y).replace('{key}', l.key || '');
    }, l.maxZoom == null ? 19 : l.maxZoom));
  }
  function dem(url, max){ return Promise.resolve(urlSrc(function(z, x, y){ return xyz(url, z, x, y); }, max)); }
  // tilejson sparas ocksa, med x-mfd-net: sw.js fragar natet forst (mallen byts nar OpenFreeMap uppdaterar).
  function vt(tilejson, max){
    return Promise.all([fetch(tilejson).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }), caches.open(CACHE)])
      .then(function(a){
        return a[1].put(tilejson, new Response(a[0], { headers: { 'Content-Type': 'application/json', 'x-mfd-net': '1' } }))
          .then(function(){ const tpl = JSON.parse(a[0]).tiles[0]; return urlSrc(function(z, x, y){ return xyz(tpl, z, x, y); }, max); });
      });
  }
  function gpkg(url, max){
    const G = root.MapGpkg(url), name = url.split('/').pop();
    return Promise.resolve({ max: max,
      key: function(z, x, y){ return '/lm-tiles/' + name + '/' + z + '/' + x + '/' + y; },
      get: function(z, x, y){ return G.tile(z, x, y).then(function(b){ return b ? new Response(b) : null; }); } });
  }

  function save(srcs, b, Z, step){
    const jobs = [];
    srcs.forEach(function(s, k){
      for(let z = 0; z <= Math.min(Z, s.max); z++){
        const r = range(b, z);
        for(let x = r[0]; x <= r[1]; x++) for(let y = r[2]; y <= r[3]; y++) jobs.push([s, z, x, y, k]);
      }
    });
    let stop = false, i = 0, ok = 0, fail = 0, full = false;
    // Ok/fel per kalla och niva. En niva dar ALLT misslyckas men kallan fungerar lagre ner finns inte
    // (Esri SAT nar inte z19 overallt och svarar da utan CORS - ser ut som natfel). Inte FAIL.
    const lv = {};
    const tally = function(j, good){ const k = j[4] + '/' + j[1], e = lv[k] || (lv[k] = { k: j[4], z: j[1], ok: 0, fail: 0 }); e[good ? 'ok' : 'fail']++; };
    const realFail = function(){
      return Object.keys(lv).reduce(function(n, key){
        const e = lv[key];
        const missing = !e.ok && Object.keys(lv).some(function(q){ return lv[q].k === e.k && lv[q].z < e.z && lv[q].ok; });
        return n + (missing ? 0 : e.fail);
      }, 0);
    };
    const done = caches.open(CACHE).then(function(c){
      const one = function(){
        if(stop || full || i >= jobs.length) return Promise.resolve();
        const j = jobs[i++], key = j[0].key(j[1], j[2], j[3]);
        return c.match(key).then(function(hit){
          if(hit) return;
          return j[0].get(j[1], j[2], j[3]).then(function(res){ if(res) return c.put(key, res); });
        }).then(function(){ ok++; tally(j, true); }, function(e){ if(e && e.name === 'QuotaExceededError') full = true; fail++; tally(j, false); })
          .then(function(){ step(ok + fail, jobs.length, fail); return one(); });
      };
      const w = [];
      for(let k = 0; k < AT_ONCE; k++) w.push(one());
      return Promise.all(w).then(function(){ return { ok: ok, fail: realFail(), full: full }; });
    });
    return { cancel: function(){ stop = true; }, done: done };
  }

  root.MapOffline = { CACHE: CACHE, raster: raster, dem: dem, gpkg: gpkg, vt: vt, count: count, depth: depth, save: save, range: range };
})(typeof window !== 'undefined' ? window : globalThis);
