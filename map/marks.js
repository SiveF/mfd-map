/* =====================================================================
   map/marks.js  -  DET DATORN OCH TELEFONEN RITAR LIKA. Palett, enhetstext,
   stilarna for WATER/ROADS/NAMES/TOPO LINES samt lagren for listpunkter och
   rutter. Bara en plats, sa de tva apparna inte kan glida isar.

     const P = MapMarks.palette()     -> farger ur tokens i ui/layout.css, P.tint(a) = temafargen med alfa
     MapMarks.fmtDist(m, unit)        -> '1.23 KM' (unit = km | nm | mi)
     MapMarks.fmtAng(az, ang)         -> '045°' / '0800 MIL' (ang = deg | mil)
     MapMarks.mapLayers(vt, P, dem, step) -> { water, roads, names, topoLines } (dolda, ej tillagda)
     MapMarks.routeLayer(lists, P, fmt, plan) -> rutten i aktiva listan
     MapMarks.pointsLayer(lists, P)   -> aktiva listans punkter
       lists = function -> MapLists; fmt = { dist(m), ang(az) };
       plan (valfri, RTE PLAN pa datorn) = { pt() -> punkten vars strecka redigeras | null,
                                             drag() -> noderna under ett drag | null, node() -> vald nod }
     MapMarks.RING                    -> punktsymbolens radie (traffytan)
   ===================================================================== */
