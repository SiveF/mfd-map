/* =====================================================================
   map/mobile/touch.js  -  PEKSTYRNING for MapView. Ett finger = flytta,
   tva fingrar = nypa (zoom) + vrida + flytta, kort tryck = onTap.
   MapView rors inte - datorns musstyrning ligger kvar dar.

     MapTouch(view, { tap(p), moved(), grab(p), lock(), local(x, y), bar, edges() })   moved = ett finger flyttade kartan
     local(x, y) -> { x, y }: fingrets skarmpunkt i kartans koordinater (vriden app, MapTouch.unturn)
     lock() -> { noRot, noPan }: tva fingrar far inte vrida / flytta (da zoomar de kring mitten)
     grab(p) -> { move(p), up() } | null: verktyg (skissen) tar ett fingers drag. Fragas forst
     nar fingret flyttat sig, sa en nypning som borjar med ett finger inte ritar nagot.
     Kantsvep med en hand: nedre halvan av hogerkanten zoomar, bottenkanten vrider (inte vid lock().noRot).
     Galler bara svep LANGS kanten som borjar i zonen; allt annat ar vanlig karta och tryck ar tryck.
     bar = knappraden under kartan (dess knappar tacker bottenkanten), edges() -> false stanger av svepen.
     MapTouch.pair(view, s, a, b, lock)    ett steg i tvafingersgesten (testas i map/check.js)

   Vridningen slapps forst nar fingrarna vridit 8 grader tillsammans - annars
   vrider sig kartan vid varje nypning.
   ===================================================================== */
