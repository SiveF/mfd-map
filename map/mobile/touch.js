/* =====================================================================
   map/mobile/touch.js  -  PEKSTYRNING for MapView. Ett finger = flytta,
   tva fingrar = nypa (zoom) + vrida + flytta, kort tryck = onTap.
   MapView rors inte - datorns musstyrning ligger kvar dar.

     MapTouch(view, { tap(p), moved(), grab(p), lock() })   moved = ett finger flyttade kartan
     lock() -> { noRot, noPan }: tva fingrar far inte vrida / flytta (da zoomar de kring mitten)
     grab(p) -> { move(p), up() } | null: verktyg (skissen) tar ett fingers drag. Fragas forst
     nar fingret flyttat sig, sa en nypning som borjar med ett finger inte ritar nagot.
     MapTouch.pair(view, s, a, b, lock)    ett steg i tvafingersgesten (testas i map/check.js)

   Vridningen slapps forst nar fingrarna vridit 8 grader tillsammans - annars
   vrider sig kartan vid varje nypning.
   ===================================================================== */
(function(root){
  const ROT_START = 8 * Math.PI / 180, TAP_PX = 10, TAP_MS = 500;

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

  function MapTouch(v, o){
    const c = v.canvas;
    const xy = function(t){ const r = c.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    let one = null, two = null, tap = null, stroke = null;   // ett finger: senaste punkt; tap: { x, y, t } tills det inte ar ett tryck
    const endStroke = function(){ if(stroke){ stroke.up(); stroke = null; v.redraw(); } };

    function sync(ev){
      const ts = ev.touches;
      two = ts.length === 2 ? pairState(xy(ts[0]), xy(ts[1])) : null;
      one = ts.length === 1 ? xy(ts[0]) : null;
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
          tap = null;
        }
        if(stroke){ stroke.move(p); v.redraw(); one = p; }
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
    // iOS Safari: sidan far inte zooma med nypning.
    document.addEventListener('gesturestart', function(ev){ ev.preventDefault(); });
  }

  MapTouch.pair = pair;
  MapTouch.pairState = pairState;
  root.MapTouch = MapTouch;
})(typeof window !== 'undefined' ? window : globalThis);