(function(root){
  const rgbOf = function(hex){ const h = hex.replace('#', ''); return [0, 2, 4].map(function(i){ return parseInt(h.substr(i, 2), 16); }); };

  // PALETTEN: MFDsystems tokens ur ui/layout.css. ALLA farger i kartapparna
  // kommer harifran (canvas) eller fran samma tokens i CSS - inga egna varden.
  function palette(){
    const css = getComputedStyle(document.documentElement);
    const tok = function(n){ return css.getPropertyValue(n).trim(); };
    const P = { white: tok('--c-white'), red: tok('--c-red'), yellow: tok('--c-yellow'), green: tok('--c-green'),
                blue: tok('--c-blue'), magenta: tok('--c-magenta'), bg: tok('--bg'), dim: tok('--green-dim'),
                rgb: tok('--green-rgb') };
    P.tint = function(a){ return 'rgba(' + P.rgb + ',' + a + ')'; };   // temafargen med alfa
    return P;
  }

  const fmtDist = function(m, unit){
    if(unit === 'nm') return (m / 1852).toFixed(m < 18520 ? 2 : 1) + ' NM';
    if(unit === 'mi') return (m / 1609.344).toFixed(m < 16093 ? 2 : 1) + ' MI';
    return m < 1000 ? Math.round(m) + ' M' : (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' KM';
  };
  // Vinkel (sann baring): grader 000-359 eller NATO-streck 0000-6399.
  const fmtAng = function(az, ang){
    if(ang === 'mil') return String(Math.round(az * 6400 / 360) % 6400).padStart(4, '0') + ' MIL';
    return String(Math.round(az) % 360).padStart(3, '0') + '°';
  };

  function mapLayers(vt, P, dem, step){
    const tint = P.tint;
    const blueA = function(a){ return 'rgba(' + rgbOf(P.blue).join(',') + ',' + a + ')'; };
    const lineK = function(z){ return z < 9 ? .6 : z < 12 ? .8 : z < 14 ? 1 : z < 16 ? 1.3 : 1.7; };   // bredd efter zoom
    // WATER och ROADS ritas i cache-lager (layers.js cached): panorering = en drawImage.
    const water = root.MapLayers.vtLines(vt, { id: 'water', layer: ['water', 'waterway'], visible: false, scale: lineK,
      styles: function(p, layer){
        if(layer === 'water') return p.class === 'ocean' ? null : 'area';          // havet fylls inte
        return p.class === 'river' ? 'river' : p.class === 'canal' ? 'canal' : p.class === 'stream' ? 'stream' : 'ditch';
      },
      style: { area: { fill: blueA(.22) }, ditch: { stroke: blueA(.7), width: .7 }, stream: { stroke: blueA(.8), width: 1 },
               canal: { stroke: blueA(.85), width: 1.6 }, river: { stroke: blueA(.9), width: 2.2 } } });
    // ROADS: vagtyperna skiljs at med farg, bredd och streckning (storre vagar overst).
    const ROAD = {
      path:      { stroke: tint(.55), width: 1,   dash: [2, 3] },
      track:     { stroke: tint(.65), width: 1.2, dash: [6, 3] },
      service:   { stroke: tint(.45), width: 1 },
      minor:     { stroke: tint(.7),  width: 1.4 },
      ferry:     { stroke: blueA(.9), width: 1.4, dash: [8, 5] },
      rail:      { stroke: P.white,   width: 1.6, dash: [8, 4], casing: P.bg, cwidth: 3.6 },
      tertiary:  { stroke: P.white,   width: 1.8, casing: P.bg, cwidth: 3.8 },
      secondary: { stroke: P.white,   width: 2.6, casing: P.bg, cwidth: 4.8 },
      primary:   { stroke: P.yellow,  width: 2.8, casing: P.bg, cwidth: 5 },
      trunk:     { stroke: P.yellow,  width: 3.4, casing: P.bg, cwidth: 5.8 },
      motorway:  { stroke: P.red,     width: 4,   casing: P.bg, cwidth: 6.6 },
    };
    const roadOf = { transit: 'rail', raceway: 'minor', busway: 'minor', bus_guideway: 'minor' };
    const roads = root.MapLayers.vtLines(vt, { id: 'roads', layer: 'transportation', visible: false, scale: lineK,
      styles: function(p){ const c = roadOf[p.class] || p.class; return ROAD[c] ? c : null; }, style: ROAD });
    // NAMES: orter (ner till enstaka gardar), vattennamn och toppar med hojd - ovanpa allt kartinnehall.
    const names = root.MapLayers.vtNames(vt, { id: 'names', visible: false,
      colors: { text: P.white, dim: tint(.75), water: P.blue, outline: P.bg } });
    const topoLines = root.MapLayers.dem(Object.assign({ id: 'topolines', mode: 'contour', visible: false, step: step,
      line: tint(.35), index: tint(.65), label: tint(.85), outline: P.bg }, dem));
    return { water: water, roads: roads, names: names, topoLines: topoLines };
  }

  // RUTT (RTE i LIST): ruttens punkter i ordning som linjer, varje ben med langd + kurs, och
  // total langd vid sista punkten. En planerad stracka ar GRA och STRECKAD via sina noder;
  // langden galler vagen (ingen kurs - den ar inte rak). Noderna (sma fyrkanter) syns bara
  // medan man planerar - da ar stracken bla.
  function routeLayer(listsOf, P, fmt, plan){
    const geoLen = function(q){ let d = 0; for(let i = 0; i + 1 < q.length; i++) d += root.MapCoords.inverse(q[i].lat, q[i].lon, q[i + 1].lat, q[i + 1].lon).dist; return d; };
    return { id: 'route', visible: true, status: '', draw: function(ctx, v){
      const lists = listsOf();
      const rp = lists ? lists.route() : [];
      if(rp.length < 2) return;
      const S = function(q){ return v.toScreen(q.lon, q.lat); };
      const planPt = plan ? plan.pt() : null, planDrag = plan ? plan.drag() : null, planNode = plan ? plan.node() : -1;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.font = '17px ViperDisplay'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const txt = function(t, x, y){ ctx.lineWidth = 4; ctx.strokeStyle = P.bg; ctx.strokeText(t, x, y); ctx.fillStyle = P.white; ctx.fillText(t, x, y); };
      let tot = 0;
      for(let i = 0; i + 1 < rp.length; i++){
        const a = rp[i], b = rp[i + 1], live = !!planPt && a === planPt;
        const nodes = live && planDrag ? planDrag : (lists.legNodes(a) || []);
        const geo = [a].concat(nodes, [b]), ps = geo.map(S);
        const col = live ? P.blue : nodes.length ? P.dim : P.white;
        ctx.beginPath(); ps.forEach(function(p, k){ if(k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        // Streckad: konturen foljer strecken (inget svart mellan dem).
        ctx.setLineDash(nodes.length ? [12, 7] : []);
        ctx.lineWidth = 6; ctx.strokeStyle = P.bg; ctx.stroke();
        ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
        ctx.setLineDash([]);
        if(live) nodes.forEach(function(q, k){
          const p = ps[k + 1], h = live && k === planNode ? 6 : 4;
          ctx.fillStyle = P.bg; ctx.fillRect(p.x - h - 2, p.y - h - 2, 2 * h + 4, 2 * h + 4);
          ctx.fillStyle = live && k === planNode ? P.blue : col; ctx.fillRect(p.x - h, p.y - h, 2 * h, 2 * h);
        });
        // Texten vid den mittersta delstrackan, vinkelratt ut fran den.
        const len = nodes.length ? geoLen(geo) : root.MapCoords.inverse(a.lat, a.lon, b.lat, b.lon).dist;
        tot += len;
        const m = Math.floor((ps.length - 1) / 2), A = ps[m], B = ps[m + 1];
        let nx = A.y - B.y, ny = B.x - A.x; const n = Math.hypot(nx, ny) || 1;
        nx /= n; ny /= n; if(ny > 0){ nx = -nx; ny = -ny; }
        const label = nodes.length ? fmt.dist(len) : fmt.dist(len) + '  ' + fmt.ang(root.MapCoords.inverse(a.lat, a.lon, b.lat, b.lon).az);
        if(n > 60) txt(label, (A.x + B.x) / 2 + nx * 18, (A.y + B.y) / 2 + ny * 18);
      }
      const e = S(rp[rp.length - 1]);
      ctx.textAlign = 'left';
      txt('TOT ' + fmt.dist(tot), e.x + 14, e.y - 28);
      ctx.restore();
    } };
  }

  // Aktiva listans punkter: vit ring, ordningsnummer ovanfor till vanster, namn nedanfor till hoger.
  // Vald punkt (= active): bla och lite storre ring - inget X. Ovriga flervalda: grona, vanlig storlek.
  const RING = 7;
  // Punktsymboler per TYPE: trace(ctx, x, y, r) ritar konturen, dot = fylld prick i mitten,
  // ext = hur langt ut symbolen nar (i r) - texterna placeras utanfor.
  const SYMBOLS = {
    pt:  { ext: 1,   trace: function(c, x, y, r){ c.arc(x, y, r, 0, 2 * Math.PI); } },
    wp:  { ext: 1.3, trace: function(c, x, y, r){ const k = r * 1.3; c.moveTo(x, y - k); c.lineTo(x + k, y); c.lineTo(x, y + k); c.lineTo(x - k, y); c.closePath(); } },
    // BP: oppen fyrkant (oppningen nedat) - som en stridsstallning sedd ovanifran.
    bp:  { ext: 1.3, trace: function(c, x, y, r){ const k = r * 1.3; c.moveTo(x - k, y + r); c.lineTo(x - k, y - r); c.lineTo(x + k, y - r); c.lineTo(x + k, y + r); } },
    op:  { ext: 1.4, dot: true, trace: function(c, x, y, r){ c.moveTo(x, y - r * 1.4); c.lineTo(x + r * 1.25, y + r * 0.8); c.lineTo(x - r * 1.25, y + r * 0.8); c.closePath(); } },
    cp:  { ext: 1,   trace: function(c, x, y, r){ c.rect(x - r, y - r, 2 * r, 2 * r); } },
    rp:  { ext: 1,   dot: true, trace: function(c, x, y, r){ c.arc(x, y, r, 0, 2 * Math.PI); } },
    trp: { ext: 1.5, trace: function(c, x, y, r){ c.arc(x, y, r * 0.8, 0, 2 * Math.PI);
                                                  c.moveTo(x - r * 1.5, y); c.lineTo(x + r * 1.5, y); c.moveTo(x, y - r * 1.5); c.lineTo(x, y + r * 1.5); } },
    obj: { ext: 1.1, trace: function(c, x, y, r){ c.arc(x, y, r * 1.1, 0, 2 * Math.PI); c.moveTo(x + r * 0.5, y); c.arc(x, y, r * 0.5, 0, 2 * Math.PI); } },
  };
  function pointsLayer(listsOf, P){
    return { id: 'listpts', visible: true, status: '', draw: function(ctx, v){
      const lists = listsOf();
      const l = lists && lists.current();
      if(!l) return;
      ctx.save();
      ctx.font = '18px ViperDisplay';
      ctx.lineJoin = 'round';
      const chosen = lists.selected();
      const draw = function(pt, i){
        const p = v.toScreen(pt.lon, pt.lat);
        if(p.x < -50 || p.y < -50 || p.x > v.w + 50 || p.y > v.h + 50) return;
        const on = pt === chosen, r0 = on ? RING + 3 : RING, col = on ? P.blue : lists.isMulti(pt) ? P.green : P.white;
        const sym = SYMBOLS[pt.type] || SYMBOLS.pt, r = r0 * sym.ext;
        ctx.beginPath(); sym.trace(ctx, p.x, p.y, r0);
        ctx.lineWidth = 5; ctx.strokeStyle = P.bg; ctx.stroke();       // kontur -> syns mot alla bakgrunder
        ctx.lineWidth = on ? 3 : 2; ctx.strokeStyle = col; ctx.stroke();
        if(sym.dot){ ctx.fillStyle = P.bg; ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7); ctx.fillStyle = col; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
        const label = function(t, x, y, align, base){
          ctx.textAlign = align; ctx.textBaseline = base;
          ctx.lineWidth = 4; ctx.strokeStyle = P.bg; ctx.strokeText(t, x, y);
          ctx.fillStyle = col; ctx.fillText(t, x, y);
        };
        label(String(i + 1), p.x - r - 2, p.y - r - 2, 'right', 'bottom');
        label(pt.name, p.x + r + 2, p.y + r + 2, 'left', 'top');
      };
      l.points.forEach(function(pt, i){ if(pt !== chosen && !lists.isMulti(pt)) draw(pt, i); });
      l.points.forEach(function(pt, i){ if(pt !== chosen && lists.isMulti(pt)) draw(pt, i); });
      if(chosen && l.points.indexOf(chosen) >= 0) draw(chosen, l.points.indexOf(chosen));   // overst
      ctx.restore();
    } };
  }

  root.MapMarks = { palette: palette, rgbOf: rgbOf, fmtDist: fmtDist, fmtAng: fmtAng, mapLayers: mapLayers,
                    routeLayer: routeLayer, pointsLayer: pointsLayer, RING: RING };
})(typeof window !== 'undefined' ? window : globalThis);
