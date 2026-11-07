/* =====================================================================
   map/gpkg.js  -  KARTRUTOR DIREKT UR EN GEOPACKAGE-FIL PA NATET.

   Lantmateriets Topografisk webbkarta Nedladdning, raster ar en SQLite-fil pa
   ~150 GB. Filen laddas inte ner: bara de delar som behovs for en ruta hamtas
   med HTTP Range (servern tillater det fran webblasare, med CORS). Inloggning
   = Basic med kontot pa Geotorget. Den sparas pa enheten och aldrig i koden.

     const G = MapGpkg(url)          -> en delad lasare per adress
     G.tile(z, x, y) -> Promise<Blob|null>   null = rutan finns inte
     G.maxZoom                       -> hogsta nivan (null innan filen lasts)
     G.ready()                       -> finns inloggning
     MapGpkg.token(user, pass)       -> inloggningen som text att spara
     MapGpkg.setToken(t) / MapGpkg.hasToken()
     MapGpkg.onToken(fn)             -> kors nar inloggningen byts (lagren borjar om)
     MapGpkg.diskTiles               -> max antal rutor sparade pa enheten

   SNABBHET: servern kor HTTP/1.1, sa webblasaren har sex anslutningar och varje
   anrop tar 30-50 ms. En rutas data ligger intill sin tabellsida och grannrutor
   nara varandra i filen, darfor hamtas sista steget som ett helt block
   (CHUNK_PAGES) som delas av flera rutor. Hamtade rutor sparas pa enheten (Cache
   API): omrade man sett laddas direkt. Byter Lantmateriet fil rensas de sparade.

   Fel inloggning (401/403) nollar inloggningen direkt, sa kontot inte lases
   av en rad misslyckade anrop. Fel har e.status.

   z/x/y ar vanliga webbkarte-rutor (EPSG:3857, y nedat). Filens nivaer och
   rutnat raknas om fran gpkg_tile_matrix + gpkg_tile_matrix_set.
   ===================================================================== */
