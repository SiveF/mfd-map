/* =====================================================================
   map/export.js  -  EXPORTFILEN mellan datorn och telefonappen. Rena
   funktioner, inget DOM. Listor och oleater med sina id:n (UPK-numren raknas
   fram ur punkternas id, oleat.upk pekar ut listan) - sa blir numreringen
   densamma pa telefonen. Skissen (SKCH) ingar inte.

     MapExport.pack({ lists, drawings, dist, ang, fmt, view }, now?) -> text
       lists = MapLists.state(), drawings = MapDraw.state()
     MapExport.parse(text) -> samma falt + exported (ISO-tid). Kastar Error vid
       ogiltig fil - filen kommer utifran, inget far ga vidare halvkontrollerat.
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

  root.MapExport = { pack: pack, parse: parse };
})(typeof window !== 'undefined' ? window : globalThis);
