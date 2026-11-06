/* =====================================================================
   map/mapview.js  -  KARTKOMPONENTEN. Vet inget om OSB:er, config eller
   MFDsystem: bara vy-tillstand (mitt + zoom), Web Mercator-projektion,
   lagerlista och mus (vanster drag = panorera, hjul = zoom).

     const v = MapView(canvas, { lon, lat, zoom, minZoom, maxZoom });
     v.addLayer(layer)            -> layer = { id, visible, draw(ctx, v) }
     v.toScreen(lon, lat)         -> { x, y }   (logiska px i canvasen)
     v.toLonLat(x, y)             -> { lon, lat }
     v.panBy(dx, dy) / v.zoomBy(d, x?, y?) / v.zoomTo(z, x?, y?) / v.setCenter(lon, lat, zoom?)
     v.fitRect(x0, y0, x1, y1)    -> anpassa vyn sa skarmrutan fyller canvasen
     opts.wheel(v, dir, x, y)     -> egen hjulhantering (dir +1 = in, x/y = pekaren).
                                     Utan den: zoomBy(+-0,5) kring pekaren.
     v.onChange(cb)               -> cb(v) efter varje ritning
     v.onClick(cb)                -> cb({x, y}, ev) vid klick UTAN drag (vanster knapp)
     v.onGrab(cb, knapp?)         -> cb({x, y}, ev) vid musnedtryck med knapp (standard 0 =
                                     vanster, 2 = hoger); returnerar den { move(p, ev), up(p, ev) }
                                     tar verktyget over draget (handtag, skiss) - ingen panorering.
     Mittenknappen panorerar alltid (aven nar vanster ar upptagen av ett verktyg).
     opts.bg                      -> bakgrundsfarg (fran paletten)
     v.pointer                    -> { x, y } eller null (musen over kartan)
     opts.dpr                     -> canvaspixlar per logisk px (telefonens retinaskarm; standard 1).
                                     Allt ritas fortfarande i logiska px - v.resize satter skalan.
     v.rot / v.setRotation(rad) / v.rotateBy(rad)  -> kartans vridning (medurs; 0 = norr upp)

   VRIDNING. toScreen/toLonLat ar vridna (skarmkoordinater) - lager som ritar
   punkter, linjer och text via dem foljer med och texten star uppratt.
   Lager med frame:true (rutor, vektorcache, hojddata, gradnat - allt som ar
   bundet till kartans rutnat) ritas i stallet ovridna i en kvadratisk ram
   med skarmens diagonal som sida, och hela ramen vrids. De far en egen vy
   (w = h = diagonalen, ovridna toScreen/toLonLat/topLeft).

   Zoom ar ett flyttal i XYZ-tilesens skala (0 = hela jorden pa 256 px).
   ===================================================================== */
