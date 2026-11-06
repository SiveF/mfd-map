/* =====================================================================
   map/vtiles.js  -  VEKTORRUTOR I REALTID (OpenFreeMap, OpenMapTiles-schema).
   Inget lagras lokalt: rutorna for det som syns hamtas nar de behovs och
   halls i en minnescache. Ger ROADS, WATER och NAMES full OSM-detalj utan
   forbyggd data (och husen till LOS i map/terrain.js).

     MapMvt.decode(arraybuffer)  -> { lager: { extent, raw } } - lagren avkodas
                                    forst nar de efterfragas:
     MapMvt.features(tile, namn) -> [{ type (1 punkt, 2 linje, 3 yta), props, rings }]
                                    rings = [[x0,y0,x1,y1,...], ...] i 0..extent
     const vt = MapVT(tilejsonUrl, maxZoom)   - kalla (en per app, delas av lagren)
       vt.get(z, x, y) -> Promise<ruta | null>   vt.peek(z, x, y) -> ruta | undefined
     MapLayers.vtLines(vt, { id, layer, styles(props) -> stilnyckel, style: { nyckel: {...} } })
       Linjer/ytor per stil (ordningen i style = ritordning, nederst forst):
       { stroke, width, casing, cwidth, dash, fill }  - bredder i skarm-px
     MapLayers.vtNames(vt, { id, font, colors })  - ortnamn, vattennamn, toppar

   Over kallans maxZoom (14) anvands zoom 14-rutorna, skarpa (de ar vektorer).
   Laddar en ruta ritas narmaste laddade overliggande niva (klippt) i stallet.
   ===================================================================== */
