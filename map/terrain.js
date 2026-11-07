/* =====================================================================
   map/terrain.js  -  LOS (Line of Sight / sikt). Vad syns fran en punkt?

     const los = MapTerrain.los(view, { url, z, maxTiles, radius, eye, color, alpha, onState,
                                        surface(), chm, buildings, vt, onWarn })
     los.set({ lat, lon } | null)    -> berakna fran punkten (null = av)
     los.setEye(m)                   -> ogonhojd over marken (raknas om)
     los.recompute()                 -> rakna om (t.ex. nar YTA andrats i OPTN)
     los.state()                     -> 'off' | 'busy' | 'ok' | 'fail'
     los.stats()                     -> { visible, total, cell, surface } for senaste berakningen

   Metod (som shadowmap/klassisk viewshed): hojdmosaik tiles x tiles rutor pa
   zoom z kring punkten. Fran ogat (MARKhojd + eye) foljs en strale till varje
   kantcell; langs stralen hals den brantaste vinkeln hittills. En cell SYNS
   om dess vinkel ar minst lika brant - annars skyms den av nagot narmare.
   Jordkrokning + refraktion (k = 0,13) dras av fran hojden. Synligt = gult.

   YTA (surface() = true): det som skymmer ar markmodellen PLUS det hogsta av
     - TRAD: Metas globala tradhojdskarta v2 (~1,2 m, CC-BY-4.0) - molnoptimerade
       GeoTIFF per zoom 10-ruta pa Source Coop; bara de 512 px-block (Deflate)
       som behovs hamtas, pa samma zoom som mosaiken.
     - HUS: OpenStreetMap-byggnader med hojd (render_height) ur OpenFreeMaps
       vektorrutor (zoom 14, kallan vt = MapVT i map/vtiles.js), inom buildings.km fran punkten.
   Ogat star alltid pa marken; inom CLEAR (8 m) runt ogat raknas inga hinder
   (man star invid sitt hus/trad, inte inne i det). Saknas
   trad-/husdata raknas utan dem och onWarn(text) anropas (DIAG LOS-02).
   RACKVIDD = radien (gul cirkel med handtag - dra i den for att andra). Mosaiken
   valjs ur radien: zoom 13 (5 m celler) sa langt maxTiles racker, darefter
   grovre. Saknas markrutor pa z provas z - 1 (ner till 10).
   ===================================================================== */
