/* =====================================================================
   map/draw.js  -  RITVERKTYGET (DRAW), SKISS (SKCH) och OLEATER.

   Figurerna ligger i OLEATER (som LIST for punkter): namngivna samlingar,
   OLEAT1, OLEAT2 ... Bara AKTIV oleat ritas pa kartan och tar emot nya
   figurer; finns ingen aktiv skapas en ny. SKISSEN (SKCH) ar ett eget lager,
   inte en oleat: SKETCH i OLEAT-fonstrets huvud visar/doljer det (bla = pa).
   Sparas via MapStore('drawings') -> map/drawings.json. Allt gar att angra
   (UNDO/REDO, 50 steg).

     const D = MapDraw(view, { colors, outline, onChange, fmt, onRowPick })
       colors = { white: '#fff', ... } ur paletten (namn -> farg)
     D.setMode('rect'|'crcl'|'poly'|'line'|'text'|null) / D.mode()
     D.setSketch(pa) / D.sketching()  -> SKCH: vanster drag ritar, hoger drag suddar
     D.sketchOn() / D.setSketchOn(pa) -> skisslagret synligt (av -> SKCH av ocksa)
     D.click(p, ev)   -> klick i ritlage (skapar figur). true = hanterat.
     D.pick(p)        -> SHIFT-klick: valj figur for redigering (handtag). true = traff.
     D.selected() / D.selectShape(sh) / D.deselect() / D.del()
     D.style() / D.setColor / D.setWidth / D.setFill / D.setScale
     D.render(el, win) -> OLEAT-fonstrets innehall. Klick pa en rad -> opts.onRowPick(sh).
     D.activeName() / D.newOleat() / D.delOleat() / D.undo() / D.redo() / D.canUndo() / D.canRedo()
     D.oleats() -> [{ id, name }]   D.activeId() / D.has(id)   D.state() -> allt (exportfilen)
     MULTI: flera oleater kan vara pa samtidigt (state.on = id:n). Alla ritas och kan valjas;
     den senast pa-slagna ar ARBETSOLEATEN (state.active) som far nya figurer.
     D.activeSet() -> { on: [id], active: id }   D.setActiveSet(set) / D.toggleOleat(id) / D.clearOleats()
     D.activeName() -> namnet, eller 'MULTI' nar flera ar pa.
     (LIST lankar oleater till en lista via id - namn kan bytas)
     UPK: en oleat kan ha en lista som UPK-lista (oleat.upk = listans id). Listans punkter ritas
     som prickar med UPK-numret nar oleaten ar pa. opts.lists() -> [{ id, name }],
     opts.upks(id) -> [{ lat, lon, label }].
     opts.fmt(meter) -> text for matt (bara i ritlage) och fonstrets rader.

   Ritlagen: RECT/LINE = klick 1 + klick 2. CRCL = mitt + klick 2 = radie.
   POLY = klick per horn; klick pa forsta hornet (eller Enter) stanger.
   TEXT = klick, skriv, Enter. Esc avbryter en paborjad figur; utan paborjad
   figur (och utan vald figur) stanger Esc av ritlaget.
   Redigering: SHIFT-klick pa en figur -> handtag. SHIFT-klick igen pa vald
   text = andra texten. Delete tar bort vald figur.
   SKCH: frihandslinjer - varje penndrag (till pennlyftet) ar ett streck.
   Hoger drag suddar HELA streck som pekaren passerar.
   ===================================================================== */
