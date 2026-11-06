/* =====================================================================
   map/diag.js  -  DIAGNOS. ALLA fel i MAP-appen gar hit och visas BARA
   pa DIAG-sidan (WindowNormal). Ingen annan del av UI:t far visa fel -
   den anropar MapDiag.raise/clear i stallet. Samma tanke som alerts/ i
   MFDsystem.

     MapDiag.raise(code, detail)  -> felet ar aktivt (detail = fritext, valfri)
     MapDiag.clear(code)          -> felet ar atgardat
     MapDiag.active()             -> lista med aktiva koder
     MapDiag.onChange(cb)         -> cb() vid varje andring (DIAG-knappen blir gul)
     MapDiag.render(el)           -> rita katalogen + status i el (DIAG-fonstret)

   Ny felkod = ny rad i CATALOG. Laddas FORST av map-skripten sa att aven
   fel under uppstart fangas (window.onerror, resursfel, promise-fel).
   ===================================================================== */
(function(){
  const CATALOG = [
    ['JS-01',   'Skriptfel i appen (oväntat fel i JavaScript)'],
    ['JS-02',   'Ohanterat asynkront fel (promise)'],
    ['RES-01',  'En fil kunde inte laddas (skript, stilmall eller bild)'],
    ['FONT-01', 'ViperDisplay-fonten kunde inte laddas'],
    ['DATA-01', 'Landdata saknas eller kunde inte laddas (data/land.js)'],
    ['DATA-02', 'Sjödata saknas eller kunde inte laddas (data/lakes.js)'],
    ['DATA-04', 'Gränsdata saknas eller kunde inte laddas (data/borders.js, data/regions.js)'],
    ['TILE-01', 'En kartkälla kräver API-nyckel men ingen är angiven (config.js)'],
    ['TILE-02', 'Kartrutor, vektorrutor (WATER/ROADS/NAMES) eller höjddata kunde inte hämtas (offline eller servern svarar inte)'],
    ['STOR-01', 'Listorna kunde inte sparas'],
    ['STOR-02', 'Listorna kunde inte läsas (filen är skadad)'],
    ['STOR-03', 'Ingen pywebview-brygga: listorna sparas bara i webbläsaren'],
    ['CRD-01',  'Ogiltig koordinat i LIST - ändringen sparades inte'],
    ['CRD-02',  'GOTO: koordinaten gick inte att tolka'],
    ['LOS-01',  'LOS/HGHT: höjddata saknas för punkten (utanför täckning eller offline)'],
    ['LOS-02',  'LOS: träd- eller byggnadsdata kunde inte hämtas - sikten räknades utan dem'],
    ['EXP-01',  'EXPT: exportfilen kunde inte sparas'],
  ];
  const active = {};                      // kod -> { detail, t }
  const listeners = [];
  const notify = function(){ listeners.forEach(function(cb){ cb(); }); };

  function raise(code, detail){
    active[code] = { detail: detail == null ? '' : String(detail), t: new Date() };
    notify();
  }
  function clear(code){ if(active[code]){ delete active[code]; notify(); } }

  const pad = function(v){ return String(v).padStart(2, '0'); };
  function render(el){
    el.innerHTML = '';
    CATALOG.forEach(function(c){
      const a = active[c[0]];
      const row = document.createElement('div');
      row.className = 'dg-row' + (a ? ' dg-fail' : '');
      row.innerHTML = '<span class="dg-code"></span><span class="dg-st"></span><span class="dg-txt"></span>';
      row.children[0].textContent = c[0];
      row.children[1].textContent = a ? 'FEL' : 'OK';
      row.children[2].textContent = c[1];
      if(a){
        const d = document.createElement('div');
        d.className = 'dg-detail';
        d.textContent = pad(a.t.getHours()) + ':' + pad(a.t.getMinutes()) + ':' + pad(a.t.getSeconds()) +
                        (a.detail ? '  ' + a.detail : '');
        row.appendChild(d);
      }
      el.appendChild(row);
    });
  }

  // ---- Globala felfangare. Resursfel (script/link/img) bubblar inte, darfor capture. ----
  window.addEventListener('error', function(ev){
    const t = ev.target;
    if(t && t !== window && (t.src || t.href)) raise('RES-01', t.src || t.href);
    else raise('JS-01', (ev.message || 'okänt fel') + (ev.filename ? '  ' + ev.filename.split('/').pop() + ':' + ev.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', function(ev){
    raise('JS-02', ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason));
  });
  if(document.fonts){
    document.fonts.ready.then(function(){
      if(!document.fonts.check('16px ViperDisplay')) raise('FONT-01');
    });
  }

  window.MapDiag = {
    CATALOG: CATALOG, raise: raise, clear: clear, render: render,
    active: function(){ return Object.keys(active); },
    onChange: function(cb){ listeners.push(cb); },
  };
})();