(function(root){
  const TILE = 256, MAXLAT = 85.05112878;

  function worldSize(z){ return TILE * Math.pow(2, z); }
  function project(lon, lat, z){
    const s = worldSize(z), la = Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * Math.PI / 180;
    return { x: (lon + 180) / 360 * s,
             y: (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * s };
  }
  function unproject(x, y, z){
    const s = worldSize(z);
    return { lon: x / s * 360 - 180,
             lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / s))) * 180 / Math.PI };
  }
  const wrapLon = function(lon){ return ((lon + 540) % 360 + 360) % 360 - 180; };

  function MapView(canvas, opts){
    const o = opts || {};
    const v = {
      canvas: canvas, ctx: canvas.getContext('2d'),
      lon: o.lon || 0, lat: o.lat || 0, zoom: o.zoom == null ? 5 : o.zoom,
      minZoom: o.minZoom == null ? 2 : o.minZoom, maxZoom: o.maxZoom == null ? 18 : o.maxZoom,
      w: canvas.width, h: canvas.height, layers: [], pointer: null, rot: 0, frame: 0,   // frame = ritningens nummer
      dpr: o.dpr || 1,
    };
    const listeners = [], clickers = [], grabbers = [];
    let pending = false;

    // Varldspixel for canvasens ovre vanstra horn - tile-lagret raknar ur den.
    v.topLeft = function(){
      const c = project(v.lon, v.lat, v.zoom);
      return { x: c.x - v.w / 2, y: c.y - v.h / 2 };
    };
    // Skarmkoordinater, med vridningen runt skarmens mitt.
    v.toScreen = function(lon, lat){
      const p = project(lon, lat, v.zoom), c = project(v.lon, v.lat, v.zoom);
      const dx = p.x - c.x, dy = p.y - c.y, co = Math.cos(v.rot), si = Math.sin(v.rot);
      return { x: v.w / 2 + dx * co - dy * si, y: v.h / 2 + dx * si + dy * co };
    };
    v.toLonLat = function(x, y){
      const dx = x - v.w / 2, dy = y - v.h / 2, co = Math.cos(v.rot), si = Math.sin(v.rot);
      const c = project(v.lon, v.lat, v.zoom);
      return unproject(c.x + dx * co + dy * si, c.y - dx * si + dy * co, v.zoom);
    };
    v.setRotation = function(r){
      r = ((r + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      v.rot = Math.abs(r) < 1e-4 ? 0 : r;
      v.redraw();
    };
    v.rotateBy = function(d){ v.setRotation(v.rot + d); };
    // Ovriden vy for frame-lager: kvadrat D x D runt samma mitt.
    function frameView(D){
      const fv = Object.create(v), c = project(v.lon, v.lat, v.zoom), tl = { x: c.x - D / 2, y: c.y - D / 2 };
      fv.w = fv.h = D; fv.rot = 0;
      fv.topLeft = function(){ return tl; };
      fv.toScreen = function(lon, lat){ const p = project(lon, lat, v.zoom); return { x: p.x - tl.x, y: p.y - tl.y }; };
      fv.toLonLat = function(x, y){ return unproject(tl.x + x, tl.y + y, v.zoom); };
      return fv;
    }

    v.setCenter = function(lon, lat, zoom){
      v.lon = wrapLon(lon);
      v.lat = Math.max(-MAXLAT, Math.min(MAXLAT, lat));
      if(zoom != null) v.zoom = Math.max(v.minZoom, Math.min(v.maxZoom, zoom));
      v.redraw();
    };
    v.panBy = function(dx, dy){
      // Skarmforflyttning -> kartans rutnat (vrid tillbaka).
      const co = Math.cos(v.rot), si = Math.sin(v.rot), fx = dx * co + dy * si, fy = -dx * si + dy * co;
      const c = project(v.lon, v.lat, v.zoom), ll = unproject(c.x - fx, c.y - fy, v.zoom);
      v.setCenter(ll.lon, ll.lat);
    };
    // Zoomar kring (x, y) - punkten under pekaren ligger kvar. Utan punkt: mitten.
    v.zoomBy = function(d, x, y){ v.zoomTo(v.zoom + d, x, y); };
    v.zoomTo = function(z, x, y){
      if(x == null){ x = v.w / 2; y = v.h / 2; }
      const ll = v.toLonLat(x, y);
      v.zoom = Math.max(v.minZoom, Math.min(v.maxZoom, z));
      const p = v.toScreen(ll.lon, ll.lat);
      v.panBy(x - p.x, y - p.y);
    };

    v.fitRect = function(x0, y0, x1, y1){
      const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
      if(rw < 1 || rh < 1) return;
      const c = v.toLonLat((x0 + x1) / 2, (y0 + y1) / 2);
      v.setCenter(c.lon, c.lat, v.zoom + Math.log2(Math.min(v.w / rw, v.h / rh)));
    };

    v.addLayer = function(layer){
      layer.redraw = v.redraw;          // asynkrona lager (tiles) ber om omritning
      v.layers.push(layer);
      v.redraw();
      return layer;
    };
    v.layer = function(id){ return v.layers.find(function(l){ return l.id === id; }); };
    v.onChange = function(cb){ listeners.push(cb); };
    v.onClick = function(cb){ clickers.push(cb); };
    v.onGrab = function(cb, btn){ grabbers.push({ cb: cb, btn: btn || 0 }); };
    // Samma fraga som vanster musnedtryck, for telefonens fingrar.
    v.grabAt = function(p){
      for(let i = 0; i < grabbers.length; i++){
        const h = grabbers[i].btn === 0 && grabbers[i].cb(p);
        if(h) return h;
      }
      return null;
    };

    v.draw = function(){
      pending = false;
      v.frame++;
      const ctx = v.ctx;
      ctx.fillStyle = o.bg;
      ctx.fillRect(0, 0, v.w, v.h);
      const D = v.rot ? Math.ceil(Math.hypot(v.w, v.h)) : 0, fv = v.rot ? frameView(D) : v;
      v.layers.forEach(function(l){
        if(!l.visible) return;
        if(!(l.frame && v.rot)){ l.draw(ctx, v); return; }
        ctx.save();
        ctx.translate(v.w / 2, v.h / 2); ctx.rotate(v.rot); ctx.translate(-D / 2, -D / 2);
        l.draw(ctx, fv);
        ctx.restore();
      });
      listeners.forEach(function(cb){ cb(v); });
    };
    // Koalescerad: manga anrop per bildruta -> en ritning.
    v.redraw = function(){
      if(pending) return;
      pending = true;
      requestAnimationFrame(v.draw);
    };

    // Pa datorn ar canvasen 1:1 med logiska px (dpr 1) - MFD-skarmarna ar 100 %.
    v.resize = function(){
      v.w = canvas.offsetWidth || v.w;
      v.h = canvas.offsetHeight || v.h;
      canvas.width = v.w * v.dpr;
      canvas.height = v.h * v.dpr;
      v.ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      v.redraw();
    };

    // ---- Mus. Koordinaterna raknas om till logiska px: #mfd ar CSS-zoomad
    // (fitToWindow), samma knep som ui/weather.js. ----
    const xy = function(ev){
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * (v.w / r.width), y: (ev.clientY - r.top) * (v.h / r.height) };
    };
    // Klick = musen slapptes inom 4 px fran dar den trycktes - annars var det en panorering.
    let drag = null, down = null, grab = null;
    canvas.addEventListener('mousedown', function(ev){
      if(ev.button > 2) return;
      const p = xy(ev);
      if(ev.button === 1){ ev.preventDefault(); drag = p; down = null; return; }   // mitten = panorera
      // Ett verktyg som vill ha draget (handtag, skiss m.m.) far det - inget klick, ingen panorering.
      for(let i = 0; i < grabbers.length; i++){
        if(grabbers[i].btn !== ev.button) continue;
        const h = grabbers[i].cb(p, ev);
        if(h){ grab = h; down = null; return; }
      }
      if(ev.button !== 0) return;
      drag = down = p;
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('auxclick', function(ev){ if(ev.button === 1) ev.preventDefault(); });
    canvas.addEventListener('mousemove', function(ev){
      const p = xy(ev);
      v.pointer = p;
      if(grab){ grab.move(p, ev); v.redraw(); }
      else if(drag){ v.panBy(p.x - drag.x, p.y - drag.y); drag = p; }
      else v.redraw();
    });
    canvas.addEventListener('click', function(ev){
      const p = xy(ev);
      if(down && Math.abs(p.x - down.x) < 4 && Math.abs(p.y - down.y) < 4) clickers.forEach(function(cb){ cb(p, ev); });
      down = null;
    });
    canvas.addEventListener('mouseleave', function(){ v.pointer = null; v.redraw(); });
    canvas.addEventListener('wheel', function(ev){
      ev.preventDefault();
      const p = xy(ev), dir = ev.deltaY < 0 ? 1 : -1;
      if(o.wheel) o.wheel(v, dir, p.x, p.y); else v.zoomBy(dir * 0.5, p.x, p.y);
    }, { passive: false });
    if(typeof window !== 'undefined' && window.addEventListener){
      window.addEventListener('mouseup', function(ev){
        if(grab){ const g = grab; grab = null; g.up(v.pointer || xy(ev), ev); v.redraw(); }
        drag = null; canvas.classList.remove('dragging');
      });
    }

    return v;
  }

  MapView.project = project;
  MapView.unproject = unproject;
  MapView.TILE = TILE;
  root.MapView = MapView;
})(typeof window !== 'undefined' ? window : globalThis);
