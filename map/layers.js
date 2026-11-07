/* =====================================================================
   map/layers.js  -  KARTLAGER. Varje lager foljer samma kontrakt:

     { id, visible, status, draw(ctx, view) }

   status = kort text (max 4 tecken) som OSB:erna kan visa, '' = allt ok.
   loading = { done, total } medan lagret laddar, annars null (valfritt).
   view = MapView (map/mapview.js). MapView satter layer.redraw nar lagret
   laggs till, sa asynkrona lager kan be om omritning. frame:true = lagret ar
   bundet till kartans rutnat och ritas ovridet i en vriden ram (se mapview.js).

   Nytt lager/ny kartkalla = ny fabrik har som returnerar ett sadant objekt.
   ===================================================================== */
(function(root){

  // Tak for minnescacherna. Telefonappen sanker dem (MapLayers.limits) innan lagren skapas -
  // iOS stanger sidan om den tar for mycket minne. Pa datorn galler dessa.
  const limits = { rasterTiles: 300, demTiles: 500, demProducts: 300, contourSS: 4 };

  // Safari saknar ctx.filter: samma filter med blandningslagen, i filtrets ordning. Klarar
  // invert, grayscale och brightness <= 1 - det som kartorna behover. Ovriga hoppas over.
  function softFilter(g, w, h, f){
    const fill = function(op, col){ g.globalCompositeOperation = op; g.fillStyle = col; g.fillRect(0, 0, w, h); };
    (f.match(/[a-z-]+\([^)]*\)/g) || []).forEach(function(part){
      const v = parseFloat(part.slice(part.indexOf('(') + 1));
      if(part.indexOf('invert') === 0) fill('difference', 'rgb(255,255,255)');
      else if(part.indexOf('grayscale') === 0) fill('saturation', 'rgb(0,0,0)');
      else if(part.indexOf('brightness') === 0){ const c = Math.round(255 * Math.min(1, v)); fill('multiply', 'rgb(' + c + ',' + c + ',' + c + ')'); }
    });
    g.globalCompositeOperation = 'source-over';
  }

  /* ---- XYZ-raster (OSM-stil URL: {z}/{x}/{y}, {s} = subdoman, {key}) ----
     o = { id, url, key, subdomains, maxZoom, attribution, filter, blend }
     L.dim (0-1) = extra ljusstyrka ovanpa filter (dimmern for SAT). blend = canvas
     globalCompositeOperation for overlagg; standard vanlig ritning.
     URL med {key} och tom nyckel -> lagret ritar inget, status 'NKEY'.
     gpkg = adress till en GeoPackage (map/gpkg.js) i stallet for url; utan giltig
     inloggning ritas inget, status 'NKEY'.
     Saknas en ruta (laddfel) eller laddar den fortfarande ritas narmaste
     overliggande niva som finns, forstorad - aldrig ett svart hal. Kallor som
     annars svarar med en "saknas"-bild (Esri) ska darfor ge fel, t.ex. med
     ?blankTile=false. status 'OFFL' = ingen ruta alls har gatt att hamta. */
  function tileLayer(o){
    const cache = new Map();
    let okCount = 0;
    const subs = o.subdomains || 'abc';
    const maxZ = o.maxZoom == null ? 19 : o.maxZoom;
    const src = o.gpkg ? root.MapGpkg(o.gpkg) : null;
    const noKey = !src && o.url.indexOf('{key}') >= 0 && !o.key;
    const L = { id: o.id || 'tiles', frame: true, visible: o.visible !== false, status: noKey ? 'NKEY' : '',
                attribution: o.attribution || '' };
    if(src) root.MapGpkg.onToken(function(){ cache.clear(); okCount = 0; L.status = ''; if(L.redraw) L.redraw(); });

    function url(z, x, y){
      return o.url.replace('{s}', subs[(x + y) % subs.length]).replace('{z}', z)
        .replace('{x}', x).replace('{y}', y).replace('{key}', o.key || '');
    }
    // Filtrerad kopia per ruta, gjord EN gang: ctx.filter vid varje drawImage ar dyrt
    // (varje panorering filtrerade om alla rutor). Ny filtertext (dimmern) -> ny kopia.
    function filtered(img, f){
      if(!f) return img;
      if(img._fk !== f){
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        if('filter' in g){ g.filter = f; g.drawImage(img, 0, 0); }
        else { g.drawImage(img, 0, 0); softFilter(g, c.width, c.height, f); }
        img._f = c; img._fk = f;
      }
      return img._f;
    }
    function tile(z, x, y){
      const k = z + '/' + x + '/' + y;
      let img = cache.get(k);
      if(img){ cache.delete(k); cache.set(k, img); return img; }   // LRU: senast anvand sist
      img = new Image();
      img.onload = function(){ okCount++; L.status = ''; if(img._blob) URL.revokeObjectURL(img.src); if(L.redraw) L.redraw(); };
      // ponytail: offline mitt i en session syns inte som OFFL (saknade rutor ar normalt).
      img.onerror = function(){ if(!okCount) L.status = 'OFFL'; if(L.redraw) L.redraw(); };
      if(src){
        // Bild utan src raknas som complete - _wait = rutan ar pa vag fran filen.
        img._wait = true;
        src.tile(z, x, y).then(function(b){
          img._wait = false;
          if(b){ img._blob = true; img.src = URL.createObjectURL(b); }   // annars finns rutan inte
          else if(L.redraw) L.redraw();
        }, function(e){
          img._wait = false;
          if(e.status === 401 || e.status === 403) L.status = 'NKEY';
          else if(!okCount) L.status = 'OFFL';
          if(L.redraw) L.redraw();
        });
      }
      else img.src = url(z, x, y);
      cache.set(k, img);
      // ponytail: minnescache med tak. Bara gpkg-rutor sparas pa disk (map/gpkg.js).
      if(cache.size > limits.rasterTiles) cache.delete(cache.keys().next().value);
      return img;
    }

    L.draw = function(ctx, view){
      if(noKey) return;
      if(src && !src.ready()){ L.status = 'NKEY'; L.loading = null; return; }
      const top = src && src.maxZoom != null ? src.maxZoom : maxZ;
      const z = Math.max(0, Math.min(top, Math.round(view.zoom)));
      const ts = 256 * Math.pow(2, view.zoom - z), n = Math.pow(2, z), tl = view.topLeft();
      // t.ex. 'brightness(.6)' eller 'invert(1) hue-rotate(180deg)' for ljusa kallor, plus dimmern
      const f = ((o.filter || '') + (L.dim != null && L.dim !== 1 ? ' brightness(' + L.dim + ')' : '')).trim();
      if(o.blend) ctx.globalCompositeOperation = o.blend;
      const x0 = Math.floor(tl.x / ts), x1 = Math.floor((tl.x + view.w) / ts);
      const y0 = Math.max(0, Math.floor(tl.y / ts)), y1 = Math.min(n - 1, Math.floor((tl.y + view.h) / ts));
      let total = 0, done = 0;
      for(let y = y0; y <= y1; y++){
        for(let x = x0; x <= x1; x++){
          const img = tile(z, ((x % n) + n) % n, y);   // x lindas runt datumlinjen
          total++;
          if(img.complete && !img._wait) done++;       // complete = laddad ELLER misslyckad
          // 1 px overlapp - annars syns tunna sommar vid brakzoom
          const dx = Math.floor(x * ts - tl.x), dy = Math.floor(y * ts - tl.y), dw = Math.ceil(ts) + 1;
          if(img.complete && img.naturalWidth){ ctx.drawImage(filtered(img, f), dx, dy, dw, dw); continue; }
          // Reserv: narmaste forfader som ar laddad, rattdelen forstorad.
          const wx = ((x % n) + n) % n;
          for(let d = 1; d <= 6 && z - d >= 0; d++){
            // Ur en fil kostar varje ruta anrop: hamta bara nivan tva steg upp (en sextondel
            // sa manga rutor, snabb forhandsbild). Ovriga nivaer anvands om de redan finns.
            const k = Math.pow(2, d), ux = Math.floor(wx / k), uy = Math.floor(y / k);
            const up = src && d !== 2 ? cache.get((z - d) + '/' + ux + '/' + uy) : tile(z - d, ux, uy);
            if(up && up.complete && up.naturalWidth){
              const sw = up.naturalWidth / k;
              ctx.drawImage(filtered(up, f), (wx % k) * sw, (y % k) * sw, sw, sw, dx, dy, dw, dw);
              break;
            }
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      // Laddningsgrad for rutorna i bild - app.js visar den i laddningsbaren.
      L.loading = done < total ? { done: done, total: total } : null;
    };
    return L;
  }

  /* ---- Vektor: ringar/linjer [lon,lat,lon,lat,...] (map/data/*.js, samma
     format som ui/wthr_karta.js). Projiceras EN gang till normerad Mercator
     (0-1), sa panorering bara ar multiplikation. Vid ritning gallras ringar
     utanfor bild eller mindre an 1 px, och punkter som hamnar inom en pixel
     fran foregaende. Lagg dem i ett cached-lager (nedan) - hela varlden ar
     for tung att rita om varje bildruta.
       style = { id, stroke, fill, width, closed (false = linjer), minZoom, maxZoom }
     Datan kan komma senare (lazy laddning): L.setData(rings). */
  function vectorLayer(rings, style){
    const s = style || {};
    const P = root.MapView.project;
    const closed = s.closed !== false;
    let data = [];
    const L = { id: s.id || 'vector', frame: true, visible: s.visible !== false, status: 'NDAT' };

    L.setData = function(r){
      data = (r || []).map(function(r){
        const pts = new Float64Array(r.length);
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for(let i = 0; i < r.length; i += 2){
          const p = P(r[i], r[i + 1], 0);
          const x = pts[i] = p.x / 256, y = pts[i + 1] = p.y / 256;
          if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
        }
        return { pts: pts, x0: x0, y0: y0, x1: x1, y1: y1 };
      });
      L.status = data.length ? '' : 'NDAT';
      if(L.redraw) L.redraw();
    };

    L.draw = function(ctx, view){
      if(s.minZoom != null && view.zoom < s.minZoom) return;
      if(s.maxZoom != null && view.zoom > s.maxZoom) return;
      const W = 256 * Math.pow(2, view.zoom), tl = view.topLeft();
      const xr = tl.x + view.w, yr = tl.y + view.h;
      ctx.beginPath();
      for(let k = 0; k < data.length; k++){
        const d = data[k];
        if(d.x1 * W < tl.x || d.x0 * W > xr || d.y1 * W < tl.y || d.y0 * W > yr) continue;
        if((d.x1 - d.x0) * W < 1 && (d.y1 - d.y0) * W < 1) continue;
        const p = d.pts;
        let lx = p[0] * W - tl.x, ly = p[1] * W - tl.y;
        ctx.moveTo(lx, ly);
        for(let i = 2; i < p.length; i += 2){
          const x = p[i] * W - tl.x, y = p[i + 1] * W - tl.y;
          if(x - lx < 1 && lx - x < 1 && y - ly < 1 && ly - y < 1) continue;
          ctx.lineTo(x, y); lx = x; ly = y;
        }
        if(closed) ctx.closePath();
      }
      if(s.fill && closed){ ctx.fillStyle = s.fill; ctx.fill(); }
      if(s.stroke){
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.width || 1;
        ctx.stroke();
      }
    };
    L.setData(rings);
    return L;
  }

  /* ---- Cache: ritar barnlagren EN gang till en offscreen-canvas med en
     kvarts skarm marginal runt om. Panorering = en drawImage; omritning bara
     vid zoombyte, storleksandring, ny data eller nar man drar utanfor
     marginalen. Barnen ritas med en vy vars topLeft/w/h ar offscreen-ytans,
     sa de far bara anvanda zoom, topLeft, w och h (vector-lagret gor det).
     Barnens loading/status foljer med ut (laddningsbaren, DIAG). Inget synligt
     barn = inget ritas. Andras ett barns synlighet: L.invalidate(). */
  function cachedLayer(children, o){
    const opt = o || {};
    const off = document.createElement('canvas');
    let key = null, ox = 0, oy = 0, oz = null, timer = null, lastZ = null;
    const L = { id: opt.id || 'cached', frame: true, visible: opt.visible !== false, status: '', children: children };
    L.invalidate = function(){ key = null; oz = null; if(L.redraw) L.redraw(); };
    children.forEach(function(c){ c.redraw = L.invalidate; });   // ny data i ett barn -> rita om

    L.draw = function(ctx, view){
      if(!children.some(function(c){ return c.visible; })){ L.loading = null; return; }
      const tl = view.topLeft(), mx = Math.round(view.w / 4), my = Math.round(view.h / 4);
      const r = view.dpr || 1, ow = off.width / r, oh = off.height / r;   // ytans storlek i logiska px
      const k = view.zoom + '|' + view.w + '|' + view.h;
      // Bara zoomen andrad (hjul/knapp): skala den gamla bilden direkt och rita
      // om skarpt nar zoomen statt still i 150 ms - annars hackar hjulzoomen.
      if(key && oz !== view.zoom && k.slice(k.indexOf('|')) === key.slice(key.indexOf('|'))){
        const f = Math.pow(2, view.zoom - oz);
        ctx.drawImage(off, ox * f - tl.x, oy * f - tl.y, ow * f, oh * f);
        // Timern startas om bara nar zoomen faktiskt andrats - annars skulle omritningar
        // (musrorelser) skjuta upp den i oandlighet.
        if(view.zoom !== lastZ){ lastZ = view.zoom; clearTimeout(timer); timer = setTimeout(L.invalidate, 150); }
        return;
      }
      if(k !== key || tl.x < ox || tl.y < oy || tl.x + view.w > ox + ow || tl.y + view.h > oy + oh){
        off.width = (view.w + 2 * mx) * r; off.height = (view.h + 2 * my) * r;   // nollstaller ocksa ytan
        ox = tl.x - mx; oy = tl.y - my;
        const sub = Object.create(view);
        sub.w = view.w + 2 * mx; sub.h = view.h + 2 * my;
        sub.topLeft = function(){ return { x: ox, y: oy }; };
        const octx = off.getContext('2d');
        octx.setTransform(r, 0, 0, r, 0, 0);
        children.forEach(function(c){ if(c.visible) c.draw(octx, sub); });
        key = k; oz = view.zoom;
        let done = 0, total = 0, st = '';
        children.forEach(function(c){
          if(!c.visible) return;
          if(c.loading){ done += c.loading.done; total += c.loading.total; }
          if(c.status) st = c.status;
        });
        L.loading = total ? { done: done, total: total } : null;
        L.status = st;
      }
      ctx.drawImage(off, Math.round(ox - tl.x), Math.round(oy - tl.y), off.width / r, off.height / r);
    };
    return L;
  }

  /* ---- Hojddata (DEM) ---------------------------------------------------
     Kalla: Terrarium-kodade rutor (hojd i meter = R*256 + G + B/256 - 32768),
     standard Mapterhorn (laserdata, Sverige 1 m - 512 px WebP, CORS, ingen
     nyckel). Rutstorleken lases ur bilden. En ruta som saknas (404 - kallan
     har inte den nivan dar) ersatts av narmaste overliggande niva, forstorad.
     Rutorna avkodas EN gang (delad cache, aven for LOS via MapDem) och varje
     lager ritar sin produkt per ruta till en egen canvas som cachas -
     panorering ar darfor bara drawImage. Farger skickas in fran paletten.

       demLayer({ id, url, maxZoom, mode, ... })
         shade   - TOPO 3D: sluttningar mot ljuset (nordvast) ljusa, fran det
                   morka; platt mark genomskinlig. light/dark = [r,g,b].
         contour - TOPO LINES: hojdkurvor, ekvidistans o.step() (m) eller - om den
                   ger null - efter zoom (AUTO). Andras steget: L.invalidate(). Var 5:e
                   kraftigare, med hojdsiffror om o.label (farg; o.outline = kontur).
                   line/index = CSS-farger.
         laser   - LASER-baskartan: heltackande grat skuggning (mork stil).
         height  - HGHT: allt over referenshojden ref() i above, under i below
                   ([r,g,b], halvgenomskinligt). ref() = null -> inget ritas.
       Over kallans maxZoom forstoras rutorna; kurvorna ritas da i hogre
       upplosning (upp till 4x) sa de inte blir suddiga.

     MapDem.get(url) -> Promise<{ e: Float32Array, n } | null>  (n = rutans sida i px)
     MapDem.sample(url, maxZoom, lat, lon) -> Promise<hojd i m | null> */
  const demCache = new Map();                          // url -> { e, n, done, fail, waiters }
  function demTile(url, redraw){
    let d = demCache.get(url);
    if(d){ if(redraw && !d.done) d.waiters.push(redraw); return d; }
    d = { e: null, n: 0, done: false, fail: false, waiters: redraw ? [redraw] : [] };
    const img = new Image();
    img.crossOrigin = 'anonymous';                     // pixlarna maste kunna lasas
    img.onload = function(){
      const n = img.naturalWidth, c = document.createElement('canvas'); c.width = c.height = n;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, n, n).data, e = new Float32Array(n * n);
      for(let i = 0; i < n * n; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      d.e = e; d.n = n; d.done = true;
      d.waiters.forEach(function(f){ f(); }); d.waiters = [];
    };
    img.onerror = function(){ d.done = true; d.fail = true; d.waiters.forEach(function(f){ f(); }); d.waiters = []; };
    img.src = url;
    demCache.set(url, d);
    // ponytail: minnescache med tak, gemensam for alla DEM-lager och LOS.
    if(demCache.size > limits.demTiles) demCache.delete(demCache.keys().next().value);
    return d;
  }
  const demUrl = function(tpl, z, x, y){ return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); };

  // Meter per pixel for en ruta (z, rad ty) med n px sida, vid rutans mitt-latitud.
  function tileMpp(z, ty, n){
    const k = Math.pow(2, z), lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + 0.5) / k)));
    return 40075016.686 * Math.cos(lat) / k / n;
  }

  // Belysning per pixel (0 = skugga ... 1 = full belysning) - gemensam for shade/laser.
  function illumination(e, n, mpp, ex){
    const out = new Float32Array(n * n);
    // Klassisk hillshade (sol i azimut 315, 45 grader upp), omskriven utan trigonometri
    // per pixel: cos(zen)cos(lutn) + sin(zen)sin(lutn)cos(az - aspekt - pi)
    //          = (cos zen + sin zen (cos az * dz/dy - sin az * dz/dx)) / sqrt(1 + |grad|^2).
    const az = 315 * Math.PI / 180, zen = 45 * Math.PI / 180;
    const cz = Math.cos(zen), kx = -Math.sin(zen) * Math.sin(az), ky = Math.sin(zen) * Math.cos(az);
    for(let y = 0; y < n; y++){
      const yu = y ? y - 1 : y, yd = y < n - 1 ? y + 1 : y, fy = ex / ((yd - yu) * mpp);
      for(let x = 0; x < n; x++){
        const xl = x ? x - 1 : x, xr = x < n - 1 ? x + 1 : x;
        const dzdx = (e[y * n + xr] - e[y * n + xl]) / ((xr - xl) * mpp) * ex;
        const dzdy = (e[yd * n + x] - e[yu * n + x]) * fy;
        out[y * n + x] = (cz + kx * dzdx + ky * dzdy) / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy);
      }
    }
    return out;
  }
  const exagg = function(z){ return Math.max(0, 12 - z) * 0.6 + 1; };   // utzoomat syns relief annars inte

  function pixelCanvas(n, fill){
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), out = g.createImageData(n, n);
    fill(out.data);
    g.putImageData(out, 0, 0);
    return c;
  }

  function shadeCanvas(t, z, ty, o){
    const il = illumination(t.e, t.n, tileMpp(z, ty, t.n), exagg(z)), flat = Math.cos(45 * Math.PI / 180);
    return pixelCanvas(t.n, function(d){
      for(let i = 0; i < il.length; i++){
        const v = il[i] - flat, col = v > 0 ? o.light : o.dark;
        d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2];
        d[i * 4 + 3] = Math.min(255, Math.abs(v) * (v > 0 ? 320 : 420));
      }
    });
  }

  // LASER: heltackande graskala i mork stil - plan mark morkgra, sluttningar mot
  // ljuset ljusare, fran ljuset morkare. Farger: o.dark (bas) mot o.light.
  function laserCanvas(t, z, ty, o){
    const il = illumination(t.e, t.n, tileMpp(z, ty, t.n), exagg(z));
    return pixelCanvas(t.n, function(d){
      for(let i = 0; i < il.length; i++){
        const v = Math.max(0, Math.min(1, 0.02 + il[i] * 0.36));   // plan mark ~27 % - mork stil
        for(let k = 0; k < 3; k++) d[i * 4 + k] = o.dark[k] + (o.light[k] - o.dark[k]) * v;
        d[i * 4 + 3] = 255;
      }
    });
  }

  function heightCanvas(t, ref, o){
    return pixelCanvas(t.n, function(d){
      for(let i = 0; i < t.e.length; i++){
        const col = t.e[i] > ref ? o.above : o.below;
        d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = o.alpha || 90;
      }
    });
  }

  // Ekvidistans (m) efter zoom: fler kurvor ju langre in.
  function contourStep(z){ return z <= 9 ? 100 : z <= 11 ? 50 : z <= 13 ? 20 : z <= 15 ? 10 : 5; }

  // Marching squares over hojdgriden. Kurvorna ritas i ss ganger rutans upplosning.
  function contourCanvas(t, z, ss, o){
    // Valt steg, men aldrig finare an 1/10 av AUTO for zoomnivan - annars blir det
    // hundratals kurvor per cell utzoomat over fjall och ritningen fryser.
    const step = Math.max((o.step && o.step()) || contourStep(z), contourStep(z) / 10), e = t.e, n = t.n;
    const c = document.createElement('canvas'); c.width = c.height = n * ss;
    const g = c.getContext('2d');
    const paths = [new Path2D(), new Path2D()];        // [vanlig, var 5:e]
    // Hojdsiffror (o.label): pa var 5:e kurva, hogst en per kvart av rutan - den punkt
    // som ligger narmast kvartens mitt. Inte nara kanten (texten skulle klippas).
    const G = n / 2, M = 40, best = {};
    for(let y = 0; y < n - 1; y++){
      for(let x = 0; x < n - 1; x++){
        const a = e[y * n + x], b = e[y * n + x + 1], cc = e[(y + 1) * n + x + 1], d = e[(y + 1) * n + x];
        const lo = Math.min(a, b, cc, d), hi = Math.max(a, b, cc, d);
        for(let lv = Math.ceil(lo / step) * step; lv < hi; lv += step){
          const pts = [];                                // skarningar pa cellens kanter
          if((a < lv) !== (b < lv))  pts.push(x + (lv - a) / (b - a), y);
          if((b < lv) !== (cc < lv)) pts.push(x + 1, y + (lv - b) / (cc - b));
          if((d < lv) !== (cc < lv)) pts.push(x + (lv - d) / (cc - d), y + 1);
          if((a < lv) !== (d < lv))  pts.push(x, y + (lv - a) / (d - a));
          const idx = Math.round(lv / step) % 5 === 0, p = paths[idx ? 1 : 0];
          if(idx && o.label && pts.length >= 4){
            const mx = (pts[0] + pts[2]) / 2, my = (pts[1] + pts[3]) / 2;
            if(mx > M && my > M && mx < n - M && my < n - M){
              const k = Math.floor(mx / G) + ',' + Math.floor(my / G);
              const d = Math.hypot(mx - (Math.floor(mx / G) + .5) * G, my - (Math.floor(my / G) + .5) * G);
              if(!best[k] || d < best[k].d) best[k] = { x: mx, y: my, lv: lv, d: d };
            }
          }
          for(let i = 0; i + 3 < pts.length; i += 4){
            p.moveTo((pts[i] + 0.5) * ss, (pts[i + 1] + 0.5) * ss);
            p.lineTo((pts[i + 2] + 0.5) * ss, (pts[i + 3] + 0.5) * ss);
          }
        }
      }
    }
    // Linjebredd i rutans pixlar, sa att den blir ~1 px pa skarmen oavsett rutstorlek.
    const lw = Math.max(1, ss * n / 512);
    g.lineCap = 'round';
    g.strokeStyle = o.line;  g.lineWidth = lw;       g.stroke(paths[0]);
    g.strokeStyle = o.index; g.lineWidth = lw * 1.6; g.stroke(paths[1]);
    // Siffrornas plats (0-1 i rutan), vinkel langs kurvan (ur lutningen, aldrig upp och
    // ned) och text. De ritas INTE in i rutan utan pa skarmen (demLayer.draw), i fast
    // storlek - annars vaxer de med rutan nar man zoomar in.
    c.labels = Object.keys(best).map(function(k){
      const b = best[k], x = Math.round(b.x), y = Math.round(b.y);
      const gx = e[y * n + x + 2] - e[y * n + x - 2], gy = e[(y + 2) * n + x] - e[(y - 2) * n + x];
      let a = Math.atan2(gy, gx) + Math.PI / 2;
      if(a > Math.PI / 2) a -= Math.PI; if(a < -Math.PI / 2) a += Math.PI;
      return { x: (b.x + 0.5) / n, y: (b.y + 0.5) / n, a: a, t: String(Math.round(b.lv)) };
    });
    return c;
  }

  // Tidsbudget per bildruta (DELAD av alla hojdlager) for att rakna fram nya produkter
  // (kurvor, skuggning): resten tar nasta bildruta - zoomsteg hackar inte, rutorna
  // fylls i strax efter.
  const DEM_BUDGET_MS = 6, demBudget = { frame: -1, end: 0 };
  function demLayer(o){
    const maxZ = o.maxZoom == null ? 15 : o.maxZoom;
    const prod = new Map();                            // produktcache: nyckel -> canvas
    let okCount = 0;
    const L = { id: o.id || o.mode, frame: true, visible: o.visible !== false, status: '', loading: null,
                attribution: o.attribution || '' };
    const redraw = function(){ if(L.redraw) L.redraw(); };
    L.invalidate = function(){ prod.clear(); redraw(); };   // t.ex. ny referenshojd (HGHT)
    let over = false;

    // Produkten for en ruta: canvas, null (laddar) eller false (saknas pa denna niva).
    function product(z, x, y, zr, ref){
      const ss = o.mode === 'contour' ? Math.min(limits.contourSS, Math.pow(2, Math.max(0, zr - z))) : 1;
      const key = z + '/' + x + '/' + y + '/' + ss + (o.mode === 'height' ? '/' + ref : '');
      let c = prod.get(key);
      if(c) return c;
      const d = demTile(demUrl(o.url, z, x, y), redraw);
      if(!d.done) return null;
      // ponytail: offline mitt i en session syns inte som OFFL (saknade rutor ar normalt).
      if(d.fail){ if(!okCount) L.status = 'OFFL'; return false; }
      if(performance.now() > demBudget.end){ over = true; return null; }
      okCount++; L.status = '';
      c = o.mode === 'shade' ? shadeCanvas(d, z, y, o)
        : o.mode === 'laser' ? laserCanvas(d, z, y, o)
        : o.mode === 'height' ? heightCanvas(d, ref, o)
        : contourCanvas(d, z, ss, o);
      prod.set(key, c);
      if(prod.size > limits.demProducts) prod.delete(prod.keys().next().value);
      return c;
    }

    L.draw = function(ctx, view){
      const ref = o.mode === 'height' ? (o.ref ? o.ref() : null) : 0;
      if(ref == null){ L.loading = null; return; }
      const refKey = Math.round(ref * 10) / 10;
      if(view.frame !== demBudget.frame){ demBudget.frame = view.frame; demBudget.end = performance.now() + DEM_BUDGET_MS; }
      over = false;
      const zr = Math.round(view.zoom), z = Math.max(0, Math.min(maxZ, zr));
      const ts = 256 * Math.pow(2, view.zoom - z), n = Math.pow(2, z), tl = view.topLeft();
      const x0 = Math.floor(tl.x / ts), x1 = Math.floor((tl.x + view.w) / ts);
      const y0 = Math.max(0, Math.floor(tl.y / ts)), y1 = Math.min(n - 1, Math.floor((tl.y + view.h) / ts));
      let total = 0, done = 0;
      const labelled = [];                             // [etiketter, rutans x, y, storlek]
      for(let y = y0; y <= y1; y++){
        for(let x = x0; x <= x1; x++){
          const wx = ((x % n) + n) % n;
          const c = product(z, wx, y, zr, refKey);
          total++;
          if(c !== null) done++;
          const dx = Math.floor(x * ts - tl.x), dy = Math.floor(y * ts - tl.y), dw = Math.ceil(ts) + 1;
          if(c){ ctx.drawImage(c, dx, dy, dw, dw); if(c.labels && c.labels.length) labelled.push([c.labels, dx, dy, dw]); continue; }
          // Reserv (laddar eller saknas): narmaste overliggande niva, ratt del forstorad.
          // Saknas rutan hamtas foraldern; laddar den visas bara det som redan finns.
          for(let dd = 1; dd <= 6 && z - dd >= 0; dd++){
            const k = Math.pow(2, dd);
            const up = c === false ? product(z - dd, Math.floor(wx / k), Math.floor(y / k), zr, refKey)
                                   : prod.get((z - dd) + '/' + Math.floor(wx / k) + '/' + Math.floor(y / k) + '/1' + (o.mode === 'height' ? '/' + refKey : ''));
            if(up){ const sw = up.width / k; ctx.drawImage(up, (wx % k) * sw, (y % k) * sw, sw, sw, dx, dy, dw, dw); break; }
            if(up === null) break;                     // foraldern laddar - rita nasta varv
          }
        }
      }
      // Hojdsiffrorna (TOPO LINES): fast 13 px oavsett zoom, kontur i bakgrundsfargen.
      if(labelled.length){
        ctx.save();
        ctx.font = '13px ViperDisplay'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 4; ctx.strokeStyle = o.outline; ctx.fillStyle = o.label;
        labelled.forEach(function(q){
          q[0].forEach(function(l){
            ctx.save();
            ctx.translate(q[1] + l.x * q[3], q[2] + l.y * q[3]); ctx.rotate(l.a);
            ctx.strokeText(l.t, 0, 0); ctx.fillText(l.t, 0, 0);
            ctx.restore();
          });
        });
        ctx.restore();
      }
      L.loading = done < total ? { done: done, total: total } : null;
      if(over) setTimeout(redraw, 0);                  // budgeten slut - fortsatt nasta bildruta
    };
    return L;
  }

  // Hojddata for andra (LOS, HGHT:s referens). Promise - vantar in laddningen.
  const MapDem = {
    get: function(url){
      return new Promise(function(res){
        const d = demTile(url, null);
        const fin = function(){ res(d.fail ? null : d); };
        if(d.done) fin(); else d.waiters.push(fin);
      });
    },
    // Hojd i en punkt: djupaste nivan som finns (gar uppat vid 404), bilinjar.
    sample: function(tpl, maxZoom, lat, lon){
      const P = root.MapView.project;
      const tryZ = function(z){
        if(z < 0) return Promise.resolve(null);
        const p = P(lon, lat, z), tx = Math.floor(p.x / 256), ty = Math.floor(p.y / 256);
        return MapDem.get(demUrl(tpl, z, tx, ty)).then(function(t){
          if(!t) return tryZ(z - 1);
          const fx = (p.x / 256 - tx) * t.n - 0.5, fy = (p.y / 256 - ty) * t.n - 0.5;
          const x0 = Math.max(0, Math.min(t.n - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(t.n - 2, Math.floor(fy)));
          const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0)), e = t.e, n = t.n;
          return (e[y0 * n + x0] * (1 - ax) + e[y0 * n + x0 + 1] * ax) * (1 - ay) +
                 (e[(y0 + 1) * n + x0] * (1 - ax) + e[(y0 + 1) * n + x0 + 1] * ax) * ay;
        });
      };
      return tryZ(maxZoom);
    },
    url: demUrl,
  };
  root.MapDem = MapDem;

  /* ---- Bild: EN georefererad bild (t.ex. ett nedladdat kartutdrag) ----
     imageLayer({ id, url, corners: { tl, tr, bl } (lat/lon for bildens horn), attribution })
     Bilden ritas med en affin transform genom tre horn - en SWEREF-rektangel
     (nordorienterad i SWEREF 99 TM) hamnar darfor ratt aven fast kartan ar Mercator
     (meridiankonvergensen ~1 grad). Ingen frame: hornen gar via vridna toScreen.
     L.dim = ljusstyrka 0-1 (brightness, gjord EN gang per varde - inte per bildruta).
     Saknas filen: status 'OFFL' (DIAG TILE-02). */
  function imageLayer(o){
    const L = { id: o.id, visible: o.visible !== false, status: '', loading: { done: 0, total: 1 },
                attribution: o.attribution || '' };
    const img = new Image();
    img.onload = function(){ L.loading = null; if(L.redraw) L.redraw(); };
    img.onerror = function(){ L.loading = null; L.status = 'OFFL'; if(L.redraw) L.redraw(); };
    img.src = o.url;
    let src = null, srcDim = null;
    L.draw = function(ctx, view){
      if(!img.naturalWidth) return;
      const w = img.naturalWidth, h = img.naturalHeight, c = o.corners, dim = L.dim == null ? 1 : L.dim;
      if(dim !== srcDim){
        srcDim = dim; src = img;
        if(dim !== 1){
          src = document.createElement('canvas'); src.width = w; src.height = h;
          const g = src.getContext('2d'); g.filter = 'brightness(' + dim + ')'; g.drawImage(img, 0, 0);
        }
      }
      const a = view.toScreen(c.tl.lon, c.tl.lat), b = view.toScreen(c.tr.lon, c.tr.lat), d = view.toScreen(c.bl.lon, c.bl.lat);
      ctx.save();
      ctx.transform((b.x - a.x) / w, (b.y - a.y) / w, (d.x - a.x) / h, (d.y - a.y) / h, a.x, a.y);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    };
    return L;
  }

  /* ---- Gradnat. Steget valjs sa linjerna hamnar minst ~80 px isar. ---- */
  const STEPS = [1 / 60, 5 / 60, 10 / 60, 0.5, 1, 2, 5, 10, 30];
  function gridLayer(style){
    const s = style || {};
    const L = { id: s.id || 'grid', frame: true, visible: s.visible !== false, status: '' };
    L.draw = function(ctx, view){
      const ppd = 256 * Math.pow(2, view.zoom) / 360;          // px per langdgrad
      const step = STEPS.find(function(st){ return st * ppd >= 80; }) || 30;
      const a = view.toLonLat(0, 0), b = view.toLonLat(view.w, view.h);
      ctx.beginPath();
      for(let lon = Math.ceil(a.lon / step) * step; lon <= b.lon; lon += step){
        const x = Math.round(view.toScreen(lon, 0).x) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, view.h);
      }
      for(let lat = Math.ceil(b.lat / step) * step; lat <= a.lat; lat += step){
        const y = Math.round(view.toScreen(0, lat).y) + 0.5;
        ctx.moveTo(0, y); ctx.lineTo(view.w, y);
      }
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    return L;
  }

  root.MapLayers = { limits: limits, image: imageLayer, tile: tileLayer, vector: vectorLayer, cached: cachedLayer, dem: demLayer, grid: gridLayer };
})(typeof window !== 'undefined' ? window : globalThis);
