/* =====================================================================
   map/mobile/app.js  -  TELEFONAPPEN (limmet). Visar kartan och det som
   planerats pa datorn. Kartmotorn (MapView, lager, MapLists, MapDraw, MapMarks)
   ar samma som datorns; har finns bara knappmeny, paneler, vald punkt och import.

   Importerad data ANDRAS ALDRIG: MapStore nedan laser ur exportfilen, och en ny import
   ersatter den i sin helhet. Det enda som skapas pa telefonen ar SKCH och de egna valen
   (karta, lager, vilken lista som visas) - de ligger for sig i KEY_SKETCH och KEY_UI och
   gar aldrig tillbaka till datorn.
   Fel gar till MapDiag och visas bara pa DIAG (OPTN blir gul), som pa datorn.
   ===================================================================== */
(function(){
  const S = window.MAP_SOURCES, P = MapMarks.palette(), rgbOf = MapMarks.rgbOf;
  const $ = function(id){ return document.getElementById(id); };
  const KEY_DATA = 'mfdMapMobile:data', KEY_UI = 'mfdMapMobile:ui', KEY_SKETCH = 'mfdMapMobile:sketch';
  const TOUCH_PX = 24, MAX_FILE = 4e6, HOLD_MS = 2000;  // traffyta for fingret, exportfilens tak, ERSE
  const SK_COLORS = [['white', 'WHT'], ['red', 'RED'], ['yellow', 'YEL'], ['green', 'GRN'], ['blue', 'BLU'], ['magenta', 'MAG']];

  // Lagre tak an datorn: iOS stanger sidan om den tar for mycket minne. Rymmer det som
  // syns pa en telefon aven vriden (~25 rutor), en DEM-ruta ar ~1 MB.
  Object.assign(MapLayers.limits, { rasterTiles: 120, demTiles: 40, demProducts: 30, contourSS: 2 });
  const VT_TILES = 80;

  // Bara det som kan handa pa telefonen, pa engelska. Datorns katalog i diag.js rors inte.
  MapDiag.CATALOG.splice(0, MapDiag.CATALOG.length,
    ['JS-01', 'Script error'], ['JS-02', 'Unhandled async error'], ['RES-01', 'File failed to load'], ['FONT-01', 'Font failed to load'],
    ['TILE-02', 'Map tiles or elevation data unavailable'], ['STOR-02', 'Stored data is corrupt'], ['CRD-02', 'GOTO: invalid coordinate'],
    ['IMP-01', 'Import failed, previous data kept'], ['SKC-01', 'Sketch could not be saved'], ['GPS-01', 'No GPS position']);

  // localStorage kan kasta (privat lage, full lagring).
  const ls = {
    get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
    set: function(k, v){ try{ localStorage.setItem(k, v); return true; }catch(e){ return false; } },
  };

  // ---- Importerad data + MapStore for MapLists/MapDraw. Bara skissen sparas, for sig. ----
  let data = null;
  try{ const t = ls.get(KEY_DATA); if(t) data = MapExport.parse(t); }
  catch(e){ MapDiag.raise('IMP-01', 'stored data: ' + e.message); }
  window.MapStore = function(name){
    if(name === 'lists') return { load: function(cb){ cb(data ? JSON.stringify(data.lists) : ''); }, save: function(){} };
    return {
      load: function(cb){
        let sketch = [];
        try{ sketch = JSON.parse(ls.get(KEY_SKETCH)) || []; }catch(e){ MapDiag.raise('SKC-01', e.message); }
        cb(JSON.stringify(Object.assign({ oleats: [] }, data && data.drawings, { sketch: sketch })));
      },
      save: function(t){
        if(ls.set(KEY_SKETCH, JSON.stringify(JSON.parse(t).sketch))) MapDiag.clear('SKC-01');
        else MapDiag.raise('SKC-01', 'storage full');
      },
    };
  };

  // ---- Telefonens egna val ----
  let ui = {};
  try{ ui = JSON.parse(ls.get(KEY_UI)) || {}; }catch(e){ ui = {}; }
  let unit = ui.unit || (data && data.dist) || 'km', ang = ui.ang || (data && data.ang) || 'deg', fmt = ui.fmt || (data && data.fmt) || 'dd';
  let base = ui.base || 'strt', dim = ui.dim || 10, baseOpen = false;
  let ori = ui.ori || 'nup', skCol = ui.skCol || 'white';   // NUP / GPS / FREE, skissens farg
  const start = ui.lon != null ? ui : (data && data.view) || { lat: 62, lon: 16, zoom: 4, rot: 0 };
  const fmtDist = function(m){ return MapMarks.fmtDist(m, unit); };
  const fmtAng = function(az){ return MapMarks.fmtAng(az, ang).replace(/\D/g, ''); };   // bara siffrorna

  // ---- Kartan (ritordning = ordningen har, samma som pa datorn) ----
  const view = MapView($('m-map'), { bg: P.bg, lat: start.lat, lon: start.lon, zoom: start.zoom, minZoom: 2, maxZoom: 19,
                                     dpr: Math.min(2, window.devicePixelRatio || 1) });
  view.resize();
  view.setRotation(ori === 'nup' ? 0 : start.rot || 0);
  window.addEventListener('resize', view.resize);

  // Baskartorna utan VECT - den kraver Natural Earth-datan (6-9 MB).
  const bases = S.bases.map(function(g){ return { head: g.head, maps: g.maps.filter(function(m){ return !m.vector; }) }; })
                       .filter(function(g){ return g.maps.length; });
  const MAPS = {}, baseLayers = {};
  bases.forEach(function(g){ g.maps.forEach(function(m){
    MAPS[m.id] = m;
    baseLayers[m.id] = m.dem
      ? [view.addLayer(MapLayers.dem(Object.assign({ id: m.id, mode: m.dem, visible: false, attribution: m.attribution,
                                                     light: rgbOf(P.white), dark: rgbOf(P.bg) }, S.dem)))]
      : m.layers.map(function(src, i){ return view.addLayer(MapLayers.tile(Object.assign({ id: m.id + i, visible: false, attribution: m.attribution }, src))); });
  }); });
  if(!MAPS[base]) base = 'strt';
  function applyBase(){
    const d = MAPS[base].dem ? 1 : 0.06 + (dim - 1) / 9 * 0.94;   // alla rasterkartor
    Object.keys(baseLayers).forEach(function(id){ baseLayers[id].forEach(function(l){ l.visible = id === base; l.dim = d; }); });
    view.redraw();
  }

  const vt = MapVT(S.vtiles.tilejson, S.vtiles.maxZoom, VT_TILES);
  const ML = MapMarks.mapLayers(vt, P, S.dem, function(){ return null; });   // kurvor: AUTO efter zoom
  const waterC = view.addLayer(MapLayers.cached([ML.water], { id: 'waterC' }));
  view.addLayer(ML.topoLines);
  const roadsC = view.addLayer(MapLayers.cached([ML.roads], { id: 'roadsC' }));
  view.addLayer(ML.names);
  const OVERLAYS = {
    names:     { label: 'NAME', l: ML.names, set: function(v){ ML.names.visible = v; } },
    roads:     { label: 'ROAD', l: ML.roads, set: function(v){ ML.roads.visible = v; roadsC.invalidate(); } },
    water:     { label: 'WATR', l: ML.water, set: function(v){ ML.water.visible = v; waterC.invalidate(); } },
    topolines: { label: 'TOPO', l: ML.topoLines, set: function(v){ ML.topoLines.visible = v; } },
  };
  const ovOn = ui.ov || { names: true, roads: true, water: true, topolines: false };
  Object.keys(OVERLAYS).forEach(function(k){ OVERLAYS[k].set(!!ovOn[k]); });

  let lists = null;
  view.addLayer(MapMarks.routeLayer(function(){ return lists; }, P, { dist: fmtDist, ang: fmtAng }));
  view.addLayer(MapMarks.pointsLayer(function(){ return lists; }, P));
  const draw = MapDraw(view, { outline: P.bg,
    colors: { white: P.white, red: P.red, yellow: P.yellow, green: P.green, blue: P.blue, magenta: P.magenta },
    lists: function(){ return lists ? lists.all() : []; },
    upks: function(id){ return lists ? lists.upks(id) : []; } });
  // Harkorset i kartans mitt (koordinaten overst galler dar), utanfor det en liten vit pil mot norr
  // och, nar kartan flyttats fran min position, ett gront streck med pilspets mot positionen.
  view.addLayer({ id: 'center', visible: true, status: '', draw: function(ctx, v){
    if(draw.sketching()) return;
    const x = v.w / 2, y = v.h / 2, g = gps.pos();
    ctx.save();
    [[P.bg, 4], [P.white, 1.5]].forEach(function(s){
      ctx.strokeStyle = s[0]; ctx.lineWidth = s[1];
      ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 16, y);
      ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 3); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 16); ctx.stroke();
    });
    ctx.translate(x, y);
    const s = g && v.toScreen(g.lon, g.lat);
    if(s && Math.hypot(s.x - x, s.y - y) > 24){
      ctx.save();
      ctx.rotate(Math.atan2(s.x - x, y - s.y));
      ctx.strokeStyle = P.green; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, -36); ctx.moveTo(-3, -31); ctx.lineTo(0, -36); ctx.lineTo(3, -31); ctx.stroke();
      ctx.restore();
    }
    ctx.rotate(v.rot);
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(3, -20); ctx.lineTo(-3, -20); ctx.closePath();
    ctx.fillStyle = P.white; ctx.fill();
    ctx.restore();
  } });

  // ---- Vald punkt ----
  let selName = '';                                    // namn pa en vald punkt utanfor listan
  const upksOnMap = function(){
    const out = [], seen = new Set();
    draw.state().on.forEach(function(id){
      const ol = draw.state().oleats.find(function(x){ return x.id === id; });
      if(ol && ol.upk && !seen.has(ol.upk)){ seen.add(ol.upk); lists.upks(ol.upk).forEach(function(u){ out.push(u); }); }
    });
    return out;
  };
  // Narmaste punkt inom fingrets traffyta. Listpunkter gar fore UPK-prickar vid lika avstand.
  function hitAt(p){
    let best = null, bd = TOUCH_PX;
    const test = function(q, res){
      const s = view.toScreen(q.lon, q.lat), d = Math.hypot(s.x - p.x, s.y - p.y);
      if(d <= bd){ bd = d; best = res; }
    };
    upksOnMap().forEach(function(u){ test(u, { upk: u }); });
    const l = lists.current();
    if(l) l.points.forEach(function(pt){ test(pt, { pt: pt }); });
    return best;
  }
  const crosshair = function(){ return { x: view.w / 2, y: view.h / 2 }; };
  const atCrosshair = function(){ const c = crosshair(); return view.toLonLat(c.x, c.y); };
  // Tryck pa en punkt = valj den. Annars: finns en aktiv punkt avmarkeras den, annars hamnar
  // en ny vid harkorset, inte under fingret.
  // Samma beslut for musklick (pointSelect) och fingertryck (MapTouch).
  function pick(p){
    const h = hitAt(p);
    if(h && h.pt) lists.select(h.pt);
    else if(h){ selName = 'UPK ' + h.upk.label; sel.set(h.upk, 'upk'); }
    else if(sel.get()) sel.clear();
    else{ selName = ''; sel.set(atCrosshair()); }
    return true;
  }
  const sel = MapTools.pointSelect(view, { color: P.blue, outline: P.bg,
    marker: function(){ return !lists.selected(); },
    pick: pick,
    onChange: function(pt, src){
      if(src !== 'list' && lists.selected()) lists.select(null, true);
      renderHud();
    } });
  lists = MapLists({ onChange: function(){ view.redraw(); },
                     onSelect: function(pt){ sel.set(pt, 'list'); } });

  const gps = MapGps(view, { color: P.green, outline: P.bg,
    onFix: function(){ MapDiag.clear('GPS-01'); renderHud(); refreshBar(); },
    onError: function(t){ MapDiag.raise('GPS-01', t); refreshBar(); } });

  // NUP: norr upp, gar inte att vrida. GPS: foljer positionen och riktningen (om GPS ar pa), tva
  // fingrar zoomar bara. FREE: allt gar. Flyttar man kartan i GPS-laget hamnar man i FREE.
  function setOri(m){
    ori = m;
    if(m === 'nup') view.setRotation(0);
    gps.setFollow(m === 'gps');
    refreshBar(); saveUi();
  }
  const release = function(){ if(ori === 'gps') setOri('free'); };
  gps.setFollow(ori === 'gps');

  // RLR: som pa datorn, men pekaren ar harkorset. Finns en aktiv punkt borjar linjalen dar,
  // annan ande foljer harkorset tills man trycker. Andarna gar att dra.
  const ruler = MapTools.ruler(view, { color: P.white, outline: P.bg, label: function(a, b){
    const g = MapCoords.inverse(a.lat, a.lon, b.lat, b.lon);
    return fmtDist(g.dist) + '   ' + fmtAng(g.az);
  } });
  function setRuler(on){
    view.pointer = on ? crosshair() : null;
    ruler.set(on, on ? sel.get() : null);
  }

  MapTouch(view, {
    tap: function(p){
      if(draw.sketching()) return;
      if(ruler.active()) ruler.click(crosshair()); else pick(p);
    },
    grab: function(p){ return draw.sketching() || ruler.active() ? view.grabAt(p) : null; },
    moved: release,
    lock: function(){ return { noRot: ori !== 'free', noPan: ori === 'gps' }; },
  });

  // ---- Overst, kompass, skala, laddning ----
  // Koordinaten tar 85 % av overkanten. Storleken raknas bara nar textens langd eller bredden andras,
  // annars skulle den hoppa med varje siffra.
  const fitCtx = document.createElement('canvas').getContext('2d');
  let fitKey = '';
  function fitCenter(el, t){
    const w = el.clientWidth, key = t.length + '/' + w;
    if(key === fitKey || !w) return;
    fitKey = key;
    fitCtx.font = '100px ViperDisplay';
    el.style.fontSize = Math.min(38, Math.floor(85 * w / fitCtx.measureText(t.replace(/\d/g, '8')).width)) + 'px';
    $('m-stage').style.setProperty('--m-center-h', el.offsetHeight + 'px');
  }
  function renderHud(){
    const t = MapCoords.format(fmt, view.lat, view.lon), g = gps.pos(), a = sel.get(), pt = lists.selected();
    const name = pt ? pt.name : selName;
    $('m-center').textContent = t;
    fitCenter($('m-center'), t);
    $('m-pos').textContent = g ? MapCoords.format(fmt, g.lat, g.lon) : '';
    $('m-sel').textContent = a ? MapCoords.format(fmt, a.lat, a.lon) + (name ? '\n' + name : '') : '';
  }
  $('map-compass').addEventListener('click', function(){ release(); view.setRotation(0); });
  // Kartleverantorer och krediter, visas pa MAP-sidan.
  const credits = function(){
    const a = MAPS[base].attribution;
    return (/Esri/.test(a) ? 'Powered by Esri · ' : '') + a + (ML.water.visible || ML.roads.visible || ML.names.visible ? ' · OpenFreeMap © OpenMapTiles © OpenStreetMap' : '');
  };
  let lastStatus = null;
  view.onChange(function(v){
    renderHud();
    if(ruler.active()) v.pointer = crosshair();        // skarmen kan ha andrat storlek
    const deg = v.rot * 180 / Math.PI;
    $('map-compass').hidden = Math.abs(Math.sin(v.rot / 2)) < 0.0025;   // norr upp (inom ~0,3 grader)
    $('map-compass-rot').setAttribute('transform', 'rotate(' + deg + ')');
    $('map-compass-up').textContent = fmtAng((360 - deg) % 360);
    // Nederkantens langd i meter, tva vardesiffror.
    $('map-scale-txt').textContent = String(Number(MapScale.meters(v.zoom, v.toLonLat(v.w / 2, v.h).lat, v.w).toPrecision(2)));
    let done = 0, total = 0;
    const off = [];
    v.layers.forEach(function(l){
      if(!l.visible) return;
      if(l.loading){ done += l.loading.done; total += l.loading.total; }
      if(l.status === 'OFFL') off.push(l.id);
    });
    $('m-load').hidden = done >= total;
    if(total) $('m-load-bar').style.width = Math.floor(done / total * 100) + '%';
    const st = off.join(',');
    if(st !== lastStatus){
      lastStatus = st;
      if(st) MapDiag.raise('TILE-02', st); else MapDiag.clear('TILE-02');
    }
  });

  // ---- Slots: 6 i bottenmarginalen, 6 utmed vanster kant (overst forst). Utan label = tom. ----
  const inSketch = function(t){ return function(){ return draw.sketching() ? t : ''; }; };
  const SLOTS = [
    { label: 'MAP', panel: 'map' },
    { label: 'NAV', panel: 'nav', also: 'goto' },
    {},
    {},
    { label: 'GPS', on: function(){ return gps.on(); },
      // Felmarginal | sekunder sedan senaste fix.
      note: function(){
        if(!gps.on()) return '';
        const g = gps.pos();
        return g ? Math.round(g.acc) + ' | ' + Math.max(0, Math.round((Date.now() - g.t) / 1000)) : '-- | --';
      },
      act: function(){ gps.setOn(!gps.on()); renderHud(); } },
    { label: 'OPTN', panel: 'optn', also: 'diag', warn: function(){ return MapDiag.active().length > 0; } },
    { side: true, label: function(){ return ori.toUpperCase(); },
      act: function(){ setOri({ nup: 'gps', gps: 'free', free: 'nup' }[ori]); } },
    { side: true, label: 'SKCH', on: function(){ return draw.sketching(); }, act: function(){
        const b = !draw.sketching();
        draw.setSketch(b);
        if(b){ showPanel(null); sel.clear(); setRuler(false); release(); }   // kartan ska ligga still under fingret
      } },
    { side: true, label: 'RLR', on: function(){ return ruler.active(); }, act: function(){
        const b = !ruler.active();
        if(b) draw.setSketch(false);
        setRuler(b);
      } },
    // Skissens funktioner, som Select functions pa datorn. Tryck = nasta farg, texten har fargen.
    { side: true, color: function(){ return P[skCol]; },
      label: function(){ return draw.sketching() ? SK_COLORS.find(function(c){ return c[0] === skCol; })[1] : ''; },
      act: function(){
        const i = SK_COLORS.findIndex(function(c){ return c[0] === skCol; });
        skCol = SK_COLORS[(i + 1) % SK_COLORS.length][0];
        draw.setColor(skCol);
      } },
    { side: true, label: inSketch('ERSE'), hold: function(){ draw.clearSketch(); } },
    { side: true, label: inSketch('UNDO'), act: function(){ draw.popSketch(); } },
  ];
  let panel = null;
  function button(parent, label, sub, cls, act){
    const b = document.createElement('button');
    b.className = 'm-btn' + (cls ? ' ' + cls : '');
    const t = document.createElement('span'); t.textContent = label; b.appendChild(t);
    const s = document.createElement('small'); s.textContent = sub || ''; b.appendChild(s);
    if(act) b.addEventListener('click', act);
    parent.appendChild(b);
    return b;
  }
  SLOTS.forEach(function(d){
    d.el = document.createElement('button');
    d.el.className = 'm-slot';
    d.el.appendChild(document.createElement('span'));
    d.el.appendChild(document.createElement('small'));
    d.el.addEventListener('click', function(){
      if(d.panel) showPanel(panel === d.panel ? null : d.panel); else if(d.act) d.act();
      saveUi(); refreshBar();
    });
    if(d.hold){
      let t = null;
      const stop = function(){ clearTimeout(t); $('m-erase').hidden = true; };
      d.el.addEventListener('pointerdown', function(){
        $('m-erase').hidden = false;
        t = setTimeout(function(){ d.hold(); stop(); }, HOLD_MS);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(e){ d.el.addEventListener(e, stop); });
    }
    $(d.side ? 'm-side' : 'm-bar').appendChild(d.el);
  });
  function refreshBar(){
    SLOTS.forEach(function(d){
      const label = typeof d.label === 'function' ? d.label() : d.label || '';
      const open = !!d.panel && (panel === d.panel || panel === d.also);
      d.el.firstChild.textContent = label;
      d.el.style.visibility = label ? '' : 'hidden';
      d.el.style.color = d.color ? d.color() : '';
      d.el.lastChild.textContent = d.note ? d.note() : '';
      d.el.classList.toggle('current', open);
      d.el.classList.toggle('on', !!d.on && d.on());
      d.el.classList.toggle('warn', !open && !!d.warn && d.warn());
    });
  }
  setInterval(refreshBar, 1000);                       // tiden sedan senaste fix
  MapDiag.onChange(function(){ refreshBar(); if(panel === 'diag') renderPanel(); });

  // ---- Paneler ----
  function showPanel(name){ panel = name; renderPanel(); refreshBar(); }
  function renderPanel(){
    const el = $('m-panel');
    el.hidden = !panel;
    if(!panel) return;
    const top = el.scrollTop;
    el.innerHTML = '';
    PANELS[panel](el);
    el.scrollTop = top;
  }
  const again = function(){ saveUi(); renderPanel(); refreshBar(); };
  const textEl = function(parent, cls, text){ const d = document.createElement('div'); d.className = cls; d.textContent = text; parent.appendChild(d); return d; };
  const rowsEl = function(parent, cls){ const d = document.createElement('div'); d.className = cls || 'm-rows'; parent.appendChild(d); return d; };

  // Batteri: finns bara i webblasare med Battery API. Safari pa iPhone har det inte.
  let battery = null;
  if(navigator.getBattery) navigator.getBattery().then(function(b){
    battery = b;
    b.addEventListener('dischargingtimechange', function(){ if(panel === 'optn') renderPanel(); });
  }, function(){});
  function batteryLeft(){
    if(!battery) return '--:--';
    if(battery.charging || !isFinite(battery.dischargingTime)) return 'CHRG';
    const m = Math.round(battery.dischargingTime / 60);
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  const choice = function(on){ return on ? 'current' : ''; };   // valt alternativ = vit ram
  const toggle = function(on){ return on ? 'on' : ''; };        // av/pa = vit fyllning runt texten
  const PANELS = {
    map: function(el){
      button(rowsEl(el, 'm-grid'), 'BASE', MAPS[base].short, choice(baseOpen), function(){ baseOpen = !baseOpen; renderPanel(); });
      if(baseOpen){
        const g = rowsEl(el, 'm-grid');
        bases.forEach(function(x){ x.maps.forEach(function(m){
          button(g, m.short, '', choice(m.id === base), function(){ base = m.id; baseOpen = false; applyBase(); again(); });
        }); });
      }
      if(!MAPS[base].dem){
        const r = rowsEl(el, 'm-grid');
        button(r, 'DIM', String(dim));
        button(r, '▼', '', '', function(){ dim = Math.max(1, dim - 1); applyBase(); again(); });
        button(r, '▲', '', '', function(){ dim = Math.min(10, dim + 1); applyBase(); again(); });
      }
      textEl(el, 'm-head', 'LAYERS');
      const c = rowsEl(el, 'm-grid2');
      Object.keys(OVERLAYS).forEach(function(k){
        const o = OVERLAYS[k];
        button(c, o.label, '', toggle(o.l.visible), function(){ o.set(!o.l.visible); view.redraw(); again(); });
      });
      const st = draw.state();
      if(st.oleats.length){
        textEl(el, 'm-head', 'OLEAT');
        const r = rowsEl(el, 'm-grid2');
        st.oleats.forEach(function(ol){
          button(r, ol.name, '', toggle(st.on.indexOf(ol.id) >= 0), function(){ draw.toggleOleat(ol.id); ui.on = draw.activeSet().on; again(); });
        });
      }
      textEl(el, 'm-credit', credits());
    },
    nav: function(el){
      const top = rowsEl(el, 'm-grid');
      button(top, 'GOTO', '', '', function(){ showPanel('goto'); });
      button(top, 'IMPT', '', '', function(){ $('m-file').click(); });
      const st = lists.state();
      if(!st.lists.length) return;
      textEl(el, 'm-head', 'LIST');
      const r = rowsEl(el, 'm-grid2');
      const pickList = function(i){
        st.active = i; ui.listId = i == null ? null : st.lists[i].id;
        lists.select(null);
        // Som pa datorn: en lista med lankade oleater slar pa dem.
        const ids = i == null ? [] : lists.linked(st.lists[i]).filter(draw.has);
        if(ids.length){ draw.setActiveSet({ on: ids }); ui.on = ids; }
        again();
      };
      button(r, 'NONE', '', choice(st.active == null), function(){ pickList(null); });
      st.lists.forEach(function(l, i){
        button(r, l.name, '', choice(st.active === i), function(){ pickList(i); });
      });
      const cur = lists.current();
      if(!cur) return;
      textEl(el, 'm-head', 'POINTS');
      const rows = rowsEl(el);
      cur.points.forEach(function(pt, i){
        const b = document.createElement('button');
        b.className = 'm-btn m-pt ' + choice(pt === lists.selected());
        b.addEventListener('click', function(){
          release();
          view.setCenter(pt.lon, pt.lat, view.zoom < 11 ? 13 : view.zoom);
          lists.select(pt);
          showPanel(null);
        });
        textEl(b, 'm-no', (pt.rte ? '(' + pt.rte + ') ' : '') + (i + 1));
        textEl(b, '', pt.name);
        textEl(b, 'm-crd', MapCoords.format(fmt, pt.lat, pt.lon));
        rows.appendChild(b);
      });
    },
    goto: function(el){
      const f = document.createElement('form'), inp = document.createElement('input');
      f.className = 'm-form';
      inp.className = 'm-input'; inp.placeholder = 'COORD'; inp.setAttribute('enterkeyhint', 'go');
      inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('autocorrect', 'off'); inp.spellcheck = false;
      f.appendChild(inp);
      f.addEventListener('submit', function(ev){
        ev.preventDefault();
        const t = inp.value.trim();
        if(!t) return;
        const p = MapCoords.parseAny(t, fmt);
        if(!p){ MapDiag.raise('CRD-02', t); return; }      // syns som gul OPTN, texten star kvar
        MapDiag.clear('CRD-02');
        inp.blur();
        release();
        view.setCenter(p.lon, p.lat, view.zoom < 11 ? 13 : view.zoom);
        selName = '';
        sel.set(p);
        showPanel(null);
      });
      el.appendChild(f);
      button(f, 'GO', '', '', function(){ f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); }).type = 'button';
      inp.focus();
    },
    optn: function(el){
      const c = rowsEl(el, 'm-grid');
      MapCoords.FORMATS.forEach(function(x){
        button(c, x.short || x.label, '', choice(x.id === fmt), function(){ fmt = x.id; again(); renderHud(); });
      });
      textEl(el, 'm-head', 'ANGLE');
      const a = rowsEl(el, 'm-grid');
      [['deg', 'DEG'], ['mil', 'MIL']].forEach(function(x){
        button(a, x[1], '', choice(x[0] === ang), function(){ ang = x[0]; again(); view.redraw(); });
      });
      textEl(el, 'm-head', 'BATTERY');
      textEl(el, 'm-value', batteryLeft());
      button(rowsEl(el, 'm-grid'), 'DIAG', '', MapDiag.active().length ? 'warn' : '', function(){ showPanel('diag'); }).style.marginTop = '14px';
    },
    // Bara aktiva fel, felen ar sallsynta och skarmen smal.
    diag: function(el){
      const r = rowsEl(el);
      MapDiag.render(r);
      r.querySelectorAll('.dg-row:not(.dg-fail)').forEach(function(x){ x.remove(); });
      r.querySelectorAll('.dg-st').forEach(function(x){ x.textContent = 'FAIL'; });
      if(!r.children.length) textEl(r, 'm-none', 'NO FAULTS');
    },
  };

  // ---- Import: filen kontrolleras HELT innan nagot ersatts. ----
  function importFail(t){ MapDiag.raise('IMP-01', t); showPanel('diag'); }
  $('m-file').addEventListener('change', function(){
    const f = this.files[0];
    this.value = '';
    if(!f) return;
    if(f.size > MAX_FILE){ importFail('file too large (' + Math.round(f.size / 1e6) + ' MB)'); return; }
    f.text().then(function(t){
      let d;
      try{ d = MapExport.parse(t); }catch(e){ importFail(e.message); return; }
      if(!ls.set(KEY_DATA, t)){ importFail('storage full'); return; }
      MapDiag.clear('IMP-01');
      data = d;
      delete ui.listId; delete ui.on;
      unit = d.dist || unit; ang = d.ang || ang; fmt = d.fmt || fmt;
      lists.select(null, true); sel.clear();
      lists.load(); draw.load();
      release();
      if(d.view){ view.setCenter(d.view.lon, d.view.lat, d.view.zoom); view.setRotation(ori === 'nup' ? 0 : d.view.rot || 0); }
      showPanel(null); saveUi();
    }, function(e){ importFail(e.message); });
  });

  // Telefonens val sparas nar man gor nagot och nar appen lamnas (iOS stanger utan varning).
  function saveUi(){
    const ov = {};
    Object.keys(OVERLAYS).forEach(function(k){ ov[k] = OVERLAYS[k].l.visible; });
    ls.set(KEY_UI, JSON.stringify(Object.assign(ui, { unit: unit, ang: ang, fmt: fmt, base: base, dim: dim, ov: ov, ori: ori, skCol: skCol,
      lon: view.lon, lat: view.lat, zoom: view.zoom, rot: view.rot })));
  }
  document.addEventListener('visibilitychange', function(){ if(document.hidden) saveUi(); });
  window.addEventListener('pagehide', saveUi);

  // ---- Start ----
  applyBase();
  lists.load(); draw.load();
  draw.setColor(skCol);
  if(ui.listId !== undefined){
    const st = lists.state(), i = st.lists.findIndex(function(l){ return l.id === ui.listId; });
    st.active = i < 0 ? null : i;
  }
  if(ui.on) draw.setActiveSet({ on: ui.on });
  refreshBar();
  view.resize();                                       // knappmenyn finns nu - kartan far ratt hojd
  // Canvastext anvander fonten forst nar den ar laddad.
  if(document.fonts && document.fonts.load) document.fonts.load('18px ViperDisplay').then(function(){ fitKey = ''; renderHud(); ML.names.invalidate(); view.redraw(); });
  // Service worker bara pa en riktig https-adress - lokalt skulle den ge gamla filer under utveckling.
  if('serviceWorker' in navigator && window.isSecureContext && !/^(localhost|127\.)/.test(location.hostname)){
    navigator.serviceWorker.register('sw.js').catch(function(e){ MapDiag.raise('RES-01', 'sw.js: ' + e.message); });
  }
  window.MAPM = { view: view, lists: lists, draw: draw, sel: sel, gps: gps, ruler: ruler, ML: ML, showPanel: showPanel, hitAt: hitAt };
})();
