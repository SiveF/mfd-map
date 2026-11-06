/* =====================================================================
   map/coords.js  -  KOORDINATFORMAT. Rena funktioner, inget DOM.

     MapCoords.FORMATS            -> [{ id, label, short }]  (dropdownens alternativ)
     MapCoords.format(id, lat, lon) -> text, '--' utanfor formatets giltighetsomrade
     MapCoords.utm / mgrs / sweref / rt90  -> rakna sjalv
     MapCoords.parseMgrs(text)    -> { lat, lon } (rutans MITT) eller null om ogiltig
     MapCoords.sections(id, lat, lon) -> [text, ...] (en ruta per sektion) eller null
     MapCoords.parse(id, [text, ...]) -> { lat, lon } eller null (ogiltig inmatning)
     MapCoords.inverse(lat1, lon1, lat2, lon2) -> { dist (m), az (grader) } - linjalen
     MapCoords.parseAny(text, prefer) -> { lat, lon } ur valfritt format (GOTO) eller null

   Transversal Mercator med Kruegers formler (Lantmarietets "Gauss Konforma
   Projektion"), mm-noggranna inom zonen. RT 90 raknas direkt ur
   SWEREF 99-lat/lon med Lantmarietets parametrar for "RT 90 2.5 gon V"
   (ca 1 m), sa ingen datumtransformation behovs.
   ===================================================================== */