(function(root){
  const WORLD = 20037508.342789244;
  const CACHE_BYTES = 8e6, CHUNK_BYTES = 24e6, CHUNK_PAGES = 32, TILES_AT_ONCE = 6, TRIM_EVERY = 256;
  const utf8 = new TextDecoder();
  let token = '';
  const hooks = [], shared = new Map();

  const u16 = function(b, i){ return b[i] << 8 | b[i + 1]; };
  const u32 = function(b, i){ return b[i] * 16777216 + (b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]); };
  // SQLite-varint: [varde, langd]. Rowid over 2^53 finns inte i de har filerna.
  function varint(b, i){
    let v = 0;
    for(let k = 0; k < 8; k++){
      const c = b[i + k];
      v = v * 128 + (c & 127);
      if(c < 128) return [v, k + 1];
    }
    return [v * 256 + b[i + 8], 9];
  }
  // Ett SQLite-record -> lista med varden (blob = del av b, inget kopieras).
  function record(b){
    const h = varint(b, 0), types = [], out = [];
    for(let i = h[1]; i < h[0];){ const t = varint(b, i); types.push(t[0]); i += t[1]; }
    let p = h[0];
    types.forEach(function(t){
      if(t === 0){ out.push(null); return; }
      if(t === 8 || t === 9){ out.push(t - 8); return; }
      if(t === 7){ out.push(new DataView(b.buffer, b.byteOffset + p, 8).getFloat64(0)); p += 8; return; }
      if(t < 7){
        const n = [0, 1, 2, 3, 4, 6, 8][t];
        let v = b[p] > 127 ? -1 : 0;
        for(let k = 0; k < n; k++) v = v * 256 + b[p + k];
        out.push(v); p += n;
        return;
      }
      const n = (t - (t % 2 ? 13 : 12)) / 2;
      out.push(t % 2 ? utf8.decode(b.subarray(p, p + n)) : b.subarray(p, p + n));
      p += n;
    });
    return out;
  }

  function reader(read, opts){
    let ps = 0, usable = 0, cache = new Map(), chunks = new Map(), opened = null, info = null, depth = 0;
    const self = { maxZoom: null, changed: '' };
    const CHUNK = (opts && opts.chunk) || CHUNK_PAGES;

    // wide = hamta hela blocket runt sidan (tabellens sista niva och overflow-sidor).
    function page(n, wide){
      const c = Math.floor((n - 1) / CHUNK);
      let blk = chunks.get(c);
      if(blk || wide){
        if(blk) chunks.delete(c);
        else {
          blk = read(c * CHUNK * ps, CHUNK * ps).then(function(a){ return new Uint8Array(a); });
          blk.catch(function(){ chunks.delete(c); });
        }
        chunks.set(c, blk);
        if(chunks.size * CHUNK * ps > CHUNK_BYTES) chunks.delete(chunks.keys().next().value);
        const at = (n - 1 - c * CHUNK) * ps;
        return blk.then(function(b){ return b.subarray(at, at + ps); });
      }
      let p = cache.get(n);
      if(p){ cache.delete(n); cache.set(n, p); return p; }
      p = read((n - 1) * ps, ps).then(function(a){ return new Uint8Array(a); });
      p.catch(function(){ cache.delete(n); });
      cache.set(n, p);
      if(cache.size * ps > CACHE_BYTES) cache.delete(cache.keys().next().value);
      return p;
    }
    // Hur mycket av posten som ligger pa sidan (resten ligger pa overflow-sidor).
    function local(size, isIndex){
      const X = isIndex ? Math.floor((usable - 12) * 64 / 255) - 23 : usable - 35;
      if(size <= X) return size;
      const M = Math.floor((usable - 12) * 32 / 255) - 23, K = M + (size - M) % (usable - 4);
      return K <= X ? K : M;
    }
    // Hel post, med overflow-sidorna (ligger nastan alltid i samma block).
    async function payload(b, at, size){
      const loc = local(size, false);
      if(loc === size) return b.subarray(at, at + size);
      const out = new Uint8Array(size), per = usable - 4;
      out.set(b.subarray(at, at + loc));
      let done = loc, pg = u32(b, at + loc);
      while(done < size && pg){
        const o = await page(pg, true), take = Math.min(per, size - done);
        out.set(o.subarray(4, 4 + take), done);
        done += take;
        pg = u32(o, 0);
      }
      if(done < size) throw new Error('gpkg: kort post');
      return out;
    }
    // Alla rader i en (liten) tabell.
    async function scan(n, rows){
      const b = await page(n), h = n === 1 ? 100 : 0, cnt = u16(b, h + 3);
      if(b[h] === 5){
        for(let i = 0; i < cnt; i++) await scan(u32(b, u16(b, h + 12 + 2 * i)), rows);
        return scan(u32(b, h + 8), rows);
      }
      if(b[h] !== 13) throw new Error('gpkg: okand sidtyp ' + b[h]);
      for(let i = 0; i < cnt; i++){
        let at = u16(b, h + 8 + 2 * i);
        const sz = varint(b, at); at += sz[1];
        at += varint(b, at)[1];
        rows.push(record(await payload(b, at, sz[0])));
      }
    }
    const tableRows = async function(root){ const r = []; await scan(root, r); return r; };

    async function load(){
      const head = new Uint8Array(await read(0, 100));
      if(utf8.decode(head.subarray(0, 15)) !== 'SQLite format 3') throw new Error('gpkg: inte en SQLite-fil');
      ps = u16(head, 16) === 1 ? 65536 : u16(head, 16);
      usable = ps - head[20];
      const master = await tableRows(1);
      const rootOf = function(name){ const m = master.find(function(r){ return r[0] === 'table' && r[1] === name; }); if(!m) throw new Error('gpkg: saknar ' + name); return m; };
      const content = (await tableRows(rootOf('gpkg_contents')[3])).find(function(r){ return r[1] === 'tiles'; });
      if(!content) throw new Error('gpkg: inga kartrutor');
      self.changed = String(content[4]);                   // last_change: ny fil = nya rutor
      const name = content[0], tbl = rootOf(name);
      // Kommentarerna bort forst: Lantmateriets CREATE TABLE ar full av dem (med kommatecken).
      const sql = tbl[4].replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const cols = sql.slice(sql.indexOf('(') + 1).split(',').map(function(s){ return s.trim().split(/\s+/)[0].replace(/["`\[\]]/g, '').toLowerCase(); });
      if(cols.indexOf('tile_data') < 0) throw new Error('gpkg: saknar tile_data');
      // Unikt index pa (zoom_level, tile_column, tile_row): automatiskt eller eget.
      const idx = master.filter(function(r){ return r[0] === 'index' && r[2] === name; }).find(function(r){
        return r[4] == null || /zoom_level\W+tile_column\W+tile_row/i.test(r[4]);
      });
      if(!idx) throw new Error('gpkg: saknar rutindex');
      const set = (await tableRows(rootOf('gpkg_tile_matrix_set')[3])).find(function(r){ return r[0] === name; });
      const zooms = {};
      (await tableRows(rootOf('gpkg_tile_matrix')[3])).forEach(function(r){
        if(r[0] !== name) return;
        const span = r[6] * r[4], z = Math.log2(2 * WORLD / span), rz = Math.round(z);
        if(Math.abs(z - rz) > 0.01) return;                 // inte ett webbkarte-rutnat
        zooms[rz] = { level: r[1], w: r[2], h: r[3], dc: Math.round((set[2] + WORLD) / span), dr: Math.round((WORLD - set[5]) / span) };
        if(self.maxZoom == null || rz > self.maxZoom) self.maxZoom = rz;
      });
      info = { zooms: zooms, tbl: tbl[3], idx: idx[3], data: cols.indexOf('tile_data') };
    }
    function open(){
      if(!opened) opened = load().catch(function(e){ opened = null; throw e; });
      return opened;
    }
    // Radnummer ur indexet (level, col, row), eller null.
    async function rowid(key){
      for(let n = info.idx;;){
        const b = await page(n), h = n === 1 ? 100 : 0, leaf = b[h] === 10, hdr = h + (leaf ? 8 : 12);
        let lo = 0, hi = u16(b, h + 3);
        const cnt = hi;
        while(lo < hi){
          const mid = (lo + hi) >> 1;
          let at = u16(b, hdr + 2 * mid) + (leaf ? 0 : 4);
          const sz = varint(b, at); at += sz[1];
          const r = record(b.subarray(at, at + local(sz[0], true)));
          const c = key[0] - r[0] || key[1] - r[1] || key[2] - r[2];
          if(c === 0) return r[3];
          if(c < 0) hi = mid; else lo = mid + 1;
        }
        if(leaf) return null;
        n = lo < cnt ? u32(b, u16(b, hdr + 2 * lo)) : u32(b, h + 8);
      }
    }
    // Radens tile_data ur tabellen.
    async function rowData(id){
      for(let n = info.tbl, lvl = 1;; lvl++){
        const b = await page(n, lvl === depth), h = n === 1 ? 100 : 0, cnt = u16(b, h + 3);
        let lo = 0, hi = cnt;
        if(b[h] === 5){
          while(lo < hi){
            const mid = (lo + hi) >> 1;
            if(varint(b, u16(b, h + 12 + 2 * mid) + 4)[0] >= id) hi = mid; else lo = mid + 1;
          }
          n = lo < cnt ? u32(b, u16(b, h + 12 + 2 * lo)) : u32(b, h + 8);
          continue;
        }
        depth = lvl;                                       // lika djupt overallt i tradet
        while(lo < hi){
          const mid = (lo + hi) >> 1;
          let at = u16(b, h + 8 + 2 * mid);
          const sz = varint(b, at); at += sz[1];
          const key = varint(b, at); at += key[1];
          if(key[0] === id) return record(await payload(b, at, sz[0]))[info.data];
          if(key[0] < id) lo = mid + 1; else hi = mid;
        }
        return null;
      }
    }

    self.get = async function(z, x, y){
      await open();
      const m = info.zooms[z];
      if(!m) return null;
      const c = x - m.dc, r = y - m.dr;
      if(c < 0 || r < 0 || c >= m.w || r >= m.h) return null;
      const id = await rowid([m.level, c, r]);
      if(id == null) return null;
      const d = await rowData(id);
      return d ? new Blob([d]) : null;
    };
    self.open = open;
    self.reset = function(){ cache = new Map(); chunks = new Map(); opened = null; };
    return self;
  }

  function httpRead(url){
    return function(off, len){
      const c = new AbortController();
      return fetch(url, { headers: { Authorization: 'Basic ' + token, Range: 'bytes=' + off + '-' + (off + len - 1) }, signal: c.signal }).then(function(r){
        if(r.status === 206) return r.arrayBuffer();
        c.abort();                                         // 200 = hela filen (150 GB) - lat den inte komma
        if(r.status === 401 || r.status === 403) token = '';
        const e = new Error('gpkg: HTTP ' + r.status);
        e.status = r.status;
        throw e;
      });
    };
  }

  // Senast begarda rutorna forst - de som syns nu, inte de man panorerat forbi.
  // ponytail: kon har inget tak, rutor man lamnat hamtas till slut. Avbryt dem om det marks.
  function queued(rd){
    const wait = [];
    let busy = 0;
    function pump(){
      while(busy < TILES_AT_ONCE && wait.length){
        const w = wait.pop();
        busy++;
        w().finally(function(){ busy--; pump(); });
      }
    }
    return function(z, x, y){
      return new Promise(function(ok, no){
        wait.push(function(){
          if(!rd.allowed()){ const e = new Error('gpkg: ingen inloggning'); e.status = 401; no(e); return Promise.resolve(); }
          return rd.get(z, x, y).then(ok, no);
        });
        pump();
      });
    };
  }

  // Rutor sparade pa enheten. Allt har far misslyckas: da hamtas rutan fran natet.
  // ponytail: rensningen ar FIFO, inte senast anvand. Rakna om nar sparade omraden forsvinner.
  function onDisk(url, rd, fetchTile){
    const name = url.split('/').pop(), prefix = '/lm-tiles/' + name + '/', meta = '/lm-meta/' + name;
    const store = root.caches ? root.caches.open('mfd-lm-tiles').catch(function(){ return null; }) : Promise.resolve(null);
    let puts = 0, checked = false;
    function keep(c, n){                                   // bara de n senast sparade rutorna blir kvar
      c.keys().then(function(keys){
        const mine = keys.filter(function(k){ return k.url.indexOf(prefix) >= 0; });
        mine.slice(0, Math.max(0, mine.length - n)).forEach(function(k){ c.delete(k); });
      }).catch(function(){});
    }
    function checkVersion(c){
      checked = true;
      c.match(meta).then(function(r){ return r ? r.text() : null; }).then(function(old){
        if(old === rd.changed) return;
        if(old != null) keep(c, 0);
        return c.put(meta, new Response(rd.changed));
      }).catch(function(){});
    }
    return function(z, x, y){
      const key = prefix + z + '/' + x + '/' + y;
      return store.then(function(c){
        return (c ? c.match(key).catch(function(){ return null; }) : Promise.resolve(null)).then(function(hit){
          if(hit) return hit.blob();
          return fetchTile(z, x, y).then(function(b){
            if(c && !checked && rd.changed) checkVersion(c);
            if(c && b){
              c.put(key, new Response(b)).catch(function(){});
              if(++puts % TRIM_EVERY === 0) keep(c, MapGpkg.diskTiles);
            }
            return b;
          });
        });
      });
    };
  }

  function MapGpkg(url){
    if(shared.has(url)) return shared.get(url);
    const rd = reader(httpRead(url));
    rd.allowed = function(){ return !!token; };
    const G = { tile: onDisk(url, rd, queued(rd)), ready: rd.allowed, get maxZoom(){ return rd.maxZoom; } };
    hooks.push(rd.reset);
    shared.set(url, G);
    return G;
  }
  MapGpkg.diskTiles = 20000;                               // ~500 MB, telefonen satter lagre
  MapGpkg.reader = reader;                                 // check.js: egen lasfunktion i stallet for http
  MapGpkg.token = function(user, pass){
    return btoa(Array.from(new TextEncoder().encode(user + ':' + pass), function(c){ return String.fromCharCode(c); }).join(''));
  };
  MapGpkg.setToken = function(t){ token = t || ''; hooks.forEach(function(fn){ fn(); }); };
  MapGpkg.hasToken = function(){ return !!token; };
  MapGpkg.onToken = function(fn){ hooks.push(fn); };

  root.MapGpkg = MapGpkg;
})(typeof window !== 'undefined' ? window : globalThis);
