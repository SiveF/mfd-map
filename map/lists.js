/* =====================================================================
   map/lists.js  -  PUNKTLISTOR (LIST). Datamodell, lagring, flerval, rutt
   och innehallet i LIST-fonstret (WindowNormal skapas i app.js).

     const L = MapLists({ onChange, onSelect(pt|null), height(lat, lon) -> Promise<m|null>, extra })
     L.load()                     -> las sparade listor (asynkront)
     L.add(lat, lon, fmt)         -> ny punkt i aktiv lista (skapar LISTn om ingen ar aktiv), blir vald
     L.move(pt, lat, lon)         -> flytta en punkt (CTRL-drag pa kartan)
     L.newList() / L.delList()    -> ny tom lista (blir aktiv) / ta bort aktiva listan (DEL, hall 2 s)
     L.current() / L.activeName() -> aktiv lista / dess namn ('' om ingen)
     L.selected() / L.select(pt, quiet) -> aktiv punkt (bla) / valj EN punkt (null = avmarkera;
                                     quiet = utan onSelect)
     L.multi(pt)                  -> SHIFT-klick: flerval. Ny punkt laggs till och blir aktiv,
                                     de tidigare ar kvar valda (grona). SHIFT-klick pa en vald =
                                     gor den aktiv; pa den aktiva = ta bort den ur valet.
     L.isMulti(pt) / L.multiCount()
     L.addRoute() / L.route()     -> ADD RTE: valda punkter (valordning) laggs sist i RUTTEN
                                     (pt.rte = 1, 2 ...); route() = rutten i ordning
     L.unroute(pt)                -> ta bort punkten ur rutten (inte ur listan)
     L.setOleats([id])            -> lanka oleater till aktiva listan (list.oleats; [] = ingen)
     L.linked(list)               -> listans lankade oleat-id:n (aven aldre list.oleat)
     L.rteView() / L.setRteView(b) -> RTE-undermenyn: fonstret visar bara ruttens punkter,
                                     i ruttordning; EDIT-drag flyttar dem i RUTTEN
     L.next(pt)                   -> nasta punkt i rutten (null = sist / inte i rutten)
     L.legNodes(pt) / L.setLeg(pt, noder) -> RTE PLAN: stracken pt -> next(pt) via noder
                                     [{lat, lon}] (tom = rak). Sparas pa pt som { to: nasta.id,
                                     nodes }; byts nasta punkt (ny ordning, borttagen punkt,
                                     ny rutt) blir stracken rak igen.
     L.edit() / L.editing()       -> EDIT (av/pa) for aktiva punkten: rutor runt koordinatens
                                     sektioner (klick = andra) och runt numret (dra = flytta i listan)
     L.del() / L.convert(fmt) / L.setType(id)  -> TYPE: punkttyp (opt.types = [[id, prefix]]);
                                     ett standardnamn (PT3) byter prefix (BP1)
     L.all() -> [{ id, name }]    -> alla listor (oleater pekar ut sin UPK-lista med id)
     L.upks(id) -> [{ lat, lon, label }] -> listans punkter som UPK:er (MapLists.upkLabels)
     L.render(el, win)            -> rita fonstrets innehall (win = WindowNormal, for dropdowns)

   Listor: LIST1, LIST2 ... Punkter: PT1, PT2 ... (nasta lediga nummer). Namn
   max 10 tecken. Raden: (ruttnummer) ordningsnummer, namn, koordinat i
   punktens format, markhojd. Klick = valj, SHIFT-klick = flerval. Klick pa
   listnamnet = valj lista (NONE overst = ingen), hogerklick = byt namn. DEL
   till hoger om listnamnet: hall inne i 2 s (blinkar) for att ta bort listan.

   Lagring: MapStore('lists') (map/store.js) -> map/lists.json. Fel -> DIAG.
   ===================================================================== */
