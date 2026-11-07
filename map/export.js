/* =====================================================================
   map/export.js  -  EXPORTEN fran datorn till telefonappen. Rena funktioner,
   inget DOM. Listor och oleater med sina id:n (UPK-numren raknas fram ur
   punkternas id, oleat.upk pekar ut listan) - sa blir numreringen densamma pa
   telefonen. Skissen (SKCH) ingar inte.

     MapExport.visible(lists, drawings) -> { lists, drawings } bara det som syns:
       aktiv lista, paslagna oleater och listorna som deras UPK-prickar kommer ur.

     MapExport.pack({ lists, drawings, dist, ang, fmt, view }, now?) -> text
       lists = MapLists.state(), drawings = MapDraw.state()
     MapExport.parse(text) -> samma falt + exported (ISO-tid). Kastar Error vid
       ogiltig fil - filen kommer utifran, inget far ga vidare halvkontrollerat.

   Till telefonen gar exporten krypterad via en hemlig gist. Nyckeln skapas pa datorn
   och skrivs in en gang pa telefonen, tillsammans med gistens id (telefonkoden):
     MapExport.newKey() -> nyckel (hex)
     MapExport.seal(text, key) / MapExport.unseal(chiffer, key) -> Promise<text> (AES-GCM)
     MapExport.code(gist, key) -> text att skriva in   MapExport.parseCode(text) -> { gist, key }
   ===================================================================== */
(function(root){
  const FORMAT = 'mfdmap-export', VERSION = 1;
  const SHAPES = ['rect', 'crcl', 'poly', 'line', 'text', 'skch'];

  function pack(o, now){
    return JSON.stringify({
      format: FORMAT, version: VERSION, exported: (now || new Date()).toISOString(),
      lists: { lists: o.lists.lists, active: o.lists.active },
      drawings: { oleats: o.drawings.oleats, active: o.drawings.active, on: o.drawings.on },
      dist: o.dist, ang: o.ang, fmt: o.fmt, view: o.view,
    });
  }

  function visible(L, D){
    const on = D.oleats.filter(function(o){ return D.on.indexOf(o.id) >= 0; });
    const act = L.active == null ? null : L.lists[L.active];
    const lists = L.lists.filter(function(l){ return l === act || on.some(function(o){ return o.upk === l.id; }); });
    const work = on.indexOf(D.oleats[D.active]);
    return { lists: { lists: lists, active: act ? lists.indexOf(act) : null },
             drawings: { oleats: on, active: work < 0 ? null : work, on: on.map(function(o){ return o.id; }) } };
  }

  // ---- Kryptering + telefonkoden ----
  const A32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';      // inga I, L, O, U: gar att skriva in for hand
  const fromHex = function(h){ return Uint8Array.from(h.match(/../g), function(x){ return parseInt(x, 16); }); };
  const toHex = function(b){ return Array.from(b, function(x){ return (x < 16 ? '0' : '') + x.toString(16); }).join(''); };
  const aes = function(key){ return root.crypto.subtle.importKey('raw', fromHex(key), 'AES-GCM', false, ['encrypt', 'decrypt']); };

  function newKey(){ return toHex(root.crypto.getRandomValues(new Uint8Array(16))); }
  async function seal(text, key){
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const c = new Uint8Array(await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, await aes(key), new TextEncoder().encode(text)));
    let s = '';
    for(let i = 0; i < 12; i++) s += String.fromCharCode(iv[i]);
    for(let i = 0; i < c.length; i++) s += String.fromCharCode(c[i]);
    return btoa(s);
  }
  async function unseal(sealed, key){
    try{
      const b = Uint8Array.from(atob(sealed), function(c){ return c.charCodeAt(0); });
      return new TextDecoder().decode(await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, await aes(key), b.subarray(12)));
    }catch(e){ throw new Error('wrong code or damaged data'); }
  }
  function code(gist, key){
    need(/^[0-9a-f]{32}$/.test(gist), 'unexpected gist id');
    let bits = 0, n = 0, out = '';
    fromHex(gist + key).forEach(function(x){
      bits = bits << 8 | x; n += 8;
      while(n >= 5){ out += A32[bits >> (n - 5) & 31]; n -= 5; }
      bits &= (1 << n) - 1;
    });
    if(n) out += A32[bits << (5 - n) & 31];
    return out.replace(/(.{4})(?=.)/g, '$1 ');
  }
  function parseCode(text){
    const t = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    need(t.length === 52, 'code must be 52 characters');
    const out = [];
    let bits = 0, n = 0;
    t.split('').forEach(function(c){
      const v = A32.indexOf(c);
      need(v >= 0, 'invalid character in code: ' + c);
      bits = bits << 5 | v; n += 5;
      if(n >= 8){ out.push(bits >> (n - 8) & 255); n -= 8; bits &= (1 << n) - 1; }
    });
    const hex = toHex(out);
    return { gist: hex.slice(0, 32), key: hex.slice(32) };
  }

  const num = function(v){ return typeof v === 'number' && isFinite(v); };
  const str = function(v){ return typeof v === 'string'; };
  function need(ok, what){ if(!ok) throw new Error(what); }
  function coord(p, what){ need(p && num(p.lat) && num(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 360, what + ': coordinate'); }

  function parse(text){
    let d;
    try{ d = JSON.parse(text); }catch(e){ throw new Error('not JSON'); }
    need(d && d.format === FORMAT, 'not an MFD MAP export file');
    need(d.version === VERSION, 'unknown version ' + d.version);
    need(d.lists && Array.isArray(d.lists.lists), 'lists missing');
    need(d.drawings && Array.isArray(d.drawings.oleats), 'oleats missing');
    d.lists.lists.forEach(function(l){
      need(l && str(l.id) && str(l.name) && Array.isArray(l.points), 'broken list');
      l.points.forEach(function(p){
        need(p && str(p.id) && str(p.name), 'broken point in ' + l.name);
        coord(p, l.name + '/' + p.name);
        if(p.leg){ need(Array.isArray(p.leg.nodes), 'broken route in ' + l.name); p.leg.nodes.forEach(function(q){ coord(q, l.name + '/' + p.name); }); }
      });
    });
    d.drawings.oleats.forEach(function(ol){
      need(ol && str(ol.id) && str(ol.name) && Array.isArray(ol.shapes), 'broken oleat');
      ol.shapes.forEach(function(sh){
        need(sh && SHAPES.indexOf(sh.type) >= 0 && Array.isArray(sh.pts) && sh.pts.length > 0, 'broken shape in ' + ol.name);
        sh.pts.forEach(function(q){ coord(q, ol.name); });
        if(sh.type === 'crcl') need(num(sh.r), 'broken circle in ' + ol.name);
        if(sh.type === 'text') need(str(sh.text), 'broken text in ' + ol.name);
      });
    });
    if(d.view) need(num(d.view.lon) && num(d.view.lat) && num(d.view.zoom), 'broken view');
    return d;
  }

  root.MapExport = { pack: pack, parse: parse, visible: visible, newKey: newKey, seal: seal, unseal: unseal, code: code, parseCode: parseCode };
})(typeof window !== 'undefined' ? window : globalThis);