(function(root){
  const RAD = Math.PI / 180;
  const GRS80 = 1 / 298.257222101, WGS84 = 1 / 298.257223563, A = 6378137;

  // Transversal Mercator framat. Returnerar { n, e } i meter.
  function tm(lat, lon, lon0, k0, fn, fe, f){
    const e2 = f * (2 - f), n = f / (2 - f);
    const ar = A / (1 + n) * (1 + n * n / 4 + n * n * n * n / 64);
    const Ac = e2, B = (5 * e2 * e2 - e2 * e2 * e2) / 6,
          C = (104 * e2 * e2 * e2 - 45 * e2 * e2 * e2 * e2) / 120, D = 1237 * e2 * e2 * e2 * e2 / 1260;
    const b1 = n / 2 - 2 * n * n / 3 + 5 * n * n * n / 16 + 41 * n * n * n * n / 180;
    const b2 = 13 * n * n / 48 - 3 * n * n * n / 5 + 557 * n * n * n * n / 1440;
    const b3 = 61 * n * n * n / 240 - 103 * n * n * n * n / 140;
    const b4 = 49561 * n * n * n * n / 161280;
    const p = lat * RAD, s = Math.sin(p), c = Math.cos(p), s2 = s * s;
    const ps = p - s * c * (Ac + B * s2 + C * s2 * s2 + D * s2 * s2 * s2);
    const dl = (lon - lon0) * RAD;
    const xi = Math.atan(Math.tan(ps) / Math.cos(dl));
    const eta = Math.atanh(Math.cos(ps) * Math.sin(dl));
    const x = xi + b1 * Math.sin(2 * xi) * Math.cosh(2 * eta) + b2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
                 + b3 * Math.sin(6 * xi) * Math.cosh(6 * eta) + b4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
    const y = eta + b1 * Math.cos(2 * xi) * Math.sinh(2 * eta) + b2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
                  + b3 * Math.cos(6 * xi) * Math.sinh(6 * eta) + b4 * Math.cos(8 * xi) * Math.sinh(8 * eta);
    return { n: k0 * ar * x + fn, e: k0 * ar * y + fe };
  }

  // Transversal Mercator bakat (Kruegers formler). Returnerar { lat, lon }.
  function tmInv(n_, e_, lon0, k0, fn, fe, f){
    const e2 = f * (2 - f), n = f / (2 - f);
    const ar = A / (1 + n) * (1 + n * n / 4 + n * n * n * n / 64);
    const d1 = n / 2 - 2 * n * n / 3 + 37 * n * n * n / 96 - n * n * n * n / 360;
    const d2 = n * n / 48 + n * n * n / 15 - 437 * n * n * n * n / 1440;
    const d3 = 17 * n * n * n / 480 - 37 * n * n * n * n / 840;
    const d4 = 4397 * n * n * n * n / 161280;
    const As = e2 + e2 * e2 + e2 * e2 * e2 + e2 * e2 * e2 * e2;
    const Bs = -(7 * e2 * e2 + 17 * e2 * e2 * e2 + 30 * e2 * e2 * e2 * e2) / 6;
    const Cs = (224 * e2 * e2 * e2 + 889 * e2 * e2 * e2 * e2) / 120;
    const Ds = -4279 * e2 * e2 * e2 * e2 / 1260;
    const xi = (n_ - fn) / (k0 * ar), eta = (e_ - fe) / (k0 * ar);
    const xp = xi - d1 * Math.sin(2 * xi) * Math.cosh(2 * eta) - d2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
                  - d3 * Math.sin(6 * xi) * Math.cosh(6 * eta) - d4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
    const ep = eta - d1 * Math.cos(2 * xi) * Math.sinh(2 * eta) - d2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
                   - d3 * Math.cos(6 * xi) * Math.sinh(6 * eta) - d4 * Math.cos(8 * xi) * Math.sinh(8 * eta);
    const ps = Math.asin(Math.sin(xp) / Math.cosh(ep));
    const dl = Math.atan(Math.sinh(ep) / Math.cos(xp));
    const s = Math.sin(ps), s2 = s * s;
    const lat = ps + s * Math.cos(ps) * (As + Bs * s2 + Cs * s2 * s2 + Ds * s2 * s2 * s2);
    return { lat: lat / RAD, lon: lon0 + dl / RAD };
  }

  const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';      // 8 graders band fran 80 S (X = 72-84 N)

  // UTM (WGS84) med Norge- och Svalbard-undantagen. null utanfor 80 S - 84 N.
  function utm(lat, lon){
    if(lat < -80 || lat > 84) return null;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    let zone = Math.floor((lon + 180) / 6) + 1;
    if(lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    if(lat >= 72){
      if(lon >= 0 && lon < 9) zone = 31; else if(lon >= 9 && lon < 21) zone = 33;
      else if(lon >= 21 && lon < 33) zone = 35; else if(lon >= 33 && lon < 42) zone = 37;
    }
    const r = tm(lat, lon, zone * 6 - 183, 0.9996, lat < 0 ? 10000000 : 0, 500000, WGS84);
    return { zone: zone, band: BANDS[Math.floor((lat + 80) / 8)], e: r.e, n: r.n };
  }

  // MGRS (AA-schemat, WGS84). digits = 4 (10 m) eller 5 (1 m). Siffrorna trunkeras, inte avrundas.
  const COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'], ROWS = 'ABCDEFGHJKLMNPQRSTUV';
  function mgrs(lat, lon, digits){
    const u = utm(lat, lon);
    if(!u) return null;
    const col = COLS[(u.zone - 1) % 3][Math.floor(u.e / 100000) - 1];
    const row = ROWS[(Math.floor(u.n / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
    const d = Math.pow(10, 5 - digits);
    const pad = function(v){ return String(Math.floor((v % 100000) / d)).padStart(digits, '0'); };
    return String(u.zone).padStart(2, '0') + u.band + ' ' + col + row + ' ' + pad(u.e) + ' ' + pad(u.n);
  }

  // MGRS-text -> rutans mitt. Godtar mellanslag eller inte, 1-5 siffror per led.
  // null om texten inte ar en giltig MGRS-koordinat.
  function parseMgrs(text){
    const m = String(text).toUpperCase().replace(/\s+/g, '').match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
    if(!m || m[5].length % 2) return null;
    const zone = +m[1], band = m[2], digits = m[5].length / 2;
    if(zone < 1 || zone > 60 || digits > 5) return null;
    const ci = COLS[(zone - 1) % 3].indexOf(m[3]);
    let ri = ROWS.indexOf(m[4]);
    if(ci < 0 || ri < 0) return null;
    ri = ((ri - (zone % 2 === 0 ? 5 : 0)) % 20 + 20) % 20;
    const cell = Math.pow(10, 5 - digits);
    const e = (ci + 1) * 100000 + (digits ? +m[5].slice(0, digits) * cell : 0) + cell / 2;
    let n = ri * 100000 + (digits ? +m[5].slice(digits) * cell : 0) + cell / 2;
    // Radbokstaverna upprepas var 2000 km - bandets sydkant avgor vilket varv.
    const south = band < 'N', latMin = -80 + 8 * BANDS.indexOf(band);
    const nMin = tm(latMin, zone * 6 - 183, zone * 6 - 183, 0.9996, south ? 10000000 : 0, 500000, WGS84).n;
    while(n < nMin - 100000) n += 2000000;
    const r = tmInv(n, e, zone * 6 - 183, 0.9996, south ? 10000000 : 0, 500000, WGS84);
    // Kontroll: punkten ska hamna i angivet band (+-1 band i kanterna) - annars ar texten fel.
    const bi = Math.floor((r.lat + 80) / 8);
    if(Math.abs(bi - BANDS.indexOf(band)) > 1 || r.lat < -80 || r.lat > 84) return null;
    return r;
  }

  // SWEREF 99 TM (rikstackande svensk projektion, en zon).
  function sweref(lat, lon){ return tm(lat, lon, 15, 0.9996, 0, 500000, GRS80); }
  function swerefInv(n, e){ return tmInv(n, e, 15, 0.9996, 0, 500000, GRS80); }   // -> { lat, lon }

  // RT 90 2.5 gon V (aldre svensk rikskarta), direkt ur SWEREF 99-lat/lon.
  const RT90 = [15 + 48 / 60 + 22.624306 / 3600, 1.00000561024, -667.711, 1500064.274];
  function rt90(lat, lon){ return tm(lat, lon, RT90[0], RT90[1], RT90[2], RT90[3], GRS80); }

  /* ---- Textformat ---- */
  const pad = function(v, w){ return String(v).padStart(w, '0'); };
  function hemi(v, pos, neg){ return v < 0 ? neg : pos; }
  function dms(v, w, pos, neg){
    const a = Math.abs(v);
    let d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60);
    if(s === 60){ s = 0; m++; } if(m === 60){ m = 0; d++; }
    return hemi(v, pos, neg) + pad(d, w) + '°' + pad(m, 2) + "'" + pad(s, 2) + '"';
  }
  function ddm(v, w, pos, neg){
    const a = Math.abs(v);
    let d = Math.floor(a), m = ((a - d) * 60).toFixed(3);
    if(m === '60.000'){ m = '0.000'; d++; }
    return hemi(v, pos, neg) + pad(d, w) + '°' + m.padStart(6, '0') + "'";
  }
  const m0 = function(v){ return String(Math.round(v)); };
  const inSweden = function(lat, lon){ return lat > 54 && lat < 70 && lon > 9 && lon < 25; };

  /* ---- Tolkning (inmatning i LIST). Generos med skrivsatt: ----
     En gradsektion godtar 1-3 tal (grader / grader+minuter / grader+min+sek),
     valfri hemisfarbokstav fore eller efter, eller minustecken. */
  function parseDeg(text, pos, neg, max){
    const t = String(text).toUpperCase().trim();
    const h = t.match(/[NSEW]/g) || [];
    if(h.length > 1 || (h.length && h[0] !== pos && h[0] !== neg)) return null;
    if(/[^0-9NSEW.,°'"\s-]/.test(t)) return null;
    const nums = (t.replace(/,/g, '.').match(/\d+(\.\d+)?/g) || []).map(Number);
    if(!nums.length || nums.length > 3) return null;
    if((nums[1] || 0) >= 60 || (nums[2] || 0) >= 60) return null;
    let v = nums[0] + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600;
    if(v > max) return null;
    if((h.length && h[0] === neg) || /^-/.test(t)) v = -v;
    return v;
  }
  // Meter ur en sektion som "6475511", "N 6475511" eller "431474E".
  function parseMeters(text, letter){
    const t = String(text).toUpperCase().replace(/\s/g, '');
    const m = t.match(new RegExp('^' + letter + '?(\\d+(\\.\\d+)?)' + letter + '?$'));
    return m ? +m[1] : null;
  }
  const ll = function(lat, lon){ return lat == null || lon == null ? null : { lat: lat, lon: lon }; };

  /* ---- FORMATEN. Varje format delas i SEKTIONER (en ruta per sektion i LIST):
       sec(lat, lon)   -> [text, ...] eller null (utanfor giltighetsomradet)
       parse([text..]) -> { lat, lon } eller null (ogiltig inmatning)
       sep = skiljetecken nar sektionerna skrivs pa en rad. ---- */
  const degParse = function(p){ return p.length === 2 ? ll(parseDeg(p[0], 'N', 'S', 90), parseDeg(p[1], 'E', 'W', 180)) : null; };
  const mgrsParse = function(d){
    return function(p){ return p.length === 4 && p[2].trim().length === d && p[3].trim().length === d ? parseMgrs(p.join(' ')) : null; };
  };
  const FORMATS = [
    { id: 'dd', label: 'DD', short: 'DD', sep: '  ', parse: degParse,
      sec: function(la, lo){ return [hemi(la, 'N', 'S') + Math.abs(la).toFixed(5), hemi(lo, 'E', 'W') + pad(Math.abs(lo).toFixed(5), 9)]; } },
    { id: 'dms', label: 'DMS', short: 'DMS', sep: '  ', parse: degParse,
      sec: function(la, lo){ return [dms(la, 2, 'N', 'S'), dms(lo, 3, 'E', 'W')]; } },
    { id: 'ddm', label: 'DDM', short: 'DDM', sep: '  ', parse: degParse,
      sec: function(la, lo){ return [ddm(la, 2, 'N', 'S'), ddm(lo, 3, 'E', 'W')]; } },
    { id: 'utm', label: 'UTM', short: 'UTM', sep: ' ',
      sec: function(la, lo){ const u = utm(la, lo); return u ? [u.zone + u.band, m0(u.e) + 'E', m0(u.n) + 'N'] : null; },
      parse: function(p){
        if(p.length !== 3) return null;
        const z = String(p[0]).toUpperCase().trim().match(/^(\d{1,2})([C-HJ-NP-X])$/);
        const e = parseMeters(p[1], 'E'), n = parseMeters(p[2], 'N');
        if(!z || e == null || n == null || +z[1] < 1 || +z[1] > 60) return null;
        const zone = +z[1], south = z[2] < 'N';
        const r = tmInv(n, e, zone * 6 - 183, 0.9996, south ? 10000000 : 0, 500000, WGS84);
        const bi = Math.floor((r.lat + 80) / 8);
        return (Math.abs(bi - BANDS.indexOf(z[2])) > 1 || r.lat < -80 || r.lat > 84) ? null : r;
      } },
    { id: 'mgrs4', label: 'MGRS 4', short: 'MGR4', sep: ' ', parse: mgrsParse(4),
      sec: function(la, lo){ const m = mgrs(la, lo, 4); return m ? m.split(' ') : null; } },
    { id: 'mgrs5', label: 'MGRS 5', short: 'MGR5', sep: ' ', parse: mgrsParse(5),
      sec: function(la, lo){ const m = mgrs(la, lo, 5); return m ? m.split(' ') : null; } },
    // Svenska system: bara meningsfulla over Sverige - annars null ('--')
    { id: 'sweref', label: 'SWEREF 99 TM', short: 'SWRF', sep: '  ',
      sec: function(la, lo){ if(!inSweden(la, lo)) return null; const r = sweref(la, lo); return ['N ' + m0(r.n), 'E ' + m0(r.e)]; },
      parse: function(p){
        const n = p.length === 2 ? parseMeters(p[0], 'N') : null, e = p.length === 2 ? parseMeters(p[1], 'E') : null;
        if(n == null || e == null) return null;
        const r = tmInv(n, e, 15, 0.9996, 0, 500000, GRS80);
        return inSweden(r.lat, r.lon) ? r : null;
      } },
    { id: 'rt90', label: 'RT 90', short: 'RT90', sep: '  ',
      sec: function(la, lo){ if(!inSweden(la, lo)) return null; const r = rt90(la, lo); return ['X ' + m0(r.n), 'Y ' + m0(r.e)]; },
      parse: function(p){
        const n = p.length === 2 ? parseMeters(p[0], 'X') : null, e = p.length === 2 ? parseMeters(p[1], 'Y') : null;
        if(n == null || e == null) return null;
        const r = tmInv(n, e, RT90[0], RT90[1], RT90[2], RT90[3], GRS80);
        return inSweden(r.lat, r.lon) ? r : null;
      } },
  ];

  /* ---- Avstand och riktning (linjalen): Vincentys invers pa WGS84. ----
     Returnerar { dist (m), az (grader, sann bring fran punkt 1, 0-360) }.
     Konvergerar inte for nastan antipodala punkter - da storcirkel pa medelradie. */
  function inverse(lat1, lon1, lat2, lon2){
    const a = A, f = WGS84, b = a * (1 - f);
    const L = (lon2 - lon1) * RAD;
    const U1 = Math.atan((1 - f) * Math.tan(lat1 * RAD)), U2 = Math.atan((1 - f) * Math.tan(lat2 * RAD));
    const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
    let lam = L, it = 0, sS, cS, sig, cA2, c2m, lamP;
    do {
      const sL = Math.sin(lam), cL = Math.cos(lam);
      sS = Math.sqrt((cU2 * sL) * (cU2 * sL) + (cU1 * sU2 - sU1 * cU2 * cL) * (cU1 * sU2 - sU1 * cU2 * cL));
      if(sS === 0) return { dist: 0, az: 0 };                     // samma punkt
      cS = sU1 * sU2 + cU1 * cU2 * cL;
      sig = Math.atan2(sS, cS);
      const sA = cU1 * cU2 * sL / sS;
      cA2 = 1 - sA * sA;
      c2m = cA2 ? cS - 2 * sU1 * sU2 / cA2 : 0;
      const Cc = f / 16 * cA2 * (4 + f * (4 - 3 * cA2));
      lamP = lam;
      lam = L + (1 - Cc) * f * sA * (sig + Cc * sS * (c2m + Cc * cS * (-1 + 2 * c2m * c2m)));
    } while(Math.abs(lam - lamP) > 1e-12 && ++it < 200);
    if(it >= 200){
      // ponytail: storcirkel (~0,5 % fel) bara for nastan antipodala punkter.
      const p1 = lat1 * RAD, p2 = lat2 * RAD;
      const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(L / 2) ** 2;
      const az = Math.atan2(Math.sin(L) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(L));
      return { dist: 2 * 6371008.8 * Math.asin(Math.sqrt(h)), az: (az / RAD + 360) % 360 };
    }
    const u2 = cA2 * (a * a - b * b) / (b * b);
    const Ac = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
    const Bc = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    const dS = Bc * sS * (c2m + Bc / 4 * (cS * (-1 + 2 * c2m * c2m) - Bc / 6 * c2m * (-3 + 4 * sS * sS) * (-3 + 4 * c2m * c2m)));
    const az = Math.atan2(cU2 * Math.sin(lam), cU1 * sU2 - sU1 * cU2 * Math.cos(lam));
    return { dist: b * Ac * (sig - dS), az: (az / RAD + 360) % 360 };
  }

  const byId = function(id){ return FORMATS.find(function(x){ return x.id === id; }) || FORMATS[0]; };

  /* ---- GOTO: tolka fritt inskriven koordinat i valfritt format. ----
     Ordning: MGRS, UTM, SWEREF/RT 90 (tva stora tal - RT 90 har Y over 1 200 000),
     sist grader (DD/DMS/DDM: delas vid E/W, komma eller lika manga tal per halva).
     prefer = valt CRD-format provas forst nar det gar. null om inget passar. */
  function parseAny(text, prefer){
    const t = String(text).trim().toUpperCase();
    if(!t) return null;
    const m = parseMgrs(t);
    if(m) return m;
    const u = t.match(/^(\d{1,2}[C-HJ-NP-X])\s+(\d+(?:\.\d+)?)\s*E?\s+(\d+(?:\.\d+)?)\s*N?$/);
    if(u) return parse('utm', [u[1], u[2], u[3]]);
    const big = t.match(/^[NX]?\s*(\d{6,7}(?:\.\d+)?)\s*[,;\s]\s*[EY]?\s*(\d{6,7}(?:\.\d+)?)$/);
    if(big){
      const order = (prefer === 'rt90' || +big[2] >= 1200000) ? ['rt90', 'sweref'] : ['sweref', 'rt90'];
      for(let i = 0; i < 2; i++){
        const r = parse(order[i], [big[1], big[2]]);
        if(r) return r;
      }
      return null;
    }
    // Grader: dela i latitud- och longituddel.
    let a = null, b = null;
    const ew = t.search(/[EW]/);
    if(ew > 0 && /[NS]/.test(t.slice(0, ew))){ a = t.slice(0, ew); b = t.slice(ew); }
    else if(t.indexOf(',') > 0){ a = t.slice(0, t.indexOf(',')); b = t.slice(t.indexOf(',') + 1); }
    else {
      const nums = t.match(/-?\d+(?:\.\d+)?/g) || [];
      if(nums.length % 2 || nums.length > 6 || !nums.length) return null;
      a = nums.slice(0, nums.length / 2).join(' '); b = nums.slice(nums.length / 2).join(' ');
    }
    return parse('dd', [a, b]);
  }
  function sections(id, lat, lon){ return byId(id).sec(lat, lon); }
  function parse(id, parts){ return byId(id).parse(parts); }
  function format(id, lat, lon){ const f = byId(id), s = f.sec(lat, lon); return s ? s.join(f.sep) : '--'; }

  root.MapCoords = { FORMATS: FORMATS.map(function(f){ return { id: f.id, label: f.label, short: f.short }; }),
                     format: format, sections: sections, parse: parse, parseAny: parseAny, inverse: inverse,
                     utm: utm, mgrs: mgrs, parseMgrs: parseMgrs, sweref: sweref, swerefInv: swerefInv, rt90: rt90 };
})(typeof window !== 'undefined' ? window : globalThis);