(function(root){
  /* ---- Protobuf / Mapbox Vector Tile ---- */
  function pbf(b, p, end){
    const varint = function(){
      let r = 0, s = 0, c;
      do { c = b[p++]; r += (c & 0x7f) * Math.pow(2, s); s += 7; } while(c & 0x80);
      return r;
    };
    return {
      more: function(){ return p < end; }, varint: varint,
      tag: function(){ const t = varint(); return { f: Math.floor(t / 8), w: t & 7 }; },
      sub: function(){ const n = varint(), s = p; p += n; return [s, p]; },
      str: function(){ const n = varint(), s = p; p += n; return new TextDecoder().decode(b.subarray(s, p)); },
      // OBS: 'p += varint()' laser p fore anropet - langden maste lasas forst.
      skip: function(w){ if(w === 0) varint(); else if(w === 1) p += 8; else if(w === 2){ const n = varint(); p += n; } else if(w === 5) p += 4; },
      f32: function(){ const v = new DataView(b.buffer, b.byteOffset + p, 4).getFloat32(0, true); p += 4; return v; },
      f64: function(){ const v = new DataView(b.buffer, b.byteOffset + p, 8).getFloat64(0, true); p += 8; return v; },
    };
  }
  const zz = function(n){ return (n % 2) ? -(n + 1) / 2 : n / 2; };
  function packed(b, r){ const q = pbf(b, r[0], r[1]), out = []; while(q.more()) out.push(q.varint()); return out; }
  function value(b, r){
    const q = pbf(b, r[0], r[1]);
    let v = null;
    while(q.more()){
      const t = q.tag();
      if(t.f === 1) v = q.str();
      else if(t.f === 2) v = q.f32();
      else if(t.f === 3) v = q.f64();
      else if(t.f === 4 || t.f === 5) v = q.varint();
      else if(t.f === 6) v = zz(q.varint());
      else if(t.f === 7) v = !!q.varint();
      else q.skip(t.w);
    }
    return v;
  }

  // Bara lagrens namn och bytegranser - resten avkodas vid behov (features()).
  function decode(buf){
    const b = new Uint8Array(buf), q = pbf(b, 0, b.length), layers = {};
    while(q.more()){
      const t = q.tag();
      if(t.f !== 3 || t.w !== 2){ q.skip(t.w); continue; }
      const r = q.sub(), L = pbf(b, r[0], r[1]);
      let name = '';
      while(L.more()){ const u = L.tag(); if(u.f === 1) name = L.str(); else L.skip(u.w); }
      layers[name] = { raw: r, b: b, feats: null, extent: 4096 };
    }
    return layers;
  }

  function features(tile, name){
    const l = tile && tile[name];
    if(!l) return [];
    if(l.feats) return l.feats;
    const b = l.b, L = pbf(b, l.raw[0], l.raw[1]), keys = [], vals = [], fr = [];
    while(L.more()){
      const u = L.tag();
      if(u.f === 2) fr.push(L.sub());
      else if(u.f === 3) keys.push(L.str());
      else if(u.f === 4) vals.push(value(b, L.sub()));
      else if(u.f === 5) l.extent = L.varint();
      else L.skip(u.w);
    }
    l.feats = fr.map(function(r){
      const F = pbf(b, r[0], r[1]);
      let tags = [], geom = [], type = 0;
      while(F.more()){
        const u = F.tag();
        if(u.f === 2) tags = packed(b, F.sub());
        else if(u.f === 3) type = F.varint();
        else if(u.f === 4) geom = packed(b, F.sub());
        else F.skip(u.w);
      }
      const props = {};
      for(let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      const rings = []; let x = 0, y = 0, ring = null;
      for(let i = 0; i < geom.length;){
        const cmd = geom[i] & 7, cnt = geom[i] >> 3; i++;
        if(cmd === 7){ if(ring) ring.push(ring[0], ring[1]); continue; }   // ClosePath
        for(let k = 0; k < cnt; k++){
          x += zz(geom[i++]); y += zz(geom[i++]);
          if(cmd === 1){ ring = [x, y]; rings.push(ring); } else ring.push(x, y);
        }
      }
      return { type: type, props: props, rings: rings };
    });
    l.b = null;                                       // bytes behovs inte langre for lagret
    return l.feats;
  }
  root.MapMvt = { decode: decode, features: features };

  /* ---- Kallan: tilejson -> URL-mall, rutor i en LRU-cache ---- */
  const FETCH_MS = 20000;
  function MapVT(tilejson, maxZoom, maxTiles){
    const cache = new Map();
    let tpl = null, okCount = 0;
    const src = { maxZoom: maxZoom || 14, status: '' };
    const fetchT = function(url){
      const ac = new AbortController(), t = setTimeout(function(){ ac.abort(); }, FETCH_MS);
      return fetch(url, { signal: ac.signal }).finally(function(){ clearTimeout(t); });
    };
    src.get = function(z, x, y){
      const k = z + '/' + x + '/' + y;
      if(cache.has(k)){ const e = cache.get(k); cache.delete(k); cache.set(k, e); return e.p; }
      if(!tpl) tpl = fetchT(tilejson).then(function(r){ return r.json(); }).then(function(j){ return j.tiles[0]; })
        .catch(function(e){ tpl = null; throw e; });
      const e = { p: null, tile: undefined };
      e.p = tpl.then(function(t){ return fetchT(t.replace('{z}', z).replace('{x}', x).replace('{y}', y)); })
        .then(function(r){
          if(r.status === 404 || r.status === 204) return null;
          if(!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(function(buf){ okCount++; src.status = ''; e.tile = buf ? decode(buf) : null; return e.tile; },
              function(err){ cache.delete(k); if(!okCount) src.status = 'OFFL'; e.tile = null; throw err; });
      cache.set(k, e);
      // ponytail: minnescache med tak, ingen diskcache - varje start hamtar om.
      if(cache.size > (maxTiles || 400)) cache.delete(cache.keys().next().value);
      return e.p;
    };
    // Laddad ruta (null = finns inte), undefined = inte laddad (an).
    src.peek = function(z, x, y){ const e = cache.get(z + '/' + x + '/' + y); return e ? e.tile : undefined; };
    return src;
  }
  root.MapVT = MapVT;

  // Rutorna i bild for en vy: [{ z, x (lindad), sx, sy (rutans horn, ovridet), ts }].
  // Vriden vy (lager utan frame): hela diagonalen runt mitten, sa hornen ocksa tacks.
  function visibleTiles(vt, view){
    const z = Math.max(0, Math.min(vt.maxZoom, Math.floor(view.zoom)));
    const ts = 256 * Math.pow(2, view.zoom - z), n = Math.pow(2, z), t0 = view.topLeft();
    const D = view.rot ? Math.hypot(view.w, view.h) : 0, W = D || view.w, H = D || view.h;
    const tl = { x: t0.x + (view.w - W) / 2, y: t0.y + (view.h - H) / 2 };
    const out = [];
    const x0 = Math.floor(tl.x / ts), x1 = Math.floor((tl.x + W) / ts);
    const y0 = Math.max(0, Math.floor(tl.y / ts)), y1 = Math.min(n - 1, Math.floor((tl.y + H) / ts));
    for(let y = y0; y <= y1; y++) for(let x = x0; x <= x1; x++)
      out.push({ z: z, x: ((x % n) + n) % n, y: y, sx: x * ts - t0.x, sy: y * ts - t0.y, ts: ts });
    return out;
  }
  // Rutan, eller narmaste laddade forfader (med vilken del av den som tacker rutan).
  function tileOrParent(vt, t, layer){
    const own = vt.peek(t.z, t.x, t.y);
    // Varje lager som vantar pa rutan far sin egen signal (vt.get delar hamtningen) -
    // annars far bara det lager som fragade forst veta nar rutan kommit.
    if(own === undefined){
      const k = t.z + '/' + t.x + '/' + t.y, w = layer._wait || (layer._wait = new Set());
      if(!w.has(k)){
        w.add(k);
        const again = function(){ w.delete(k); if(layer.redraw) layer.redraw(); };
        vt.get(t.z, t.x, t.y).then(again, again);
      }
    }
    if(own !== undefined) return { tile: own, ready: true, z: t.z, x: t.x, y: t.y };
    for(let d = 1; d <= 4 && t.z - d >= 0; d++){
      const k = Math.pow(2, d), up = vt.peek(t.z - d, Math.floor(t.x / k), Math.floor(t.y / k));
      if(up) return { tile: up, ready: false, z: t.z - d, x: Math.floor(t.x / k), y: Math.floor(t.y / k) };
    }
    return { tile: null, ready: false };
  }

  /* ---- Linjer och ytor (ROADS, WATER) ----
     Path2D per (ruta, stil) i rutans egna koordinater - en ritning ar darfor bara
     en transform + stroke per stil och ruta, aven vid hog zoom. */
  function vtLines(vt, o){
    const order = Object.keys(o.style);
    const L = { id: o.id, frame: true, visible: o.visible !== false, status: '', loading: null };
    const paths = new WeakMap();                       // ruta -> { stil: Path2D }
    function pathsFor(tile){
      let p = paths.get(tile);
      if(p) return p;
      p = {};
      const add = function(f, key){
        const st = o.style[key];
        if(!st || f.type !== (st.fill ? 3 : 2)) return;
        const P = p[key] || (p[key] = new Path2D());
        f.rings.forEach(function(r){ P.moveTo(r[0], r[1]); for(let i = 2; i < r.length; i += 2) P.lineTo(r[i], r[i + 1]); });
      };
      [].concat(o.layer).forEach(function(name){
        features(tile, name).forEach(function(f){ const key = o.styles(f.props, name, f.type); if(key) add(f, key); });
      });
      paths.set(tile, p);
      return p;
    }
    L.draw = function(ctx, view){
      const ts = visibleTiles(vt, view), k = o.scale ? o.scale(view.zoom) : 1;
      let done = 0;
      const jobs = [];
      ts.forEach(function(t){
        const r = tileOrParent(vt, t, L);
        if(r.ready) done++;
        if(!r.tile) return;
        const p = pathsFor(r.tile), ext = (r.tile[[].concat(o.layer)[0]] || {}).extent || 4096;
        // Rutans (eller forfaderns) horn och skala pa skarmen. Klipps alltid till rutan:
        // rutornas buffertzoner overlappar, och halvgenomskinligt fick annars dubbel tathet.
        const f = Math.pow(2, t.z - r.z), size = t.ts * f;
        jobs.push({ p: p, x: t.sx - (t.x - r.x * f) * t.ts, y: t.sy - (t.y - r.y * f) * t.ts,
                    s: size / ext, clip: [t.sx, t.sy, t.ts] });
      });
      ctx.lineJoin = 'round';
      // Per ruta (klippt EN gang): kontur (casing) for alla stilar forst, sedan linjerna -
      // korsningar blir rena. Klippningen gor att rutornas ordning inte spelar roll.
      jobs.forEach(function(j){
        ctx.save();
        ctx.beginPath(); ctx.rect(j.clip[0], j.clip[1], j.clip[2], j.clip[2]); ctx.clip();
        ctx.translate(j.x, j.y); ctx.scale(j.s, j.s);
        ['casing', 'line'].forEach(function(pass){
          order.forEach(function(key){
            const st = o.style[key], P = j.p[key];
            if(!P || (pass === 'casing' && !st.casing)) return;
            if(st.fill && pass === 'line'){ ctx.fillStyle = st.fill; ctx.fill(P, 'evenodd'); }
            const w = (pass === 'casing' ? st.cwidth : st.width) * k;
            if(w && (pass === 'casing' || st.stroke)){
              ctx.lineWidth = w / j.s;
              ctx.lineCap = st.dash ? 'butt' : 'round';
              ctx.setLineDash(st.dash && pass === 'line' ? st.dash.map(function(d){ return d * k / j.s; }) : []);
              ctx.strokeStyle = pass === 'casing' ? st.casing : st.stroke;
              ctx.stroke(P);
            }
          });
        });
        ctx.restore();
      });
      L.status = vt.status;
      L.loading = done < ts.length ? { done: done, total: ts.length } : null;
    };
    return L;
  }

  /* ---- Namn: orter, vattennamn och toppar (hojd) ----
     Viktigast forst (klass, sedan rank); ett namn som skulle krocka med ett
     redan ritat hoppas over. Ritas uppratt aven nar kartan ar vriden. VERSALER -
     ViperDisplay har bara versaler (gemena a/a/o blir annars sma). */
  const PLACE = {                                       // klass -> [prioritet, storlek, markor, dim]
    country: [0, 22, false, false], state: [2, 16, false, true], city: [1, 22, true, false],
    town: [3, 19, true, false], village: [4, 17, true, false], suburb: [5, 15, false, false],
    hamlet: [6, 15, true, false], island: [6, 15, false, false], quarter: [7, 14, false, true],
    neighbourhood: [8, 14, false, true], isolated_dwelling: [9, 13, true, true], locality: [9, 13, false, true],
  };
  // Namnet i latinsk skrift (ViperDisplay saknar t.ex. kyrilliska), versaler.
  const nameOf = function(p){ return String(p['name:latin'] || p.name).toUpperCase(); };
  function vtNames(vt, o){
    const L = { id: o.id, visible: o.visible !== false, status: '', loading: null };
    // Skarmcache: namnen placeras och ritas EN gang pa en yta med en kvarts skarm
    // marginal; panorering = en drawImage. Ny placering vid ny zoom (150 ms efter
    // sista hjulsteget - under tiden skalas den gamla bilden), vridning, storlek,
    // nya rutor eller nar man drar utanfor marginalen.
    let cache = null, dirty = true, timer = null, lastZ = null;
    const owner = { redraw: function(){ dirty = true; if(L.redraw) L.redraw(); } };
    L.invalidate = owner.redraw;
    const lab = new WeakMap(), widths = new Map();
    // En rutas namn (en gang): [{ pri, rank, size, text, lon, lat, marker, color, peak }]
    function labelsFor(tile, z, x, y){
      let a = lab.get(tile);
      if(a) return a;
      a = [];
      const at = function(f, ext){
        const r = f.rings[0];
        if(!r) return null;
        const m = Math.floor(r.length / 4) * 2;             // linje: mittpunkten
        return root.MapView.unproject((x + r[m] / ext) * 256, (y + r[m + 1] / ext) * 256, z);
      };
      const ext = function(name){ return (tile[name] || {}).extent || 4096; };
      features(tile, 'place').forEach(function(f){
        const c = PLACE[f.props.class], ll = c && f.props.name && at(f, ext('place'));
        if(!ll) return;
        a.push({ pri: c[0], rank: f.props.rank || 99, size: c[1], text: nameOf(f.props), lon: ll.lon, lat: ll.lat,
                 marker: c[2], color: c[3] ? o.colors.dim : o.colors.text });
      });
      features(tile, 'water_name').forEach(function(f){
        const ll = f.props.name && at(f, ext('water_name'));
        if(ll) a.push({ pri: 5, rank: f.props.rank || 99, size: 15, text: nameOf(f.props), lon: ll.lon, lat: ll.lat, color: o.colors.water });
      });
      if(z >= 10) features(tile, 'mountain_peak').forEach(function(f){      // utzoomat blir topparna for manga
        const ll = f.props.name && at(f, ext('mountain_peak'));
        if(!ll) return;
        const ele = f.props.ele != null ? ' ' + Math.round(f.props.ele) : '';
        a.push({ pri: 6, rank: f.props.rank || 99, size: 14, text: nameOf(f.props) + ele, lon: ll.lon, lat: ll.lat, peak: true, color: o.colors.text });
      });
      lab.set(tile, a);
      return a;
    }
    const width = function(ctx, t, size){
      const k = size + '|' + t;
      let w = widths.get(k);
      if(w == null){ w = ctx.measureText(t).width; widths.set(k, w); if(widths.size > 5000) widths.clear(); }
      return w;
    };
    function place(ctx, view){
      const ts = visibleTiles(vt, view);
      let all = [], done = 0;
      const seen = new Set();
      ts.forEach(function(t){
        const r = tileOrParent(vt, t, owner);
        if(r.ready) done++;
        if(!r.tile) return;
        labelsFor(r.tile, r.z, r.x, r.y).forEach(function(l){
          const k = l.text + '|' + l.lon.toFixed(4) + '|' + l.lat.toFixed(4);   // samma namn i rutornas buffertzon
          if(!seen.has(k)){ seen.add(k); all.push(l); }
        });
      });
      all.sort(function(a, b){ return a.pri - b.pri || a.rank - b.rank; });
      // Krockar via ett rutnat (64 px): bara rutorna som ladan tacker provas.
      const G = 64, grid = new Map();
      let placed = 0;
      const cells = function(b, fn){
        for(let gx = Math.floor(b[0] / G); gx <= Math.floor(b[2] / G); gx++)
          for(let gy = Math.floor(b[1] / G); gy <= Math.floor(b[3] / G); gy++) if(fn(gx * 65536 + gy) === true) return true;
        return false;
      };
      const hits = function(b){
        return cells(b, function(k){
          const c = grid.get(k);
          return !!c && c.some(function(q){ return b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]; });
        });
      };
      const put = function(b){ cells(b, function(k){ const c = grid.get(k); if(c) c.push(b); else grid.set(k, [b]); }); placed++; };
      ctx.save();
      ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for(let i = 0; i < all.length && placed < 900; i++){
        const l = all[i], p = view.toScreen(l.lon, l.lat);
        if(p.x < -40 || p.y < -20 || p.x > view.w + 40 || p.y > view.h + 20) continue;
        ctx.font = l.size + 'px ' + (o.font || 'ViperDisplay');
        const w = width(ctx, l.text, l.size), h = l.size / 2 + 3;
        const left = l.marker || l.peak;                 // med markor: texten till hoger om punkten
        const bx = left ? [p.x - 5, p.x + 10 + w] : [p.x - w / 2 - 3, p.x + w / 2 + 3];
        const box = [bx[0], p.y - h, bx[1], p.y + h];
        if(hits(box)) continue;
        put(box);
        if(l.marker){
          ctx.fillStyle = o.colors.outline; ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
          ctx.fillStyle = l.color;          ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
        }
        if(l.peak){
          ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 5, p.y + 4); ctx.lineTo(p.x - 5, p.y + 4); ctx.closePath();
          ctx.lineWidth = 3; ctx.strokeStyle = o.colors.outline; ctx.stroke();
          ctx.fillStyle = l.color; ctx.fill();
        }
        ctx.textAlign = left ? 'left' : 'center';
        const tx = left ? p.x + 9 : p.x;
        ctx.lineWidth = 4; ctx.strokeStyle = o.colors.outline; ctx.strokeText(l.text, tx, p.y);
        ctx.fillStyle = l.color; ctx.fillText(l.text, tx, p.y);
      }
      ctx.restore();
      L.status = vt.status;
      L.loading = done < ts.length ? { done: done, total: ts.length } : null;
    }

    L.draw = function(ctx, view){
      const c = cache;
      if(c && c.rot === view.rot && c.w === view.w && c.h === view.h){
        // Cachens mitt (lon/lat) lag pa skarmens mitt - var hamnar den nu?
        const p = view.toScreen(c.lon, c.lat), f = Math.pow(2, view.zoom - c.zoom);
        const lw = c.w + 2 * c.mx, lh = c.h + 2 * c.my;     // ytans storlek i logiska px
        if(f !== 1 && !dirty){
          ctx.drawImage(c.c, p.x - (c.w / 2 + c.mx) * f, p.y - (c.h / 2 + c.my) * f, lw * f, lh * f);
          // Bara nar zoomen andrats startas timern om (omritningar far inte skjuta upp den).
          if(view.zoom !== lastZ){ lastZ = view.zoom; clearTimeout(timer); timer = setTimeout(owner.redraw, 150); }
          return;
        }
        const dx = p.x - c.w / 2, dy = p.y - c.h / 2;
        if(!dirty && Math.abs(dx) <= c.mx && Math.abs(dy) <= c.my){ ctx.drawImage(c.c, dx - c.mx, dy - c.my, lw, lh); return; }
      }
      const mx = Math.round(view.w / 4), my = Math.round(view.h / 4);
      const cv = c ? c.c : document.createElement('canvas');
      const r = view.dpr || 1;
      cv.width = (view.w + 2 * mx) * r; cv.height = (view.h + 2 * my) * r;   // nollstaller ocksa ytan
      const tl = view.topLeft(), sub = Object.create(view);
      sub.w = view.w + 2 * mx; sub.h = view.h + 2 * my;
      sub.topLeft = function(){ return { x: tl.x - mx, y: tl.y - my }; };
      sub.toScreen = function(lon, lat){ const q = view.toScreen(lon, lat); return { x: q.x + mx, y: q.y + my }; };
      dirty = false;
      const cg = cv.getContext('2d');
      cg.setTransform(r, 0, 0, r, 0, 0);
      place(cg, sub);
      cache = { c: cv, rot: view.rot, w: view.w, h: view.h, zoom: view.zoom, lon: view.lon, lat: view.lat, mx: mx, my: my };
      ctx.drawImage(cv, -mx, -my, view.w + 2 * mx, view.h + 2 * my);
    };
    return L;
  }

  root.MapLayers = Object.assign(root.MapLayers || {}, { vtLines: vtLines, vtNames: vtNames });
})(typeof window !== 'undefined' ? window : globalThis);