(function(root){
  const ROT_START = 8 * Math.PI / 180, TAP_PX = 10, TAP_MS = 500;
  // Kantsvep, justera har: zonens bredd, fri marginal ovanfor iPhones home bar, px per zoomniva, px per grad.
  const EDGE_PX = 30, BOTTOM_PX = 10, ZOOM_PX = 80, ROT_PX = 2.5;

  function pairState(a, b){
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
             ang: Math.atan2(b.y - a.y, b.x - a.x), rotOn: false, acc: 0 };
  }
  // Punkten under fingrarnas mittpunkt foljer med genom zoom och vridning.
  function pair(v, s, a, b, lock){
    const n = pairState(a, b), ll = v.toLonLat(s.x, s.y);
    let da = n.ang - s.ang;
    if(da > Math.PI) da -= 2 * Math.PI; else if(da < -Math.PI) da += 2 * Math.PI;
    s.acc += da;
    if(!s.rotOn && Math.abs(s.acc) >= ROT_START) s.rotOn = true;
    v.zoom = Math.max(v.minZoom, Math.min(v.maxZoom, v.zoom + Math.log2(n.d / s.d)));
    if(s.rotOn && !(lock && lock.noRot)) v.setRotation(v.rot + da);
    if(lock && lock.noPan) v.redraw();
    else{ const p = v.toScreen(ll.lon, ll.lat); v.panBy(n.x - p.x, n.y - p.y); }
    s.x = n.x; s.y = n.y; s.d = n.d; s.ang = n.ang;
  }

  // Vilket kantsvep ar draget fran s till p? Maste ga minst dubbelt sa mycket langs kanten som tvars.
  function edgeKind(v, s, p, o){
    if((o.edges && !o.edges()) || s.y > v.h - BOTTOM_PX) return null;
    const dx = Math.abs(p.x - s.x), dy = Math.abs(p.y - s.y);
    if(dy >= 2 * dx && s.x >= v.w - EDGE_PX && s.y >= v.h / 2) return 'zoom';
    if(dx >= 2 * dy && s.y >= v.h - BOTTOM_PX - EDGE_PX && !(o.lock && o.lock().noRot)) return 'rot';
    return null;
  }
  // Uppat = in. Vridningen foljer fingret: kartans nederkant dras at samma hall.
  function edgeMove(v, kind, a, b){
    if(kind === 'zoom') v.zoomBy((a.y - b.y) / ZOOM_PX);
    else v.rotateBy((a.x - b.x) / ROT_PX * Math.PI / 180);
  }

  function MapTouch(v, o){
    const c = v.canvas;
    const xy = function(t){
      if(o.local) return o.local(t.clientX, t.clientY);
      const r = c.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    let one = null, two = null, tap = null, stroke = null, edge = null;   // ett finger: senaste punkt; tap: { x, y, t } tills det inte ar ett tryck
    const endStroke = function(){ if(stroke){ stroke.up(); stroke = null; v.redraw(); } };

    function sync(ev){
      const ts = ev.touches;
      two = ts.length === 2 ? pairState(xy(ts[0]), xy(ts[1])) : null;
      one = ts.length === 1 ? xy(ts[0]) : null;
      if(ts.length !== 1) edge = null;
      if(ts.length > 1){ tap = null; endStroke(); }
    }
    c.addEventListener('touchstart', function(ev){
      ev.preventDefault();
      if(ev.touches.length === 1 && !one && !two){ const p = xy(ev.touches[0]); tap = { x: p.x, y: p.y, t: Date.now() }; }
      sync(ev);
    }, { passive: false });
    c.addEventListener('touchmove', function(ev){
      ev.preventDefault();
      if(two && ev.touches.length === 2){
        pair(v, two, xy(ev.touches[0]), xy(ev.touches[1]), o.lock && o.lock());
      }
      else if(one && ev.touches.length === 1){
        const p = xy(ev.touches[0]);
        if(tap && Math.hypot(p.x - tap.x, p.y - tap.y) > TAP_PX){
          if(o.grab) stroke = o.grab({ x: tap.x, y: tap.y });
          if(!stroke) edge = edgeKind(v, tap, p, o);
          tap = null;
        }
        if(stroke){ stroke.move(p); v.redraw(); one = p; }
        else if(edge){ edgeMove(v, edge, one, p); one = p; }
        else if(!tap){ v.panBy(p.x - one.x, p.y - one.y); if(o.moved) o.moved(); one = p; }
      }
    }, { passive: false });
    const end = function(ev){
      ev.preventDefault();                       // inga emulerade musklick efterat
      sync(ev);
      if(!ev.touches.length){
        endStroke();
        if(tap && ev.type === 'touchend' && Date.now() - tap.t < TAP_MS && o.tap) o.tap({ x: tap.x, y: tap.y });
        tap = null;
      }
    };
    c.addEventListener('touchend', end, { passive: false });
    c.addEventListener('touchcancel', end, { passive: false });
    // Knappraden: tryck gar orort till knapparna, bara ett kantsvep tas over (och ger inget klick).
    if(o.bar){
      let s = null, kind = null;
      o.bar.addEventListener('touchstart', function(ev){
        kind = null;
        s = ev.touches.length === 1 ? xy(ev.touches[0]) : null;
      }, { passive: true });
      o.bar.addEventListener('touchmove', function(ev){
        if(!s) return;
        if(ev.touches.length !== 1){ s = kind = null; return; }
        const p = xy(ev.touches[0]);
        if(!kind && Math.hypot(p.x - s.x, p.y - s.y) > TAP_PX){
          kind = edgeKind(v, s, p, o);
          if(!kind){ s = null; return; }
        }
        if(kind){ ev.preventDefault(); edgeMove(v, kind, s, p); s = p; }
      }, { passive: false });
      const barEnd = function(ev){ if(kind) ev.preventDefault(); s = kind = null; };
      o.bar.addEventListener('touchend', barEnd, { passive: false });
      o.bar.addEventListener('touchcancel', barEnd, { passive: false });
    }
    // iOS Safari: sidan far inte zooma med nypning.
    document.addEventListener('gesturestart', function(ev){ ev.preventDefault(); });
  }

  // Skarmpunkt -> innehall vridet turn grader medurs med ovre vanstra hornet i skarmens origo-sida.
  // 90: (x, y) ritas pa (w - y, x). 270: (x, y) ritas pa (y, h - x).
  MapTouch.unturn = function(turn, w, h, x, y){
    return turn === 90 ? { x: y, y: w - x } : turn === 270 ? { x: h - y, y: x } : { x: x, y: y };
  };
  MapTouch.pair = pair;
  MapTouch.pairState = pairState;
  root.MapTouch = MapTouch;
})(typeof window !== 'undefined' ? window : globalThis);