(function(){
  const H = 6;                                          // handtagets halva storlek
  const RES0 = 156543.03392804097;                      // m per px vid zoom 0
  const HISTORY = 50, NAME_MAX = 10;
  const LABEL = { rect: 'RECT', crcl: 'CRCL', poly: 'POLY', line: 'LINE', text: 'TEXT', skch: 'SKCH' };

  function nextName(prefix, items){
    let max = 0;
    items.forEach(function(it){
      const m = String(it.name || '').match(new RegExp('^' + prefix + '(\\d+)$'));
      if(m) max = Math.max(max, +m[1]);
    });
    return prefix + (max + 1);
  }

  const uid = function(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  function MapDraw(view, o){
    const opt = o || {};
    let state = { oleats: [], active: null, on: [], sketch: [], sketchOn: true };
    let mode = null, sketch = false, cur = null, edit = null;
    let undoS = [], redoS = [];
    const style = { color: 'white', width: 2, fill: 'off', scale: false };
    const FILL = { lo: 0.1, hi: 0.2 };                   // opacitet for fyllning
    const store = MapStore('drawings');
    const ll = function(p){ return view.toLonLat(p.x, p.y); };
    const S = function(q){ return view.toScreen(q.lon, q.lat); };
    const mpp = function(lat){ return RES0 * Math.cos(lat * Math.PI / 180) / Math.pow(2, view.zoom); };
    const changed = function(){ view.redraw(); if(opt.onChange) opt.onChange(); };
    const save = function(){ store.save(JSON.stringify(state)); };
    const current = function(){ return state.active == null ? null : state.oleats[state.active]; };
    const byId = function(id){ return state.oleats.find(function(x){ return x.id === id; }) || null; };
    // Oleaterna som ar pa (ritas, kan valjas) och alla deras figurer.
    const visible = function(){ return state.on.map(byId).filter(Boolean); };
    const shapes = function(){ return [].concat.apply([], visible().map(function(x){ return x.shapes; })); };
    // Satt vilka som ar pa + arbetsoleaten (standard: den sista).
    function setOn(ids, primary){
      state.on = ids.filter(function(id, i){ return byId(id) && ids.indexOf(id) === i; });
      const p = state.on.indexOf(primary) >= 0 ? primary : state.on[state.on.length - 1];
      const i = state.oleats.findIndex(function(x){ return x.id === p; });
      state.active = i < 0 ? null : i;
    }

    // Alla andringar: ogonblicksbild for angra -> andring -> spara -> rita om.
    function checkpoint(){
      undoS.push(JSON.stringify(state));
      if(undoS.length > HISTORY) undoS.shift();
      redoS = [];
    }
    function commit(fn){ checkpoint(); fn(); save(); changed(); }
    function restore(from, to){
      if(!from.length) return;
      to.push(JSON.stringify(state));
      state = JSON.parse(from.pop());
      edit = null; cur = null;                         // objekten ar nya
      save(); changed();
    }
    // Aktiv oleat - skapas (OLEATn) om ingen ar aktiv. Anropas inne i commit.
    function ensureOleat(){
      if(!current()){
        const nw = { id: uid(), name: nextName('OLEAT', state.oleats), shapes: [] };
        state.oleats.push(nw);
        setOn([nw.id]);
      }
      return current();
    }

    // Text: storlek efter WDTH. scale = foljer kartans zoom (storleken galler vid z0,
    // zoomen nar texten skapades) - annars alltid samma storlek pa skarmen.
    const sizeOf = function(sh){
      const k = sh.scale && sh.z0 != null ? Math.pow(2, view.zoom - sh.z0) : 1;
      return Math.max(4, Math.min(400, (14 + sh.width * 4) * k));
    };
    const fontOf = function(sh){ return sizeOf(sh) + 'px ViperDisplay'; };

    function load(){
      store.load(function(t){
        if(!t) return;
        try{
          let s = JSON.parse(t);
          // Aldre format (en lista figurer) -> en oleat.
          if(Array.isArray(s)) s = { oleats: s.length ? [{ name: 'OLEAT1', shapes: s }] : [], active: s.length ? 0 : null };
          if(!Array.isArray(s.oleats)) throw new Error('oleats saknas');
          // Skisser i oleaterna (aldre format) flyttas till skisslagret.
          const sketch = Array.isArray(s.sketch) ? s.sketch : [];
          s.oleats.forEach(function(ol){
            if(!ol.id) ol.id = uid();
            ol.shapes.forEach(function(sh){ if(sh.type === 'skch') sketch.push(sh); });
            ol.shapes = ol.shapes.filter(function(sh){ return sh.type !== 'skch'; });
            ol.shapes.forEach(function(sh){ if(!sh.name) sh.name = nextName(LABEL[sh.type] || 'FIG', ol.shapes); });
          });
          state = { oleats: s.oleats, active: (s.active != null && s.oleats[s.active]) ? s.active : null,
                    on: [], sketch: sketch, sketchOn: s.sketchOn !== false };
          const prim = state.active != null ? state.oleats[state.active].id : null;
          setOn(Array.isArray(s.on) ? s.on.concat(prim && s.on.indexOf(prim) < 0 ? [prim] : []) : (prim ? [prim] : []), prim);
          MapDiag.clear('STOR-02');
        }catch(e){ MapDiag.raise('STOR-02', 'drawings: ' + e.message); }
        changed();
      });
    }

    /* ---- Geometri pa skarmen ---- */
    function screenPts(sh){ return sh.pts.map(S); }
    // Rektangelns fyra horn i lat/lon (pts[0] och pts[1] ar motsatta horn). Som
    // fyrhorning foljer den med nar kartan vrids.
    function rectCorners(sh){
      const a = sh.pts[0], b = sh.pts[1];
      return [a, { lat: a.lat, lon: b.lon }, b, { lat: b.lat, lon: a.lon }];
    }
    function radiusPx(sh){ return sh.r / mpp(sh.pts[0].lat); }
    function textBox(sh, ctx){
      const p = S(sh.pts[0]);
      ctx.font = fontOf(sh);
      const w = ctx.measureText(sh.text).width, h = sizeOf(sh);
      return { x: p.x, y: p.y - h / 2, w: w, h: h };
    }
    // Handtagens skarmpositioner + vad de styr. Skisser har inga handtag.
    function handles(sh){
      if(sh.type === 'skch') return [];
      const ps = screenPts(sh);
      if(sh.type === 'crcl') return [{ p: ps[0], i: 0 }, { p: { x: ps[0].x + radiusPx(sh), y: ps[0].y }, r: true }];
      return ps.map(function(p, i){ return { p: p, i: i }; });
    }

    function segDist(p, a, b){
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    }
    function inside(p, ps){
      let c = false;
      for(let i = 0, j = ps.length - 1; i < ps.length; j = i++){
        if((ps[i].y > p.y) !== (ps[j].y > p.y) && p.x < (ps[j].x - ps[i].x) * (p.y - ps[i].y) / (ps[j].y - ps[i].y) + ps[i].x) c = !c;
      }
      return c;
    }
    function hit(sh, p){
      const ps = screenPts(sh), tol = 8 + sh.width;
      if(sh.type === 'crcl') return Math.hypot(p.x - ps[0].x, p.y - ps[0].y) <= radiusPx(sh) + tol;
      if(sh.type === 'text'){ const b = textBox(sh, view.ctx); return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol; }
      if(sh.type === 'rect'){
        const q = rectCorners(sh).map(S);
        if(inside(p, q)) return true;
        for(let i = 0; i < 4; i++) if(segDist(p, q[i], q[(i + 1) % 4]) <= tol) return true;
        return false;
      }
      if(sh.type === 'poly' && inside(p, ps)) return true;
      for(let i = 0; i + 1 < ps.length; i++) if(segDist(p, ps[i], ps[i + 1]) <= tol) return true;
      return sh.type === 'poly' && ps.length > 2 && segDist(p, ps[ps.length - 1], ps[0]) <= tol;
    }

    /* ---- Ritning ---- */
    function trace(ctx, sh, ps){
      ctx.beginPath();
      if(sh.type === 'rect'){ rectCorners(sh).map(S).forEach(function(p, i){ if(i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); }
      else if(sh.type === 'crcl') ctx.arc(ps[0].x, ps[0].y, Math.max(0, radiusPx(sh)), 0, 2 * Math.PI);
      else { ps.forEach(function(p, i){ if(i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); if(sh.type === 'poly' && sh.closed !== false) ctx.closePath(); }
    }
    function drawShape(ctx, sh){
      const col = opt.colors[sh.color] || opt.colors.white;
      if(sh.type === 'text'){
        const p = S(sh.pts[0]);
        ctx.font = fontOf(sh); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 5; ctx.strokeStyle = opt.outline; ctx.strokeText(sh.text, p.x, p.y);
        ctx.fillStyle = col; ctx.fillText(sh.text, p.x, p.y);
        return;
      }
      const ps = screenPts(sh);
      trace(ctx, sh, ps);
      if(FILL[sh.fill] && sh.type !== 'line' && sh.type !== 'skch' && sh.closed !== false){
        ctx.globalAlpha = FILL[sh.fill]; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.lineJoin = sh.type === 'skch' ? 'round' : 'miter';
      ctx.lineCap = sh.type === 'skch' ? 'round' : 'butt';
      ctx.lineWidth = sh.width + 3; ctx.strokeStyle = opt.outline; ctx.stroke();   // kontur -> syns mot alla kartor
      ctx.lineWidth = sh.width;     ctx.strokeStyle = col;         ctx.stroke();
    }
    // MATT (bara i ritlage): langd pa linjer och polygonsidor, rektangelns
    // bredd och hojd, cirkelns radie (med en tunn radielinje). Ellipsoidiskt.
    function label(ctx, t, x, y, col){
      ctx.font = '16px ViperDisplay'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = 4; ctx.strokeStyle = opt.outline; ctx.strokeText(t, x, y);
      ctx.fillStyle = col; ctx.fillText(t, x, y);
    }
    const dist = function(a, b){ return MapCoords.inverse(a.lat, a.lon, b.lat, b.lon).dist; };
    function measure(ctx, sh){
      if(!opt.fmt || sh.type === 'text' || sh.type === 'skch') return;
      const col = opt.colors[sh.color] || opt.colors.white, ps = screenPts(sh), off = 14 + sh.width;
      if(sh.type === 'crcl'){
        const c = ps[0], r = radiusPx(sh);
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + r, c.y); ctx.stroke(); ctx.setLineDash([]);
        label(ctx, 'R ' + opt.fmt(sh.r), c.x + r / 2, c.y - off, col);
        return;
      }
      if(sh.type === 'rect'){
        // Bredd (forsta sidan) och hojd (andra sidan), utanfor respektive sida.
        const c = rectCorners(sh), q = c.map(S), mx = (q[0].x + q[2].x) / 2, my = (q[0].y + q[2].y) / 2;
        [0, 1].forEach(function(i){
          const A = q[i], B = q[i + 1], cx = (A.x + B.x) / 2, cy = (A.y + B.y) / 2;
          let nx = cx - mx, ny = cy - my; const L = Math.hypot(nx, ny) || 1;
          label(ctx, opt.fmt(dist(c[i], c[i + 1])), cx + nx / L * off, cy + ny / L * off, col);
        });
        return;
      }
      // line / poly: varje sida, texten vinkelratt ut fran sidans mitt
      const n = ps.length, closed = sh.type === 'poly' && sh.closed !== false && n > 2;
      for(let i = 0; i < (closed ? n : n - 1); i++){
        const j = (i + 1) % n, A = ps[i], B = ps[j];
        let nx = A.y - B.y, ny = B.x - A.x; const L = Math.hypot(nx, ny) || 1;
        nx /= L; ny /= L; if(ny > 0){ nx = -nx; ny = -ny; }
        label(ctx, opt.fmt(dist(sh.pts[i], sh.pts[j])), (A.x + B.x) / 2 + nx * off, (A.y + B.y) / 2 + ny * off, col);
      }
    }

    // UPK:er for oleaterna som ar pa. En lista ritas en gang aven om flera oleater har den.
    // ponytail: raknas om varje ritning - cacha om listorna blir tusentals punkter.
    function drawUpks(ctx, v){
      if(!opt.upks) return;
      ctx.font = '14px ViperDisplay'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round';
      new Set(visible().map(function(x){ return x.upk; })).forEach(function(id){
        if(!id) return;
        opt.upks(id).forEach(function(u){
          const p = S(u);
          if(p.x < -50 || p.y < -50 || p.x > v.w + 50 || p.y > v.h + 50) return;
          ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
          ctx.lineWidth = 2; ctx.strokeStyle = opt.outline; ctx.stroke();
          ctx.fillStyle = opt.colors.white; ctx.fill();
          ctx.lineWidth = 3; ctx.strokeText(u.label, p.x + 5, p.y - 3);
          ctx.fillText(u.label, p.x + 5, p.y - 3);
        });
      });
    }

    function drawHandle(ctx, p){
      ctx.fillStyle = opt.outline;      ctx.fillRect(p.x - H - 2, p.y - H - 2, 2 * H + 4, 2 * H + 4);
      ctx.fillStyle = opt.colors.white; ctx.fillRect(p.x - H, p.y - H, 2 * H, 2 * H);
    }

    view.addLayer({ id: 'draw', visible: true, status: '', draw: function(ctx, v){
      ctx.save();
      const sh = shapes();
      sh.forEach(function(s){ drawShape(ctx, s); });
      if(mode) sh.forEach(function(s){ measure(ctx, s); });
      drawUpks(ctx, v);
      if(state.sketchOn) state.sketch.forEach(function(s){ drawShape(ctx, s); });
      // Paborjad figur/skisslinje: sista punkten foljer pekaren (med matt).
      if(cur && cur.type === 'skch') drawShape(ctx, cur);
      else if(cur && v.pointer){
        const q = ll(v.pointer), tmp = Object.assign({}, cur, { pts: cur.pts.concat([q]) });
        if(cur.type === 'crcl') tmp.r = dist(cur.pts[0], q), tmp.pts = cur.pts;
        if(cur.type === 'poly') tmp.closed = false;
        drawShape(ctx, tmp);
        measure(ctx, tmp);
      }
      if(edit) handles(edit).forEach(function(h){ drawHandle(ctx, h.p); });
      ctx.restore();
    } });

    // Handtagen pa vald figur gar att dra (en angra-punkt per drag).
    view.onGrab(function(p){
      if(!edit) return null;
      const h = handles(edit).find(function(h){ return Math.abs(h.p.x - p.x) <= H + 5 && Math.abs(h.p.y - p.y) <= H + 5; });
      if(!h) return null;
      const sh = edit;
      checkpoint();
      return {
        move: function(q){
          const g = ll(q);
          if(h.r) sh.r = dist(sh.pts[0], g);
          else sh.pts[h.i] = { lat: g.lat, lon: g.lon };
        },
        up: function(){ save(); changed(); },
      };
    });

    // SKCH vanster drag: nytt streck (till pennlyftet). En punkt nar pekaren flyttat 3 px.
    view.onGrab(function(p){
      if(!sketch) return null;
      cur = { type: 'skch', pts: [ll(p)], color: style.color, width: style.width };
      let last = p;
      return {
        move: function(q){ if(Math.hypot(q.x - last.x, q.y - last.y) >= 3){ cur.pts.push(ll(q)); last = q; } },
        up: function(){
          const s = cur; cur = null;
          if(s.pts.length < 2){ changed(); return; }
          commit(function(){ state.sketch.push(s); });
        },
      };
    }, 0);

    // SKCH hoger drag: sudda. Ett streck som pekaren passerar tas bort helt.
    // Mellan tva musrorelser provas var 4:e px, sa snabba drag missar inget.
    view.onGrab(function(p){
      if(!sketch) return null;
      checkpoint();
      let any = false, last = p;
      const rubAt = function(q){
        const n = state.sketch.length;
        state.sketch = state.sketch.filter(function(sh){
          const r = 10 + sh.width, ps = screenPts(sh);
          for(let i = 1; i < ps.length; i++) if(segDist(q, ps[i - 1], ps[i]) <= r) return false;
          return true;
        });
        if(state.sketch.length !== n) any = true;
      };
      const rub = function(q){
        const d = Math.hypot(q.x - last.x, q.y - last.y), k = Math.max(1, Math.ceil(d / 4));
        for(let i = 1; i <= k; i++) rubAt({ x: last.x + (q.x - last.x) * i / k, y: last.y + (q.y - last.y) * i / k });
        last = q;
      };
      rubAt(p);
      return {
        move: rub,
        up: function(){ if(any) save(); else undoS.pop(); changed(); },
      };
    }, 2);

    function finish(sh){
      cur = null;
      commit(function(){ const ol = ensureOleat(); sh.name = nextName(LABEL[sh.type], ol.shapes); ol.shapes.push(sh); });
    }

    function textAt(p, initial, done){
      // Tillfalligt element pa platsen -> MapInput (egen blockmarkor), sedan bort.
      const mfd = document.getElementById('mfd'), r = view.canvas.getBoundingClientRect(), mr = mfd.getBoundingClientRect();
      const k = mr.width / mfd.offsetWidth;
      const span = document.createElement('span');
      span.className = 'dr-text';
      span.style.left = ((r.left - mr.left) / k + p.x) + 'px';
      span.style.top = ((r.top - mr.top) / k + p.y) + 'px';
      span.textContent = initial || 'TEXT';
      mfd.appendChild(span);
      const inp = MapInput.edit(span, { value: initial || '', maxLength: 40,
        done: function(t){ wrap.remove(); done(t); },
        cancel: function(){ wrap.remove(); changed(); } });
      const wrap = inp.parentNode;
      wrap.classList.add('dr-text');
      wrap.style.left = span.style.left; wrap.style.top = span.style.top;
    }

    function click(p, ev){
      if(!mode) return false;
      const q = ll(p);
      if(mode === 'text'){
        textAt(p, '', function(t){ if(t) finish({ type: 'text', pts: [q], text: t, color: style.color, width: style.width,
                                                  scale: style.scale, z0: view.zoom }); });
        return true;
      }
      if(!cur){ cur = { type: mode, pts: [q], color: style.color, width: style.width, fill: style.fill }; changed(); return true; }
      if(mode === 'crcl'){ cur.r = dist(cur.pts[0], q); finish(cur); return true; }
      if(mode === 'poly'){
        const f = S(cur.pts[0]);
        if(cur.pts.length >= 3 && Math.hypot(p.x - f.x, p.y - f.y) <= 12){ finish(cur); return true; }
        cur.pts.push(q); changed(); return true;
      }
      cur.pts.push(q); finish(cur);                     // rect, line
      return true;
    }

    function selectShape(sh){
      edit = sh; style.color = sh.color; style.width = sh.width; style.fill = sh.fill || 'off'; style.scale = !!sh.scale;
      changed();
    }

    function pick(p){
      const sh = shapes();
      for(let i = sh.length - 1; i >= 0; i--){
        if(!hit(sh[i], p)) continue;
        const s = sh[i];
        if(s === edit && s.type === 'text'){            // SHIFT-klick igen pa vald text = andra texten
          textAt(S(s.pts[0]), s.text, function(t){ if(t && t !== s.text) commit(function(){ s.text = t; }); else changed(); });
          return true;
        }
        selectShape(s);
        return true;
      }
      return false;
    }

    document.addEventListener('keydown', function(ev){
      if(ev.key === 'Escape'){
        if(cur){ cur = null; changed(); }
        else if(edit){ edit = null; changed(); }
        else if(mode && !ev.mapHandled){ mode = null; changed(); }   // Esc i en dropdown stanger bara den
      }
      if(ev.key === 'Enter' && cur && cur.type === 'poly' && cur.pts.length >= 3) finish(cur);
      if(ev.key === 'Delete' && edit) api.del();
    });

    /* ---- OLEAT-fonstrets innehall ---- */
    function summary(sh){
      const f = opt.fmt || function(m){ return Math.round(m) + ' M'; };
      if(sh.type === 'crcl') return 'R ' + f(sh.r);
      if(sh.type === 'rect'){ const a = sh.pts[0], b = sh.pts[1]; return f(dist(a, { lat: a.lat, lon: b.lon })) + ' x ' + f(dist(a, { lat: b.lat, lon: a.lon })); }
      if(sh.type === 'text') return '"' + sh.text + '"';
      let L = 0;
      for(let i = 0; i + 1 < sh.pts.length; i++) L += dist(sh.pts[i], sh.pts[i + 1]);
      if(sh.type === 'poly' && sh.pts.length > 2) L += dist(sh.pts[sh.pts.length - 1], sh.pts[0]);
      return (sh.type === 'poly' ? sh.pts.length + ' H  ' : '') + f(L);
    }
    function rename(span, obj){
      MapInput.edit(span, { value: obj.name, maxLength: NAME_MAX, cancel: changed,
        done: function(t){ if(t && t !== obj.name) commit(function(){ obj.name = t.slice(0, NAME_MAX); }); else changed(); } });
    }
    function shapeRow(rows, sh, idx){
      const row = document.createElement('div');
      row.className = 'ls-row' + (sh === edit ? ' sel' : '');
      row.addEventListener('click', function(){ if(opt.onRowPick) opt.onRowPick(sh); else selectShape(sh); });
      const no = document.createElement('span'); no.className = 'ls-no'; no.textContent = idx + 1;
      const nm = document.createElement('span'); nm.className = 'ls-pt'; nm.textContent = sh.name;
      nm.addEventListener('contextmenu', function(ev){ ev.preventDefault(); rename(nm, sh); });
      const tp = document.createElement('span'); tp.className = 'ol-type'; tp.textContent = LABEL[sh.type];
      tp.style.color = opt.colors[sh.color];
      const info = document.createElement('span'); info.className = 'ol-info'; info.textContent = summary(sh);
      row.appendChild(no); row.appendChild(nm); row.appendChild(tp); row.appendChild(info);
      rows.appendChild(row);
    }
    function render(el, win){
      el.innerHTML = '';
      const ol = current(), vis = visible();
      MapCollection.header(el, win, {
        names: state.oleats.map(function(x){ return x.name; }), active: state.active,
        // Dropdownen ar en flervalslista: klick = pa/av, NONE = ingen. Flera = MULTI.
        multi: { many: vis.length > 1,
                 isOn: function(i){ return state.on.indexOf(state.oleats[i].id) >= 0; },
                 toggle: function(i){ api.toggleOleat(state.oleats[i].id); },
                 clear: function(){ api.clearOleats(); } },
        rename: function(span){ rename(span, ol); },
        del: api.delOleat,
        // Skisslagret (inte en oleat): bla = synligt.
        // UPK: arbetsoleatens UPK-lista (bla = en lista ar vald).
        mid: [{ label: 'SKETCH', on: function(){ return state.sketchOn; }, act: function(){ api.setSketchOn(!state.sketchOn); } }]
          .concat(ol && opt.lists ? [{ label: 'UPK',
            on: function(){ return opt.lists().some(function(l){ return l.id === ol.upk; }); },
            menu: function(){
              const all = opt.lists(), cur = all.some(function(l){ return l.id === ol.upk; }) ? ol.upk : 'none';
              return { options: [{ label: 'NONE', value: 'none' }].concat(all.map(function(l){ return { label: l.name, value: l.id }; })),
                       isOn: function(v){ return v === cur; },
                       select: function(v){ commit(function(){ if(v === 'none') delete ol.upk; else ol.upk = v; }); } };
            } }] : []),
      });
      if(!vis.length) return;
      const rows = document.createElement('div');
      if(vis.length === 1) vis[0].shapes.forEach(function(sh, idx){ shapeRow(rows, sh, idx); });
      // MULTI: en avdelning per oleat - linje + namn (arbetsoleaten bla, den far nya figurer).
      else vis.forEach(function(x){
        const h = document.createElement('div');
        h.className = 'ol-sep' + (x === ol ? ' pri' : ''); h.textContent = x.name;
        rows.appendChild(h);
        x.shapes.forEach(function(sh, idx){ shapeRow(rows, sh, idx); });
      });
      el.appendChild(rows);
    }

    const api = {
      load: load, click: click, pick: pick, render: render, selectShape: selectShape,
      mode: function(){ return mode; },
      setMode: function(m){ mode = m; cur = null; if(m) sketch = false; changed(); },
      sketching: function(){ return sketch; },
      setSketch: function(b){
        sketch = b; cur = null;
        if(b){ mode = null; edit = null; if(!state.sketchOn){ state.sketchOn = true; save(); } }   // skissar man syns lagret
        changed();
      },
      sketchOn: function(){ return state.sketchOn; },
      setSketchOn: function(b){ state.sketchOn = b; if(!b) sketch = false; save(); changed(); },
      popSketch: function(){ if(state.sketch.length){ state.sketch.pop(); save(); changed(); } },   // telefonens UNDO
      selected: function(){ return edit; },
      deselect: function(){ if(edit){ edit = null; changed(); } },
      del: function(){
        if(!edit) return;
        const e = edit, ol = state.oleats.find(function(x){ return x.shapes.indexOf(e) >= 0; });   // agaren (MULTI)
        edit = null;
        if(ol) commit(function(){ ol.shapes.splice(ol.shapes.indexOf(e), 1); });
      },
      style: function(){ return style; },
      setColor: function(c){ style.color = c; if(edit) commit(function(){ edit.color = c; }); else changed(); },
      setWidth: function(w){ style.width = w; if(edit) commit(function(){ edit.width = w; }); else changed(); },
      setFill: function(f){ style.fill = f; if(edit) commit(function(){ edit.fill = f; }); else changed(); },
      // SCALE (bara text): pa = texten skalas med kartan, fran nuvarande storlek.
      setScale: function(b){
        style.scale = b;
        if(edit && edit.type === 'text') commit(function(){ edit.scale = b; edit.z0 = view.zoom; });
        else changed();
      },
      shapes: shapes,
      activeName: function(){ if(state.on.length > 1) return 'MULTI'; const c = current(); return c ? c.name : ''; },
      newOleat: function(){ edit = null; commit(function(){ const nw = { id: uid(), name: nextName('OLEAT', state.oleats), shapes: [] }; state.oleats.push(nw); setOn([nw.id]); }); },
      oleats: function(){ return state.oleats.map(function(x){ return { id: x.id, name: x.name }; }); },
      activeId: function(){ const c = current(); return c ? c.id : null; },
      has: function(id){ return state.oleats.some(function(x){ return x.id === id; }); },
      activeSet: function(){ return { on: state.on.slice(), active: api.activeId() }; },
      setActiveSet: function(s){ setOn(s.on || [], s.active); edit = null; cur = null; save(); changed(); },
      toggleOleat: function(id){
        const on = state.on.slice(), i = on.indexOf(id);
        if(i >= 0) on.splice(i, 1); else on.push(id);
        api.setActiveSet({ on: on, active: i >= 0 ? api.activeId() : id });   // nyss pa = arbetsoleat
      },
      clearOleats: function(){ api.setActiveSet({ on: [] }); },
      // DEL i huvudet tar bort arbetsoleaten (bara nar EN ar pa).
      delOleat: function(){
        const c = current();
        if(!c) return;
        edit = null;
        commit(function(){ state.oleats.splice(state.active, 1); setOn(state.on.filter(function(id){ return id !== c.id; })); });
      },
      undo: function(){ restore(undoS, redoS); },
      redo: function(){ restore(redoS, undoS); },
      canUndo: function(){ return undoS.length > 0; },
      canRedo: function(){ return redoS.length > 0; },
      state: function(){ return state; },
    };
    return api;
  }

  window.MapDraw = MapDraw;
})();
