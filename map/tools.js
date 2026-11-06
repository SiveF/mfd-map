/* =====================================================================
   map/tools.js  -  KARTVERKTYG. Varje verktyg kopplas till en MapView och
   ritar sin egen grafik som ett lager. Nytt verktyg = ny funktion har +
   ett anrop i app.js.

     MapTools.zoomBox(view, { key, stroke, outline, back() })
       Hall in tangenten (standard Z): en ruta ritas fran dar pekaren var
       nar tangenten trycktes ner till dar den ar nu. Slapp: kartan anpassas
       in i rutan. Esc avbryter. Bara ett TRYCK (ruta under 8 px) = back():
       tillbaka till skalan fore senaste Z-zoom. Vyn fore varje Z-zoom sparas.

     MapTools.pointSelect(view, { color, outline, onChange(pt, kalla), pick(p), marker() })
       Klick pa kartan = valj punkt ("active"), ritas som ett X. Hogerklick
       pa kartan = avmarkera. sel.get() -> { lat, lon } | null, sel.clear(),
       sel.set(pt, kalla). pick(p, ev) (valfri) far klicket forst - returnerar den
       true har den hanterat det (t.ex. klick pa en listpunkt).
       kalla = 'map' (klick/hogerklick) eller det som skickades till set.
       marker() (valfri) -> false = rita inget X (punkten markeras av nagon annan,
       t.ex. en vald listpunkt som visas som bla ring).
   Farger skickas in fran paletten (app.js) - inga egna fargvarden har.
   ===================================================================== */