(function(){
  const R_EARTH = 6371008.8, K_REFR = 0.13, CLEAR = 8;   // CLEAR: fri zon runt ogat (m)

  /* ---- Tradhojd (Meta CHM v2): bara de block som behovs, via HTTP-intervall ---- */
  const tiffCache = new Map(), blockCache = new Map();
  function quadkey(x, y, z){ let q = ''; for(let i = z - 1; i >= 0; i--) q += ((x >> i) & 1) + 2 * ((y >> i) & 1); return q; }
  // Nathamtning med tidsgrans: en server som inte svarar far inte lamna LOS
  // hangande i 'busy' - efter FETCH_MS avbryts den och raknas som fel.
  const FETCH_MS = 25000;
  function fetchT(url, init){
    const ac = new AbortController(), t = setTimeout(function(){ ac.abort(); }, FETCH_MS);
    return fetch(url, Object.assign({ signal: ac.signal }, init || {}))
      .then(function(r){ clearTimeout(t); return r; }, function(e){ clearTimeout(t); throw new Error(e.name === 'AbortError' ? 'timeout' : e.message); });
  }
  function range(url, a, b){
    return fetchT(url, { headers: { Range: 'bytes=' + a + '-' + b } }).then(function(r){
      if(r.status === 404) return null;
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    });
  }
  // Klassisk little-endian TIFF: alla IFD:er (GDAL-COG har dem i forsta 128 kB).
  function tiffHeader(url){
    if(tiffCache.has(url)) return tiffCache.get(url);
    const p = range(url, 0, 131071).then(function(buf){
      if(!buf) return null;
      const dv = new DataView(buf), levels = {};
      let off = dv.getUint32(4, true);
      while(off && off + 2 <= buf.byteLength){
        const n = dv.getUint16(off, true), tg = {};
        for(let k = 0; k < n; k++){
          const e = off + 2 + k * 12, tag = dv.getUint16(e, true), type = dv.getUint16(e + 2, true), cnt = dv.getUint32(e + 4, true);
          const val = type === 3 && cnt === 1 ? dv.getUint16(e + 8, true) : dv.getUint32(e + 8, true);
          tg[tag] = { cnt: cnt, val: val };
        }
        const sub = tg[254] ? tg[254].val : 0;
        if(!(sub & 4) && tg[258] && tg[258].val === 8 && tg[324]){       // inte mask, 8 bitar
          const w = tg[256].val, nt = tg[324].cnt, oo = tg[324].val, co = tg[325].val;
          if(oo + nt * 4 <= buf.byteLength && co + nt * 4 <= buf.byteLength){
            const offs = new Uint32Array(nt), cnts = new Uint32Array(nt);
            for(let i = 0; i < nt; i++){ offs[i] = dv.getUint32(oo + i * 4, true); cnts[i] = dv.getUint32(co + i * 4, true); }
            levels[w] = { ntx: Math.ceil(w / tg[322].val), offs: offs, cnts: cnts };
          }
        }
        off = dv.getUint32(off + 2 + n * 12, true);
      }
      return levels;
    });
    tiffCache.set(url, p);
    p.catch(function(){ tiffCache.delete(url); });
    return p;
  }
  // Tradhojd (m, uint8) for ruta z/x/y som 512x512, eller null (ingen data). z 10-16.
  const inflate = function(buf){
    const st = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(st).arrayBuffer().then(function(a){ return new Uint8Array(a); });
  };
  // Tradhojd (m, uint8) for rutorna x0..x1 pa rad y, zoom z (10-16), som 512x512 vardera
  // (null = ingen data). Blocken ligger radvis efter varandra i filen (GDAL-COG,
  // ROW_MAJOR) - en hel rad inom samma fil hamtas darfor med ETT intervall.
  function canopyRow(tpl, z, x0, x1, y){
    const out = [];
    if(z < 10 || z > 16){ for(let x = x0; x <= x1; x++) out.push(Promise.resolve(null)); return out; }
    const d = z - 10, qy = y >> d;
    let x = x0;
    while(x <= x1){
      // Delrad inom samma zoom 10-fil (samma qx).
      const qx = x >> d, xe = Math.min(x1, ((qx + 1) << d) - 1), xs = x;
      const miss = [];
      for(let k = xs; k <= xe; k++) if(!blockCache.has(z + '/' + k + '/' + y)) miss.push(k);
      if(miss.length){
        const url = tpl.replace('{q}', quadkey(qx, qy, 10));
        const row = tiffHeader(url).then(function(lv){
          const L = lv && lv[512 << d];
          if(!L) return null;
          const idx = function(k){ return (y - (qy << d)) * L.ntx + (k - (qx << d)); };
          const has = miss.filter(function(k){ return L.cnts[idx(k)]; });
          if(!has.length) return { L: L, idx: idx, buf: null, a: 0 };
          const a = Math.min.apply(null, has.map(function(k){ return L.offs[idx(k)]; }));
          const e = Math.max.apply(null, has.map(function(k){ return L.offs[idx(k)] + L.cnts[idx(k)]; }));
          return range(url, a, e - 1).then(function(buf){ return { L: L, idx: idx, buf: buf, a: a }; });
        });
        miss.forEach(function(k){
          const p = row.then(function(r){
            if(!r || !r.buf) return null;
            const i = r.idx(k), n = r.L.cnts[i];
            if(!n) return null;
            const o = r.L.offs[i] - r.a;
            return inflate(r.buf.slice(o, o + n));
          });
          blockCache.set(z + '/' + k + '/' + y, p);
          p.catch(function(){ blockCache.delete(z + '/' + k + '/' + y); });
        });
        if(blockCache.size > 600) blockCache.delete(blockCache.keys().next().value);
      }
      for(let k = xs; k <= xe; k++) out.push(blockCache.get(z + '/' + k + '/' + y));
      x = xe + 1;
    }
    return out;
  }
  function canopy(tpl, z, x, y){ return canopyRow(tpl, z, x, x, y)[0]; }

  /* ---- Byggnader: OpenFreeMap-rutor (zoom 14) via den delade kallan o.vt (map/vtiles.js) ---- */
  function buildingTile(vt, x, y){
    return vt.get(14, x, y).then(function(t){
      if(!t) return null;
      const f = MapMvt.features(t, 'building');
      return { extent: (t.building || {}).extent || 4096, buildings: f.map(function(q){
        const r = q.rings.map(function(r){ const o = []; for(let i = 0; i < r.length; i += 2) o.push([r[i], r[i + 1]]); return o; });
        return { h: q.props.render_height != null ? +q.props.render_height : null, rings: r };
      }) };
    });
  }

  function los(view, o){
    let pt = null, eye = o.eye, state = 'off', result = null, job = 0, radius = o.radius;
    const setState = function(s){ state = s; if(o.onState) o.onState(s); view.redraw(); };
    // Mosaikens storlek ur radien: hogsta zoom (<= o.z) dar 2*half+1 rutor <= o.maxTiles
    // tacker radien. Stor radie -> lagre zoom (grovre celler) sa berakningen inte svaller.
    function halfFor(z){
      const tileM = 40075016.686 * Math.cos(pt.lat * Math.PI / 180) / Math.pow(2, z);
      return Math.ceil(radius / tileM);
    }
    function zoomFor(){
      for(let z = o.z; z > 8; z--) if(2 * halfFor(z) + 1 <= o.maxTiles) return z;
      return 8;
    }

    // Saknas nagon markruta pa zoom z (utanfor kallans hogupplosta omrade) provas
    // z - 1 osv. ner till 10: storre rackvidd, grovre upplosning.
    function compute(z){
      const my = ++job;                               // nyare berakning vinner
      if(!pt){ result = null; layer.loading = null; setState('off'); return; }
      if(z == null) z = zoomFor();
      const half = halfFor(z), tiles = 2 * half + 1;
      setState('busy');
      const P = MapView.project(pt.lon, pt.lat, z);
      const cx = Math.floor(P.x / 256), cy = Math.floor(P.y / 256);
      const surf = o.surface ? o.surface() : false;
      let warn = '';
      const ground = [], trees = [];
      for(let j = -half; j <= half; j++){
        for(let i = -half; i <= half; i++) ground.push(MapDem.get(MapDem.url(o.url, z, cx + i, cy + j)));
        const row = surf ? canopyRow(o.chm, z, cx - half, cx + half, cy + j) : [];
        for(let i = 0; i < tiles; i++){
          trees.push(surf ? row[i].catch(function(e){ warn = 'träd: ' + e.message; return null; }) : Promise.resolve(null));
        }
      }
      // Byggnader inom buildings.km: zoom 14-rutor runt punkten.
      const bld = [];
      if(surf && o.buildings && o.vt){
        const P14 = MapView.project(pt.lon, pt.lat, 14);
        const kmPerTile = 40075.016686 * Math.cos(pt.lat * Math.PI / 180) / Math.pow(2, 14);
        const r = Math.ceil(o.buildings.km / kmPerTile), bx = Math.floor(P14.x / 256), by = Math.floor(P14.y / 256);
        for(let j = -r; j <= r; j++) for(let i = -r; i <= r; i++){
          const x = bx + i, y = by + j;
          bld.push(buildingTile(o.vt, x, y).then(function(t){ return t && { x: x, y: y, t: t }; })
            .catch(function(e){ warn = 'hus: ' + e.message; return null; }));
        }
      }
      // Laddningsbaren (app.js summerar lager med .loading): alla hamtningar for berakningen.
      const all = ground.concat(trees, bld);
      layer.loading = { done: 0, total: all.length };
      all.forEach(function(p){ p.then(function(){ if(my === job && layer.loading){ layer.loading.done++; view.redraw(); } }, function(){}); });
      Promise.all([Promise.all(ground), Promise.all(trees), Promise.all(bld)]).then(function(res){
        if(my !== job) return;
        layer.loading = null;
        const ts = res[0], tr = res[1], bs = res[2];
        const n = (ts.find(function(t){ return t; }) || {}).n;
        if(!n || ts.some(function(t){ return !t || t.n !== n; })){
          if(z > 10){ job--; compute(z - 1); return; }
          result = null; setState('fail'); return;
        }
        // Mosaik W x W pixlar, ovre vanstra horn = ruta (cx-half, cy-half).
        const W = n * tiles, E = new Float32Array(W * W);
        ts.forEach(function(t, k){
          const ox = (k % tiles) * n, oy = Math.floor(k / tiles) * n;
          for(let y = 0; y < n; y++) E.set(t.e.subarray(y * n, y * n + n), (oy + y) * W + ox);
        });
        // Hinder ovanpa marken = max(trad, hus). Tradblocken ar 512 px - samma rutnat som marken.
        const obst = new Float32Array(W * W);
        tr.forEach(function(c, k){
          if(!c || c.length !== n * n) return;
          const ox = (k % tiles) * n, oy = Math.floor(k / tiles) * n;
          for(let y = 0; y < n; y++) for(let x = 0; x < n; x++) obst[(oy + y) * W + ox + x] = c[y * n + x];
        });
        // Husen rastras pa en canvas: grått = hojd i meter, 'lighten' = hogsta vinner.
        if(bs.some(function(b){ return b; })){
          const cv = document.createElement('canvas'); cv.width = cv.height = W;
          const g = cv.getContext('2d');
          g.globalCompositeOperation = 'lighten';
          const tile14 = n * Math.pow(2, z - 14);          // en zoom 14-ruta i mosaikpixlar
          bs.forEach(function(b){
            if(!b) return;
            const ox = (b.x * Math.pow(2, z - 14) - (cx - half)) * n, oy = (b.y * Math.pow(2, z - 14) - (cy - half)) * n;
            const s = tile14 / b.t.extent;
            b.t.buildings.forEach(function(f){
              const h = Math.max(1, Math.min(255, Math.round(f.h == null ? o.buildings.defaultH : f.h)));
              g.fillStyle = 'rgb(' + h + ',' + h + ',' + h + ')';
              g.beginPath();
              f.rings.forEach(function(rg){ rg.forEach(function(q, i){ const X = ox + q[0] * s, Y = oy + q[1] * s; if(i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.closePath(); });
              g.fill('evenodd');
            });
          });
          const px = g.getImageData(0, 0, W, W).data;
          for(let i = 0; i < W * W; i++) if(px[i * 4] > obst[i]) obst[i] = px[i * 4];
        }
        if(o.onWarn) o.onWarn(warn || null);

        // Ogats pixel och meter per pixel (vid punktens latitud). Ogat star pa MARKEN.
        const ex = (P.x / 256 - (cx - half)) * n, ey = (P.y / 256 - (cy - half)) * n;
        const mpp = 40075016.686 * Math.cos(pt.lat * Math.PI / 180) / Math.pow(2, z) / n;
        const ix = Math.max(0, Math.min(W - 1, Math.floor(ex))), iy = Math.max(0, Math.min(W - 1, Math.floor(ey)));
        const h0 = E[iy * W + ix] + eye;
        // Fri zon runt ogat (CLEAR m): det egna huset/tradet ska inte skymma allt -
        // man star pa en oppen plats invid det.
        const cr = Math.ceil(CLEAR / mpp);
        for(let y = Math.max(0, iy - cr); y <= Math.min(W - 1, iy + cr); y++)
          for(let x = Math.max(0, ix - cr); x <= Math.min(W - 1, ix + cr); x++)
            if(Math.hypot(x - ix, y - iy) * mpp <= CLEAR) obst[y * W + x] = 0;
        const vis = new Uint8Array(W * W);
        vis[iy * W + ix] = 1;
        const curv = (1 - K_REFR) / (2 * R_EARTH);
        // En strale per kantcell -> alla celler nas. Ytan = mark + hinder.
        const ray = function(tx, ty){
          const dx = tx - ex, dy = ty - ey, steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
          const sx = dx / steps, sy = dy / steps;
          let maxS = -Infinity;
          for(let s = 1; s <= steps; s++){
            const x = Math.round(ex + sx * s), y = Math.round(ey + sy * s);
            if(x < 0 || y < 0 || x >= W || y >= W) break;
            const k = y * W + x, d = Math.hypot(x - ex, y - ey) * mpp;
            if(d > radius) break;                       // bara inom rackviddscirkeln
            const slope = (E[k] + obst[k] - curv * d * d - h0) / d;
            if(slope >= maxS){ vis[k] = 1; maxS = slope; }
          }
        };
        for(let i = 0; i < W; i++){ ray(i, 0); ray(i, W - 1); ray(0, i); ray(W - 1, i); }
        // Overlagg: synligt = gult, resten genomskinligt.
        const c = document.createElement('canvas'); c.width = c.height = W;
        const g2 = c.getContext('2d'), img = g2.createImageData(W, W), px2 = img.data;
        for(let i = 0; i < W * W; i++){
          if(!vis[i]) continue;
          px2[i * 4] = o.color[0]; px2[i * 4 + 1] = o.color[1]; px2[i * 4 + 2] = o.color[2]; px2[i * 4 + 3] = o.alpha;
        }
        g2.putImageData(img, 0, 0);
        let nv = 0; for(let i = 0; i < W * W; i++) nv += vis[i];
        result = { canvas: c, x0: (cx - half) * 256, y0: (cy - half) * 256, z: z, size: tiles * 256,
                   stats: { visible: nv, total: W * W, cell: mpp, surface: surf } };   // synliga celler (cell = m)
        setState('ok');
      });
    }

    const layer = view.addLayer({ id: 'los', frame: true, visible: true, status: '', loading: null, draw: function(ctx, v){
      if(!result || !pt) return;
      // Mosaikens horn i varldspixlar vid z -> nuvarande zoom.
      const k = Math.pow(2, v.zoom - result.z), tl = v.topLeft();
      ctx.drawImage(result.canvas, result.x0 * k - tl.x, result.y0 * k - tl.y, result.size * k, result.size * k);
    } });

    /* ---- Rackviddscirkeln: gul, med handtag; dra i ringen = andra radien ---- */
    const RES0 = 156543.03392804097;
    const edge = function(){                         // punkt pa ringen rakt osterut
      return { lat: pt.lat, lon: pt.lon + radius / (111319.49 * Math.cos(pt.lat * Math.PI / 180)) };
    };
    view.addLayer({ id: 'losRange', visible: true, status: '', draw: function(ctx, v){
      if(!pt) return;
      const c = v.toScreen(pt.lon, pt.lat), e = edge(), h = v.toScreen(e.lon, e.lat);
      const r = Math.hypot(h.x - c.x, h.y - c.y);
      ctx.save();
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
      ctx.lineWidth = 5; ctx.strokeStyle = o.outline; ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = o.ring; ctx.stroke();
      ctx.fillStyle = o.outline; ctx.fillRect(h.x - 8, h.y - 8, 16, 16);
      ctx.fillStyle = o.ring;    ctx.fillRect(h.x - 6, h.y - 6, 12, 12);
      if(o.fmt){
        const t = 'R ' + o.fmt(radius);
        ctx.font = '18px ViperDisplay'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        const tw = ctx.measureText(t).width, tx = h.x + 14 + tw > v.w ? h.x - 14 - tw : h.x + 14;   // far inte plats: andra sidan
        ctx.lineWidth = 4; ctx.strokeStyle = o.outline; ctx.strokeText(t, tx, h.y);
        ctx.fillStyle = o.ring; ctx.fillText(t, tx, h.y);
      }
      ctx.restore();
    } });
    // Dra i ringen (var som helst pa den, eller handtaget): ny radie, rakna om vid slapp.
    view.onGrab(function(p){
      if(!pt) return null;
      const c = view.toScreen(pt.lon, pt.lat), e = edge(), h = view.toScreen(e.lon, e.lat);
      const r = Math.hypot(h.x - c.x, h.y - c.y), d = Math.hypot(p.x - c.x, p.y - c.y);
      if(Math.abs(d - r) > (o.grabPx || 10)) return null;
      return {
        move: function(q){
          const g = view.toLonLat(q.x, q.y);
          radius = Math.max(o.minRadius, Math.min(o.maxRadius, MapCoords.inverse(pt.lat, pt.lon, g.lat, g.lon).dist));
          if(o.onRadius) o.onRadius(radius);
        },
        up: function(){ compute(); },
      };
    });

    return {
      set: function(p){ pt = p ? { lat: p.lat, lon: p.lon } : null; compute(); },
      radius: function(){ return radius; },
      setRadius: function(m){ radius = m; if(pt) compute(); },
      setEye: function(m){ eye = m; if(pt) compute(); },
      recompute: function(){ if(pt) compute(); },
      state: function(){ return state; },
      active: function(){ return !!pt; },
      stats: function(){ return result && result.stats; },
    };
  }

  window.MapTerrain = { los: los, canopy: canopy };
})();