(function(){
  const NAME_MAX = 10, HOLD_MS = 2000;

  // UPK-etiketter (pt.id -> text): ett sifferNAMN ar UPK:n; ovriga punkter far ett ledigt
  // nummer inom parentes. Numret raknas fram ur punktens id (inget sparas) och ar sa
  // slumpartat men stabilt - det byts bara om nagon annan punkt tar det.
  function upkLabels(points){
    const num = function(p){ return /^\d+$/.test(p.name); };
    const taken = new Set(points.filter(num).map(function(p){ return +p.name; }));
    const out = {};
    points.filter(num).forEach(function(p){ out[p.id] = p.name; });
    points.filter(function(p){ return !num(p); }).sort(function(a, b){ return a.id < b.id ? -1 : 1; }).forEach(function(p){
      let h = 0;
      for(let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) % 900;
      let n = 100 + h;
      while(taken.has(n)) n++;
      taken.add(n);
      out[p.id] = '(' + n + ')';
    });
    return out;
  }

  function nextName(prefix, items){
    let max = 0;
    items.forEach(function(it){
      const m = String(it.name).match(new RegExp('^' + prefix + '(\\d+)$'));
      if(m) max = Math.max(max, +m[1]);
    });
    return prefix + (max + 1);
  }

  /* ---- MapCollection.header: samma huvud for LIST och OLEAT ----
     Namnet (aktiv samling, NONE om ingen): klick = dropdown med NONE + alla
     (valj aktiv), hogerklick = byt namn. DEL: hall inne HOLD_MS for att ta
     bort (blinkar under tiden; slapper man tidigare hander inget). Inga rutor -
     en tunn vit linje skiljer huvudet fran listan.
       header(el, win, { names, active, pick(index|null), rename(span), del(), mid, extra, multi })
       multi = { many, isOn(i), toggle(i), clear() } -> namnlistan ar en FLERVALSLISTA (OLEAT):
       klick = pa/av, NONE = ingen; many = flera pa -> namnet visar MULTI (inget DEL/byt namn).
       mid / extra = [{ label, act(), on()?, right?, menu()? }] - knappar fore resp. efter DEL
       (OLEAT: SKETCH, LIST: NEW, OLAT, RTE). on() = true -> bla text, right = har borjar
       hogergruppen. menu() -> { options, isOn(v), select(v) } = knappen oppnar en dropdown. */
  function collectionHeader(el, win, c){
    const many = !!(c.multi && c.multi.many), has = c.active != null && !many;
    const name = document.createElement('div');
    name.className = 'ls-name';
    name.textContent = many ? 'MULTI' : has ? c.names[c.active] : 'NONE';
    name.addEventListener('click', function(){
      const opts = [{ label: 'NONE', value: 'none' }].concat(c.names.map(function(n, i){ return { label: n, value: String(i) }; }));
      if(c.multi){
        const m = c.multi;
        MapOsb.dropdown(name, { container: win.el, dir: 'down', options: opts, multi: true,
          isOn: function(v){ return v === 'none' ? !c.names.some(function(n, i){ return m.isOn(i); }) : m.isOn(+v); },
          select: function(v){ if(v === 'none') m.clear(); else m.toggle(+v); } });
        return;
      }
      MapOsb.dropdown(name, { container: win.el, dir: 'down', options: opts,
        isOn: function(v){ return v === (has ? String(c.active) : 'none'); },
        select: function(v){ c.pick(v === 'none' ? null : +v); } });
    });
    if(has) name.addEventListener('contextmenu', function(ev){ ev.preventDefault(); MapOsb.close(); c.rename(name); });
    const head = document.createElement('div');
    head.className = 'ls-head';
    head.appendChild(name);
    const btns = function(list){
      (list || []).forEach(function(x){
        const b = document.createElement('span');
        b.className = 'ls-btn' + (x.on && x.on() ? ' on' : '') + (x.right ? ' right' : '');
        b.textContent = x.label;
        b.addEventListener('click', function(){
          if(x.menu){ const m = x.menu(); MapOsb.dropdown(b, Object.assign({ container: win.el, dir: 'down' }, m)); return; }
          x.act(); b.classList.toggle('on', !!(x.on && x.on()));
        });
        head.appendChild(b);
      });
    };
    btns(c.mid);
    if(has){
      const del = document.createElement('span');
      del.className = 'ls-btn ls-del';
      del.textContent = 'DEL';
      let t = null;
      const stop = function(){ clearTimeout(t); t = null; del.classList.remove('hold'); };
      del.addEventListener('mousedown', function(ev){
        if(ev.button !== 0) return;
        del.classList.add('hold');
        t = setTimeout(function(){ stop(); c.del(); }, HOLD_MS);
      });
      del.addEventListener('mouseup', stop);
      del.addEventListener('mouseleave', stop);
      head.appendChild(del);
    }
    btns(c.extra);
    el.appendChild(head);
  }
  window.MapCollection = { header: collectionHeader };

  function MapLists(o){
    const opt = o || {};
    let state = { lists: [], active: null };       // active = index i lists eller null
    let sel = null, multi = [], editing = false;   // aktiv punkt, flervalet (valordning), EDIT
    let rteView = false;                           // RTE-undermenyn
    const heights = new Map();                     // 'lat,lon' -> hojd | null (saknas) | Promise
    const changed = function(){ if(opt.onChange) opt.onChange(); };
    const current = function(){ return state.active == null ? null : state.lists[state.active]; };

    // quiet = andra bara listans val (t.ex. nar anvandaren klickat en annan punkt pa kartan)
    function select(pt, quiet){
      sel = pt; multi = pt ? [pt] : []; editing = false;
      if(!quiet && opt.onSelect) opt.onSelect(pt);
      changed();
    }
    function multiSel(pt){
      if(!sel || !current() || current().points.indexOf(sel) < 0){ select(pt); return; }
      const i = multi.indexOf(pt);
      if(i < 0) multi.push(pt);
      else if(pt === sel){ multi.splice(i, 1); pt = multi[multi.length - 1] || null; }
      sel = pt; editing = false;
      if(opt.onSelect) opt.onSelect(pt);
      changed();
    }

    // Varaktigt id per punkt (RTE PLAN pekar ut nasta punkt med det - namn kan bytas/dubbleras).
    const uid = function(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
    function accept(text){
      if(!text) return;
      try{
        const s = JSON.parse(text);
        if(!Array.isArray(s.lists)) throw new Error('lists saknas');
        // Listans id sparas direkt: en oleat kan peka ut listan med det (UPK).
        let newId = false;
        s.lists.forEach(function(l){
          if(!l.id){ l.id = uid(); newId = true; }
          l.points.forEach(function(p){
            if(!p.id) p.id = uid();
            if('upk' in p){ delete p.upk; newId = true; }   // rest fran UPK i CVRT (borttagen)
          });
        });
        state = { lists: s.lists, active: (s.active != null && s.lists[s.active]) ? s.active : null };
        if(newId) save();
        MapDiag.clear('STOR-02');
      }catch(e){ MapDiag.raise('STOR-02', e.message); }
      changed();
    }

    const store = MapStore('lists');
    function save(){ store.save(JSON.stringify(state)); }
    function load(){ store.load(accept); }
    // Alla andringar gar har: andring -> spara -> rita om.
    function mutate(fn){ fn(); save(); changed(); }

    function add(lat, lon, fmt){
      let pt;
      mutate(function(){
        let list = current();
        if(!list){
          list = { id: uid(), name: nextName('LIST', state.lists), points: [] };
          state.lists.push(list);
          state.active = state.lists.length - 1;
        }
        pt = { id: uid(), name: nextName('PT', list.points), lat: lat, lon: lon, fmt: fmt };
        list.points.push(pt);
      });
      select(pt);
      return pt;
    }

    function move(pt, lat, lon){
      mutate(function(){ pt.lat = lat; pt.lon = lon; });
      if(pt === sel && opt.onSelect) opt.onSelect(pt);   // aktiva punkten foljer med
    }

    function newList(){
      mutate(function(){
        state.lists.push({ id: uid(), name: nextName('LIST', state.lists), points: [] });
        state.active = state.lists.length - 1;
      });
      select(null);
    }

    function delList(){
      const l = current();
      if(!l) return;
      mutate(function(){ state.lists.splice(state.active, 1); state.active = null; });
      select(null);
    }

    // Rutten i ordning; numren tatas om (1, 2 ...) nar en punkt forsvinner.
    function route(){
      const l = current();
      return l ? l.points.filter(function(p){ return p.rte; }).sort(function(a, b){ return a.rte - b.rte; }) : [];
    }
    function next(pt){ const r = route(), i = r.indexOf(pt); return i >= 0 && i + 1 < r.length ? r[i + 1] : null; }
    // Planerade strackor vars nasta punkt inte langre stammer tas bort (= rak igen).
    function pruneLegs(){
      const l = current();
      if(l) l.points.forEach(function(p){ if(p.leg){ const n = next(p); if(!n || n.id !== p.leg.to) delete p.leg; } });
    }
    function renumber(){ route().forEach(function(p, i){ p.rte = i + 1; }); pruneLegs(); }

    // Markhojd (cachad per position). Fonstret skriver in den nar den kommer.
    function heightOf(pt, span){
      const k = pt.lat.toFixed(6) + ',' + pt.lon.toFixed(6);
      const h = heights.get(k);
      if(h === undefined && opt.height){
        heights.set(k, opt.height(pt.lat, pt.lon).then(function(v){
          heights.set(k, v == null ? null : v);
          if(span.isConnected && v != null) span.textContent = Math.round(v) + ' M';
        }, function(){ heights.set(k, null); }));
      }
      return typeof h === 'number' ? Math.round(h) + ' M' : '';
    }

    /* ---- Fonstrets innehall ---- */
    function rename(span, obj){
      MapInput.edit(span, { value: obj.name, maxLength: NAME_MAX,
        done: function(t){ if(t && t !== obj.name) mutate(function(){ obj.name = t.slice(0, NAME_MAX); }); else changed(); },
        cancel: changed });
    }

    // Dra i numret (EDIT): gamla platsen gra, nya platsen bla tills man slapper.
    // Over sin egen plats syns ingen forhandsvisning (ingen flytt).
    function dragRow(ev, rows, row, pt, from, commit){
      ev.preventDefault(); ev.stopPropagation();
      const others = Array.from(rows.children).filter(function(r){ return r !== row; });
      // Radernas mitt mats EN gang (fore forhandsvisningen - den flyttar raderna under sig).
      const mids = others.map(function(r){ const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
      const drop = row.cloneNode(true);
      row.classList.add('ghost');
      let to = from;
      const move = function(e){
        to = mids.filter(function(m){ return e.clientY > m; }).length;
        row.classList.toggle('ghost', to !== from);
        if(to === from) drop.remove(); else rows.insertBefore(drop, others[to] || null);
      };
      const up = function(){
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        drop.remove(); row.classList.remove('ghost');
        if(to !== from) mutate(function(){ commit(from, to); });
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      move(ev);
    }

    function render(el, win){
      el.innerHTML = '';
      const list = current();
      MapCollection.header(el, win, {
        names: state.lists.map(function(l){ return l.name; }), active: state.active,
        pick: function(i){ state.active = i; save(); select(null); },
        rename: function(span){ rename(span, list); },
        del: delList,
        extra: opt.extra,
      });
      if(!list) return;

      // RTE-undermenyn: bara ruttens punkter, i ruttordning (numret = ruttnumret).
      const items = rteView ? route() : list.points;
      const reorder = rteView
        ? function(from, to){ const o = route(); o.splice(to, 0, o.splice(from, 1)[0]); o.forEach(function(p, i){ p.rte = i + 1; }); pruneLegs(); }
        : function(from, to){ list.points.splice(to, 0, list.points.splice(from, 1)[0]); };
      const rows = document.createElement('div');
      rows.className = 'ls-rows';
      items.forEach(function(pt, idx){
        const ed = editing && pt === sel;
        const row = document.createElement('div');
        row.className = 'ls-row' + (pt === sel ? ' sel' : multi.indexOf(pt) >= 0 ? ' multi' : '');
        row.addEventListener('click', function(ev){ if(ev.shiftKey) multiSel(pt); else if(sel !== pt) select(pt); });
        const add = function(cls, text){
          const s = document.createElement('span'); s.className = cls; s.textContent = text; row.appendChild(s); return s;
        };
        // Numret (i EDIT en ruta att dra i). I listan hanger ruttnumret (inom parentes)
        // till vanster om det, i marginalen - raden flyttas inte.
        const no = add('ls-no', '');
        const id = document.createElement('span');
        id.className = 'ls-id' + (ed ? ' grab' : ''); id.textContent = idx + 1;
        no.appendChild(id);
        if(ed) id.addEventListener('mousedown', function(ev){ if(ev.button === 0) dragRow(ev, rows, row, pt, idx, reorder); });
        if(pt.rte && !rteView){
          const rt = document.createElement('span');
          rt.className = 'ls-rt'; rt.textContent = '(' + pt.rte + ')';
          id.appendChild(rt);
        }
        const nm = add('ls-pt', pt.name);
        nm.addEventListener('contextmenu', function(ev){ ev.preventDefault(); rename(nm, pt); });
        const crd = add('ls-crd', '');
        const secs = MapCoords.sections(pt.fmt, pt.lat, pt.lon);
        if(!secs) crd.textContent = '--';                // utanfor formatets omrade
        else if(!ed) crd.textContent = secs.join(' ');
        else secs.forEach(function(sec, i){
          // EDIT: en ruta per sektion, klick = andra den.
          const b = document.createElement('span');
          b.className = 'ls-sec'; b.textContent = sec;
          b.addEventListener('click', function(ev){
            ev.stopPropagation();
            MapInput.edit(b, { value: sec, maxLength: sec.length + 4, cancel: changed, done: function(t){
              const parts = secs.slice(); parts[i] = t;
              const p = MapCoords.parse(pt.fmt, parts);
              if(!p){ MapDiag.raise('CRD-01', pt.name + ': ' + parts.join(' ')); changed(); return; }
              MapDiag.clear('CRD-01');
              mutate(function(){ pt.lat = p.lat; pt.lon = p.lon; });
              if(opt.onSelect) opt.onSelect(pt);          // aktiva punkten flyttar med
            } });
          });
          crd.appendChild(b);
        });
        const h = add('ls-h', '');
        h.textContent = heightOf(pt, h);
        rows.appendChild(row);
      });
      el.appendChild(rows);
    }

    return {
      load: load, add: add, move: move, newList: newList, delList: delList, render: render, save: save, current: current, select: select,
      multi: multiSel, route: route, next: next,
      legNodes: function(pt){ const n = next(pt); return pt && pt.leg && n && n.id === pt.leg.to ? pt.leg.nodes : null; },
      setLeg: function(pt, nodes){
        const n = next(pt);
        if(!n) return;
        mutate(function(){ if(nodes.length) pt.leg = { to: n.id, nodes: nodes }; else delete pt.leg; });
      },
      selected: function(){ return sel; },
      isMulti: function(pt){ return multi.indexOf(pt) >= 0; },
      multiCount: function(){ return multi.length; },
      activeName: function(){ const l = current(); return l ? l.name : ''; },
      // ADD RTE: de valda punkterna (valordning) som inte redan ar med laggs sist i rutten.
      addRoute: function(){
        const add = multi.length ? multi : sel ? [sel] : [];
        const nw = add.filter(function(p){ return !p.rte; });
        if(!nw.length) return;
        mutate(function(){ let n = route().length; nw.forEach(function(p){ p.rte = ++n; }); });
      },
      unroute: function(pt){
        if(!pt || !pt.rte) return;
        mutate(function(){ delete pt.rte; delete pt.leg; renumber(); });
        select(null);
      },
      setOleats: function(ids){ const l = current(); if(l) mutate(function(){ delete l.oleat; if(ids.length) l.oleats = ids; else delete l.oleats; }); },
      linked: function(l){ return !l ? [] : l.oleats || (l.oleat ? [l.oleat] : []); },
      rteView: function(){ return rteView; },
      setRteView: function(b){ rteView = b; editing = false; changed(); },
      edit: function(){ editing = !editing && !!sel; changed(); },
      editing: function(){ return editing && !!sel; },
      del: function(){
        const l = current();
        if(!l || !sel) return;
        const pt = sel;
        mutate(function(){ l.points.splice(l.points.indexOf(pt), 1); renumber(); });
        select(null);
      },
      convert: function(fmt){ const pt = sel; if(pt && pt.fmt !== fmt) mutate(function(){ pt.fmt = fmt; }); },
      all: function(){ return state.lists.map(function(l){ return { id: l.id, name: l.name }; }); },
      upks: function(id){
        const l = state.lists.find(function(x){ return x.id === id; });
        if(!l) return [];
        const lab = upkLabels(l.points);
        return l.points.map(function(p){ return { lat: p.lat, lon: p.lon, label: lab[p.id] }; });
      },
      setType: function(id){
        const pt = sel, l = current(), types = opt.types || [];
        if(!pt || (pt.type || types[0][0]) === id) return;
        const pre = function(t){ const x = types.find(function(y){ return y[0] === t; }); return x ? x[1] : null; };
        const m = String(pt.name).match(/^([A-Z]+)\d+$/);
        mutate(function(){
          pt.type = id;
          // Standardnamn (prefix + nummer for nagon typ) foljer typen; egna namn behalls.
          if(m && types.some(function(y){ return y[1] === m[1]; }))
            pt.name = nextName(pre(id), l.points.filter(function(p){ return p !== pt; }));
        });
      },
      state: function(){ return state; },
    };
  }

  MapLists.upkLabels = upkLabels;
  window.MapLists = MapLists;
})();