(function(){
  function zoomBox(view, o){
    const opt = o || {};
    const key = (opt.key || 'z').toLowerCase();
    let a = null;                                      // startpunkt (skarm-px) medan tangenten halls
    const history = [];                                // vyer fore varje Z-zoom (senaste sist)

    const layer = view.addLayer({ id: 'zoombox', visible: true, status: '', draw: function(ctx, v){
      if(!a || !v.pointer) return;
      const b = v.pointer;
      ctx.save();
      ctx.lineWidth = 4; ctx.strokeStyle = opt.outline;   // kontur under -> syns mot ljusa rutor
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.lineWidth = 2; ctx.strokeStyle = opt.stroke;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.restore();
    } });

    document.addEventListener('keydown', function(ev){
      if(ev.key === 'Escape' && a){ a = null; view.redraw(); return; }
      if(ev.key.toLowerCase() !== key || ev.repeat || !view.pointer) return;
      a = { x: view.pointer.x, y: view.pointer.y };
      view.redraw();
    });
    document.addEventListener('keyup', function(ev){
      if(ev.key.toLowerCase() !== key || !a) return;
      const b = view.pointer, s = a;
      a = null;
      if(b && Math.abs(b.x - s.x) >= 8 && Math.abs(b.y - s.y) >= 8){
        history.push({ lon: view.lon, lat: view.lat, zoom: view.zoom });
        if(history.length > 50) history.shift();
        view.fitRect(s.x, s.y, b.x, b.y);
      }
      else if(history.length) { const h = history.pop(); view.setCenter(h.lon, h.lat, h.zoom); }
      else if(opt.back) opt.back();                     // ingen historik: ett skalsteg ut
      else view.redraw();
    });
    // Fonstret tappar fokus mitt i (Alt+Tab) -> ingen keyup kommer. Avbryt.
    window.addEventListener('blur', function(){ if(a){ a = null; view.redraw(); } });
    return layer;
  }

  function pointSelect(view, o){
    const opt = o || {};
    let pt = null;
    const R = 7;                                        // X:ets halva storlek = listringarnas radie
    view.addLayer({ id: 'select', visible: true, status: '', draw: function(ctx, v){
      if(!pt || (opt.marker && !opt.marker())) return;
      const p = v.toScreen(pt.lon, pt.lat);
      ctx.save();
      ctx.lineCap = 'square';
      [[opt.outline, 6], [opt.color, 2.5]].forEach(function(s){
        ctx.strokeStyle = s[0]; ctx.lineWidth = s[1];
        ctx.beginPath();
        ctx.moveTo(p.x - R, p.y - R); ctx.lineTo(p.x + R, p.y + R);
        ctx.moveTo(p.x + R, p.y - R); ctx.lineTo(p.x - R, p.y + R);
        ctx.stroke();
      });
      ctx.restore();
    } });
    const set = function(v, src){
      pt = v ? { lat: v.lat, lon: v.lon } : null;
      view.redraw();
      if(opt.onChange) opt.onChange(pt, src || 'map');
    };
    view.onClick(function(p, ev){ if(!(opt.pick && opt.pick(p, ev))) set(view.toLonLat(p.x, p.y)); });
    view.canvas.addEventListener('contextmenu', function(ev){ ev.preventDefault(); if(pt) set(null); });
    return { get: function(){ return pt; }, set: set, clear: function(){ set(null); } };
  }

  /* ---- Linjal (RLR) ----
     MapTools.ruler(view, { color, outline, label(a, b, franPunkt) -> text })
       r.set(pa, start)  -> sla pa/av. start = { lat, lon } (vald punkt) -> linjalen
                            borjar dar och label far franPunkt = true (visar riktning).
       r.click(p)        -> klick pa kartan: forsta = ena anden, andra = andra anden;
                            ar linjalen klar borjar ett nytt klick en ny linjal.
       r.active()
     Andarna har handtag som kan dras. Medan andra anden saknas foljer den pekaren. */
  function ruler(view, o){
    const opt = o || {};
    let on = false, a = null, b = null, fromPt = false;
    const H = 6;                                        // handtagets halva storlek
    const ll = function(p){ return view.toLonLat(p.x, p.y); };
    const S = function(q){ return view.toScreen(q.lon, q.lat); };

    view.addLayer({ id: 'ruler', visible: true, status: '', draw: function(ctx, v){
      if(!on || !a) return;
      const end = b || (v.pointer ? ll(v.pointer) : null);
      if(!end) return;
      const pa = S(a), pb = S(end);
      ctx.save();
      [[opt.outline, 6], [opt.color, 2.5]].forEach(function(s){
        ctx.strokeStyle = s[0]; ctx.lineWidth = s[1];
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      });
      [pa, pb].forEach(function(p){                     // handtag: fyllda rutor med kontur
        ctx.fillStyle = opt.outline; ctx.fillRect(p.x - H - 2, p.y - H - 2, 2 * H + 4, 2 * H + 4);
        ctx.fillStyle = opt.color;   ctx.fillRect(p.x - H, p.y - H, 2 * H, 2 * H);
      });
      // Text vid mitten, forskjuten vinkelratt mot linjen (ovanfor den).
      const t = opt.label(a, end, fromPt), mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      let nx = pa.y - pb.y, ny = pb.x - pa.x; const n = Math.hypot(nx, ny) || 1;
      nx /= n; ny /= n; if(ny > 0){ nx = -nx; ny = -ny; }
      ctx.font = '20px ViperDisplay'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = opt.outline;
      ctx.strokeText(t, mx + nx * 22, my + ny * 22);
      ctx.fillStyle = opt.color; ctx.fillText(t, mx + nx * 22, my + ny * 22);
      ctx.restore();
    } });

    // Handtagen gar att dra (ingen modifierare behovs nar RLR ar pa).
    view.onGrab(function(p){
      if(!on || !a || !b) return null;
      const hit = function(q){ const s = S(q); return Math.abs(s.x - p.x) <= H + 5 && Math.abs(s.y - p.y) <= H + 5; };
      const which = hit(b) ? 'b' : hit(a) ? 'a' : null;
      if(!which) return null;
      return { move: function(q){ if(which === 'a'){ a = ll(q); fromPt = false; } else b = ll(q); },
               up: function(){} };
    });

    return {
      active: function(){ return on; },
      set: function(v, start){ on = v; a = v && start ? { lat: start.lat, lon: start.lon } : null; b = null; fromPt = !!(v && start); view.redraw(); },
      click: function(p){
        if(!on) return false;
        if(!a || b){ a = ll(p); b = null; fromPt = false; }
        else b = ll(p);
        view.redraw();
        return true;
      },
    };
  }

  window.MapTools = { zoomBox: zoomBox, pointSelect: pointSelect, ruler: ruler };
})();
