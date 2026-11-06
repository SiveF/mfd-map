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
  const BAR_PX = 100, TOUCH_PX = 24, MAX_FILE = 4e6;   // skalstock, traffyta for fingret, exportfilens tak

  // Lagre tak an datorn: iOS stanger sidan om den tar for mycket minne. Rymmer det som
  // syns pa en telefon aven vriden (~25 rutor), en DEM-ruta ar ~1 MB.
  Object.assign(MapLayers.limits, { rasterTiles: 120, demTiles: 40, demProducts: 30, contourSS: 2 });
  const VT_TILES = 80;

  MapDiag.CATALOG.push(['IMP-01', 'Exportfilen kunde inte läsas in - tidigare data ligger kvar'],
                       ['SKC-01', 'SKCH: skissen kunde inte sparas på telefonen'],
                       ['GPS-01', 'GPS: ingen position (nekad, ingen signal eller sidan körs utan https)']);

  // localStorage kan kasta (privat lage, full lagring).
  const ls = {
    get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
    set: function(k, v){ try{ localStorage.setItem(k, v); return true; }catch(e){ return false; } },
  };

  // ---- Importerad data + MapStore for MapLists/MapDraw. Bara skissen sparas, for sig. ----
  let data = null;
  try{ const t = ls.get(KEY_DATA); if(t) data = MapExport.parse(t); }
  catch(e){ MapDiag.raise('IMP-01', 'sparad data: ' + e.message); }
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
        else MapDiag.raise('SKC-01', 'lagringen är full');
      },
    };
  };

  // ---- Telefonens egna val ----
  let ui = {};
  try{ ui = JSON.parse(ls.get(KEY_UI)) || {}; }catch(e){ ui = {}; }
  let unit = ui.unit || (data && data.dist) || 'km', ang = ui.ang || (data && data.ang) || 'deg', fmt = ui.fmt || (data && data.fmt) || 'dd';
  let base = ui.base || 'strt', dim = ui.dim || 10, baseOpen = false;
  const start = ui.lon != null ? ui : (data && data.view) || { lat: 62, lon: 16, zoom: 4, rot: 0 };
  const fmtDist = function(m){ return MapMarks.fmtDist(m, unit); };
  const fmtAng = function(az){ return MapMarks.fmtAng(az, ang); };

  // ---- Kartan (ritordning = ordningen har, samma som pa datorn) ----
  const view = MapView($('m-map'), { bg: P.bg, lat: start.lat, lon: start.lon, zoom: start.zoom, minZoom: 2, maxZoom: 19,
                                     dpr: Math.min(2, window.devicePixelRatio || 1) });
  view.resize();
  view.setRotation(start.rot || 0);
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
    names:     { label: 'NAMES', l: ML.names, set: function(v){ ML.names.visible = v; } },
    roads:     { label: 'ROADS', l: ML.roads, set: function(v){ ML.roads.visible = v; roadsC.invalidate(); } },
    water:     { label: 'WATER', l: ML.water, set: function(v){ ML.water.visible = v; waterC.invalidate(); } },
    topolines: { label: 'TOPO LINES', l: ML.topoLines, set: function(v){ ML.topoLines.visible = v; } },
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
  // Litet kors i kartans mitt: det ar den punkten koordinaten overst galler.
  view.addLayer({ id: 'center', visible: true, status: '', draw: function(ctx, v){
    if(draw.sketching()) return;
    const x = v.w / 2, y = v.h / 2;
    ctx.save();
    [[P.bg, 4], [P.white, 1.5]].forEach(function(s){
      ctx.strokeStyle = s[0]; ctx.lineWidth = s[1];
      ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 9, y);
      ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 3); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 9); ctx.stroke();
    });
    ctx.restore();
  } });

  // ---- Vald punkt ----
  let selTitle = '', actH = null;
  const elev = function(lat, lon){ return MapDem.sample(S.dem.url, S.dem.maxZoom, lat, lon); };
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
  // Tryck pa en punkt = valj den; pa tom karta = stang kortet, eller (inget valt) fri punkt.
  // true = hanterat. Samma beslut for musklick (pointSelect) och fingertryck (MapTouch).
  function pick(p){
    const h = hitAt(p);
    if(h && h.pt){ lists.select(h.pt); return true; }
    if(h){ selTitle = 'UPK ' + h.upk.label; sel.set(h.upk, 'upk'); return true; }
    if(sel.get()){ sel.clear(); return true; }
    selTitle = 'PUNKT';
    return false;
  }
  const sel = MapTools.pointSelect(view, { color: P.blue, outline: P.bg,
    marker: function(){ return !lists.selected(); },
    pick: pick,
    onChange: function(pt, src){
      if(src !== 'list' && lists.selected()) lists.select(null, true);
      actH = null;
      if(pt){
        const k = pt.lat + ',' + pt.lon;
        elev(pt.lat, pt.lon).then(function(h){ const a = sel.get(); if(a && a.lat + ',' + a.lon === k){ actH = h; renderPoint(); } });
      }
      renderPoint();
    } });
  lists = MapLists({ onChange: function(){ view.redraw(); },
                     onSelect: function(pt){ sel.set(pt, 'list'); } });

  const gps = MapGps(view, { color: P.blue, outline: P.bg,
    onFix: function(){ MapDiag.clear('GPS-01'); renderPoint(); renderHud(); renderGps(); },
    onError: function(t){ MapDiag.raise('GPS-01', t); refreshBar(); } });

  MapTouch(view, {
    tap: function(p){ if(!draw.sketching() && !pick(p)) sel.set(view.toLonLat(p.x, p.y)); },
    grab: function(p){ return draw.sketching() ? view.grabAt(p) : null; },
    moved: function(){ if(gps.follow()){ gps.setFollow(false); refreshBar(); } },
  });
  function renderPoint(){
    const el = $('m-point'), a = sel.get();
    el.hidden = !a;
    if(!a) return;
    const pt = lists.selected(), l = lists.current();
    el.innerHTML = '';
    const add = function(cls, text, tag){ const d = document.createElement(tag || 'div'); d.className = cls; d.textContent = text; el.appendChild(d); return d; };
    add('mp-name', pt ? pt.name : selTitle);
    const x = add('m-btn', 'X', 'button');
    x.addEventListener('click', function(){ sel.clear(); });
    x.style.gridRow = 'span 2';
    add('mp-sub', pt ? (l ? l.name : '') + (pt.type ? ' · ' + pt.type.toUpperCase() : '') + (pt.rte ? ' · RUTT ' + pt.rte : '') : ' ');
    add('mp-line', MapCoords.format(fmt, a.lat, a.lon));
    add('mp-line', 'HÖJD ' + (actH == null ? '--' : Math.round(actH) + ' M'));
    const g = gps.pos(), inv = g && MapCoords.inverse(g.lat, g.lon, a.lat, a.lon);
    add('mp-line', 'AVST ' + (inv ? fmtDist(inv.dist) : '--') + '   BÄR ' + (inv ? fmtAng(inv.az) : '--'));
  }

  // ---- Overst, kompass, skalstock, kartleverantor, laddning ----
  function renderHud(){
    $('m-center').textContent = MapCoords.format(fmt, view.lat, view.lon);
    const g = gps.pos();
    $('m-pos').textContent = g ? MapCoords.format(fmt, g.lat, g.lon) + '  ±' + Math.round(g.acc) + ' M' : '';
  }
  $('map-scale-bar').style.width = BAR_PX + 'px';
  $('map-compass').addEventListener('click', function(){ view.setRotation(0); });
  let lastStatus = null;
  view.onChange(function(v){
    renderHud();
    const deg = v.rot * 180 / Math.PI;
    $('map-compass-rot').setAttribute('transform', 'rotate(' + deg + ')');
    $('map-compass-up').textContent = fmtAng((360 - deg) % 360);
    $('map-scale-txt').textContent = MapScale.info(v.zoom, v.lat, BAR_PX, unit).text;
    $('map-src').textContent = (/Esri/.test(MAPS[base].attribution) ? 'Powered by Esri · ' : '') + MAPS[base].attribution + (ML.water.visible || ML.roads.visible || ML.names.visible ? ' · OpenFreeMap © OpenMapTiles © OpenStreetMap' : '');
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

  // ---- Slots. 1-6 i bottenmarginalen, 7-12 utmed vanster kant (nerifran). Utan label = tom. ----
  const SLOTS = [
    { label: 'MAP', panel: 'map' },
    { label: 'NAV', panel: 'nav', also: 'goto' },
    {},
    { label: 'SKCH', on: function(){ return draw.sketching(); }, act: function(){
        const b = !draw.sketching();
        draw.setSketch(b);
        if(b){ showPanel(null); sel.clear(); gps.setFollow(false); }   // kartan ska ligga still under fingret
      } },
    { label: 'GPS', panel: 'gps', on: function(){ return gps.on(); } },
    { label: 'OPTN', panel: 'optn', also: 'diag', warn: function(){ return MapDiag.active().length > 0; } },
    // Vanster kant: det aktiva verktygets funktioner (som Select functions pa datorn).
    { side: true, label: function(){ return draw.sketching() ? 'UNDO' : ''; }, act: function(){ draw.popSketch(); } },
    { side: true }, { side: true }, { side: true }, { side: true }, { side: true },
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
    d.el.addEventListener('click', function(){
      if(d.panel) showPanel(panel === d.panel ? null : d.panel); else if(d.act) d.act();
      saveUi(); refreshBar();
    });
    $(d.side ? 'm-side' : 'm-bar').appendChild(d.el);
  });
  function refreshBar(){
    SLOTS.forEach(function(d){
      const label = typeof d.label === 'function' ? d.label() : d.label || '';
      const open = !!d.panel && (panel === d.panel || panel === d.also);
      d.el.firstChild.textContent = label;
      d.el.style.visibility = label ? '' : 'hidden';
      d.el.classList.toggle('on', open || (!!d.on && d.on()));
      d.el.classList.toggle('warn', !open && !!d.warn && d.warn());
    });
  }
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

  const kv = function(parent, key, val, id){
    const d = document.createElement('div'); d.className = 'm-kv';
    const k = document.createElement('span'); k.textContent = key; d.appendChild(k);
    const v = document.createElement('span'); v.textContent = val; if(id) v.id = id; d.appendChild(v);
    parent.appendChild(d);
  };
  // Lever i oppen GPS-panel: bara texten byts, knapparna ligger kvar (annars missas tryck).
  function renderGps(){
    const a = $('m-gps-age'), g = gps.pos();
    if(!a) return;
    const age = g ? Math.max(0, Math.round((Date.now() - g.t) / 1000)) : null;
    a.textContent = age == null ? '--' : age < 60 ? age + ' S' : Math.floor(age / 60) + ':' + String(age % 60).padStart(2, '0');
    $('m-gps-acc').textContent = g ? '±' + Math.round(g.acc) + ' M' : '--';
  }
  setInterval(renderGps, 1000);

  // Batteri: finns bara i webblasare med Battery API. Safari pa iPhone har det inte.
  let battery = null;
  if(navigator.getBattery) navigator.getBattery().then(function(b){
    battery = b;
    b.addEventListener('dischargingtimechange', function(){ if(panel === 'optn') renderPanel(); });
  }, function(){});
  function batteryLeft(){
    if(!battery) return '--:--';
    if(battery.charging || !isFinite(battery.dischargingTime)) return 'LADDAR';
    const m = Math.round(battery.dischargingTime / 60);
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  const PANELS = {
    map: function(el){
      button(el, 'BASE: ' + MAPS[base].short, '', 'm-row', function(){ baseOpen = !baseOpen; renderPanel(); });
      if(baseOpen) bases.forEach(function(g){
        textEl(el, 'm-head', g.head);
        const r = rowsEl(el);
        g.maps.forEach(function(m){
          button(r, m.label, '', 'm-row' + (m.id === base ? ' on' : ''), function(){ base = m.id; baseOpen = false; applyBase(); again(); });
        });
      });
      if(!MAPS[base].dem){
        textEl(el, 'm-head', 'LJUSSTYRKA');
        const r = rowsEl(el, 'm-dim');
        button(r, '-', '', '', function(){ dim = Math.max(1, dim - 1); applyBase(); again(); });
        textEl(r, '', String(dim));
        button(r, '+', '', '', function(){ dim = Math.min(10, dim + 1); applyBase(); again(); });
      }
      textEl(el, 'm-head', 'LAYERS');
      const c = rowsEl(el, 'm-grid2');
      Object.keys(OVERLAYS).forEach(function(k){
        const o = OVERLAYS[k];
        button(c, o.label, '', o.l.visible ? 'on' : '', function(){ o.set(!o.l.visible); view.redraw(); again(); });
      });
      textEl(el, 'm-head', 'OLEAT');
      const st = draw.state();
      if(!st.oleats.length){ textEl(el, 'm-note', 'INGA OLEATER. IMPORTERA EN EXPORTFIL FRÅN DATORN (NAV).'); return; }
      const r = rowsEl(el);
      st.oleats.forEach(function(ol){
        const upk = ol.upk && lists.all().find(function(l){ return l.id === ol.upk; });
        button(r, ol.name, ol.shapes.length + ' FIGURER' + (upk ? ' · UPK ' + upk.name : ''),
               'm-row' + (st.on.indexOf(ol.id) >= 0 ? ' on' : ''), function(){ draw.toggleOleat(ol.id); ui.on = draw.activeSet().on; again(); });
      });
    },
    nav: function(el){
      textEl(el, 'm-title', 'NAV');
      const top = rowsEl(el, 'm-grid2');
      button(top, 'GOTO', '', '', function(){ showPanel('goto'); });
      button(top, 'IMPORT', '', '', function(){ $('m-file').click(); });
      textEl(el, 'm-note', data
        ? 'EXPORTERAD ' + String(data.exported || '').slice(0, 16).replace('T', ' ') + ' UTC · ' + data.lists.lists.length + ' LISTOR · ' + data.drawings.oleats.length + ' OLEATER. IMPORT ERSÄTTER ALLT UTOM SKISSEN.'
        : 'INGEN DATA ÄNNU. IMPORTERA EN EXPORTFIL FRÅN DATORN.');
      const st = lists.state();
      if(!st.lists.length) return;
      textEl(el, 'm-head', 'LIST');
      const r = rowsEl(el);
      const pickList = function(i){
        st.active = i; ui.listId = i == null ? null : st.lists[i].id;
        lists.select(null);
        // Som pa datorn: en lista med lankade oleater slar pa dem.
        const ids = i == null ? [] : lists.linked(st.lists[i]).filter(draw.has);
        if(ids.length){ draw.setActiveSet({ on: ids }); ui.on = ids; }
        again();
      };
      button(r, 'NONE', '', 'm-row' + (st.active == null ? ' on' : ''), function(){ pickList(null); });
      st.lists.forEach(function(l, i){
        button(r, l.name, l.points.length + ' PUNKTER', 'm-row' + (st.active === i ? ' on' : ''), function(){ pickList(i); });
      });
      const cur = lists.current();
      if(!cur) return;
      textEl(el, 'm-head', 'PUNKTER I ' + cur.name);
      const rows = rowsEl(el);
      cur.points.forEach(function(pt, i){
        const b = button(rows, '', '', 'm-row m-pt' + (pt === lists.selected() ? ' on' : ''), function(){
          gps.setFollow(false);
          view.setCenter(pt.lon, pt.lat, view.zoom < 11 ? 13 : view.zoom);
          lists.select(pt);
          showPanel(null);
        });
        b.innerHTML = '';
        textEl(b, 'm-no', (pt.rte ? '(' + pt.rte + ') ' : '') + (i + 1));
        textEl(b, '', pt.name);
        textEl(b, 'm-crd', MapCoords.format(fmt, pt.lat, pt.lon));
      });
    },
    goto: function(el){
      textEl(el, 'm-title', 'GOTO');
      const f = document.createElement('form'), inp = document.createElement('input');
      inp.className = 'm-input'; inp.placeholder = 'KOORDINAT'; inp.setAttribute('enterkeyhint', 'go');
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
        gps.setFollow(false);
        view.setCenter(p.lon, p.lat, view.zoom < 11 ? 13 : view.zoom);
        selTitle = 'GOTO';
        sel.set(p);
        showPanel(null);
      });
      el.appendChild(f);
      textEl(el, 'm-note', 'MGRS, UTM, DD, DMS, DDM, SWEREF 99 ELLER RT 90.');
      button(el, 'GÅ', '', 'm-row', function(){ f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); }).style.marginTop = '8px';
      inp.focus();
    },
    gps: function(el){
      textEl(el, 'm-title', 'GPS');
      const c = rowsEl(el, 'm-grid');
      [['hi', 'HI'], ['lo', 'LO'], ['off', 'OFF']].forEach(function(x){
        button(c, x[1], '', x[0] === gps.mode() ? 'on' : '', function(){ gps.setMode(x[0]); renderPoint(); renderHud(); again(); });
      });
      if(gps.on()){
        button(el, 'FÖLJ POSITIONEN', '', 'm-row' + (gps.follow() ? ' on' : ''), function(){ gps.setFollow(!gps.follow()); again(); }).style.marginTop = '8px';
      }
      const box = rowsEl(el, 'm-box');
      box.style.marginTop = '8px';
      kv(box, 'SATELLITER', '--/--');
      kv(box, 'SENASTE FIX', '--', 'm-gps-age');
      kv(box, 'FELMARGINAL', '--', 'm-gps-acc');
      textEl(el, 'm-note', 'IOS VISAR INTE ANTAL SATELLITER FÖR WEBBAPPAR.');
      renderGps();
    },
    optn: function(el){
      textEl(el, 'm-title', 'OPTN');
      const b1 = rowsEl(el, 'm-box');
      textEl(b1, 'm-head', 'KOORDINATFORMAT');
      const c = rowsEl(b1, 'm-grid');
      MapCoords.FORMATS.forEach(function(x){
        button(c, x.short || x.label, '', x.id === fmt ? 'on' : '', function(){ fmt = x.id; again(); renderPoint(); renderHud(); });
      });
      const b2 = rowsEl(el, 'm-box');
      textEl(b2, 'm-head', 'VINKEL');
      const a = rowsEl(b2, 'm-grid2');
      [['deg', 'GRADER'], ['mil', 'STRECK']].forEach(function(x){
        button(a, x[1], '', x[0] === ang ? 'on' : '', function(){ ang = x[0]; again(); renderPoint(); view.redraw(); });
      });
      const b3 = rowsEl(el, 'm-box');
      textEl(b3, 'm-head', 'BATTERI');
      textEl(b3, 'm-big', batteryLeft());
      if(!battery) textEl(b3, 'm-note', 'IOS VISAR INTE BATTERITID FÖR WEBBAPPAR.');
      button(el, 'DIAG', MapDiag.active().length ? MapDiag.active().length + ' FEL' : '',
             'm-row' + (MapDiag.active().length ? ' warn' : ''), function(){ showPanel('diag'); });
    },
    diag: function(el){
      textEl(el, 'm-title', 'DIAG');
      const r = rowsEl(el);
      MapDiag.render(r);
      r.querySelectorAll('.dg-fail').forEach(function(x){ r.prepend(x); });   // lang katalog, smal skarm: felen forst
    },
  };

  // ---- Import: filen kontrolleras HELT innan nagot ersatts. ----
  function importFail(t){ MapDiag.raise('IMP-01', t); showPanel('diag'); }
  $('m-file').addEventListener('change', function(){
    const f = this.files[0];
    this.value = '';
    if(!f) return;
    if(f.size > MAX_FILE){ importFail('filen är för stor (' + Math.round(f.size / 1e6) + ' MB)'); return; }
    f.text().then(function(t){
      let d;
      try{ d = MapExport.parse(t); }catch(e){ importFail(e.message); return; }
      if(!ls.set(KEY_DATA, t)){ importFail('lagringen på telefonen är full'); return; }
      MapDiag.clear('IMP-01');
      data = d;
      delete ui.listId; delete ui.on;
      unit = d.dist || unit; ang = d.ang || ang; fmt = d.fmt || fmt;
      lists.select(null, true); sel.clear();
      lists.load(); draw.load();
      gps.setFollow(false);
      if(d.view){ view.setCenter(d.view.lon, d.view.lat, d.view.zoom); view.setRotation(d.view.rot || 0); }
      showPanel(null); saveUi();
    }, function(e){ importFail(e.message); });
  });

  // Telefonens val sparas nar man gor nagot och nar appen lamnas (iOS stanger utan varning).
  function saveUi(){
    const ov = {};
    Object.keys(OVERLAYS).forEach(function(k){ ov[k] = OVERLAYS[k].l.visible; });
    ls.set(KEY_UI, JSON.stringify(Object.assign(ui, { unit: unit, ang: ang, fmt: fmt, base: base, dim: dim, ov: ov,
      lon: view.lon, lat: view.lat, zoom: view.zoom, rot: view.rot })));
  }
  document.addEventListener('visibilitychange', function(){ if(document.hidden) saveUi(); });
  window.addEventListener('pagehide', saveUi);

  // ---- Start ----
  applyBase();
  lists.load(); draw.load();
  if(ui.listId !== undefined){
    const st = lists.state(), i = st.lists.findIndex(function(l){ return l.id === ui.listId; });
    st.active = i < 0 ? null : i;
  }
  if(ui.on) draw.setActiveSet({ on: ui.on });
  refreshBar();
  view.resize();                                       // knappmenyn finns nu - kartan far ratt hojd
  // Canvastext anvander fonten forst nar den ar laddad.
  if(document.fonts && document.fonts.load) document.fonts.load('18px ViperDisplay').then(function(){ ML.names.invalidate(); view.redraw(); });
  // Service worker bara pa en riktig https-adress - lokalt skulle den ge gamla filer under utveckling.
  if('serviceWorker' in navigator && window.isSecureContext && !/^(localhost|127\.)/.test(location.hostname)){
    navigator.serviceWorker.register('sw.js').catch(function(e){ MapDiag.raise('RES-01', 'sw.js: ' + e.message); });
  }
  window.MAPM = { view: view, lists: lists, draw: draw, sel: sel, gps: gps, ML: ML, showPanel: showPanel, hitAt: hitAt };
})();
