/* =====================================================================
   map/scale.js  -  SKALSTOCK. Rena funktioner, inget DOM.

   Skalstocken har FAST langd (bar, logiska px). Mushjulet stegar mellan
   "jamna" skalsteg (1-2-5-serien) - zoomen raknas fram sa att stocken
   motsvarar exakt ett steg vid kartans mittlatitud. Efter Z-rutan (eller
   panorering i nord-sydlig led - Mercators skala andras med latituden)
   hamnar man mellan stegen: da visas ett avrundat varde med '*' framfor.

     MapScale.info(zoom, lat, bar, unit) -> { text, exact }
     MapScale.step(zoom, lat, bar, unit, dir) -> ny zoom (dir +1 = in, -1 = ut) eller null
     MapScale.snap(zoom, lat, bar, unit)      -> zoom for narmaste jamna steg
   unit = 'km' | 'nm' | 'mi'
   ===================================================================== */
(function(root){
  const RES0 = 156543.03392804097;      // m per px vid zoom 0 pa ekvatorn (256 px-varld)
  const NM = 1852, MI = 1609.344;
  const STOPS = {
    km: [5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6],
    nm: [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].map(function(v){ return v * NM; }),
    mi: [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].map(function(v){ return v * MI; }),
  };
  const EPS = 0.005;                    // inom 0,5 % av ett steg = jamn skala

  function meters(zoom, lat, bar){ return RES0 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom) * bar; }
  function zoomFor(m, lat, bar){ return Math.log2(RES0 * Math.cos(lat * Math.PI / 180) * bar / m); }

  // Tva signifikanta siffror, utan svans av nollor efter decimalpunkten.
  function sig2(v){ return String(Number(v.toPrecision(2))); }
  function label(m, unit, exact){
    if(unit === 'nm') return (exact ? String(Number((m / NM).toPrecision(3))) : sig2(m / NM)) + ' NM';
    if(unit === 'mi') return (exact ? String(Number((m / MI).toPrecision(3))) : sig2(m / MI)) + ' MI';
    if(m >= 1000) return (exact ? String(m / 1000) : sig2(m / 1000)) + ' KM';
    return (exact ? String(m) : sig2(m)) + ' M';
  }

  function info(zoom, lat, bar, unit){
    const m = meters(zoom, lat, bar);
    const stop = STOPS[unit].find(function(s){ return Math.abs(m / s - 1) < EPS; });
    return stop ? { text: label(stop, unit, true), exact: true } : { text: '*' + label(m, unit, false), exact: false };
  }

  function step(zoom, lat, bar, unit, dir){
    const m = meters(zoom, lat, bar), s = STOPS[unit];
    let t = null;
    if(dir > 0){ for(let i = s.length - 1; i >= 0; i--) if(s[i] < m * (1 - EPS)){ t = s[i]; break; } }
    else { for(let i = 0; i < s.length; i++) if(s[i] > m * (1 + EPS)){ t = s[i]; break; } }
    return t == null ? null : zoomFor(t, lat, bar);
  }

  function snap(zoom, lat, bar, unit){
    const m = meters(zoom, lat, bar);
    const best = STOPS[unit].reduce(function(b, s){ return Math.abs(Math.log(s / m)) < Math.abs(Math.log(b / m)) ? s : b; });
    return zoomFor(best, lat, bar);
  }

  root.MapScale = { info: info, step: step, snap: snap, meters: meters, zoomFor: zoomFor };
})(typeof window !== 'undefined' ? window : globalThis);
