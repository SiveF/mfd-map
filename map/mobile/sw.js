/* map/mobile/sw.js - sparar BARA appens egna filer (samma adress), sa att appen startar
   aven utan nat. Kartrutor, vektorrutor och hojddata: finns rutan i OFFL-cachen (mobile/offline.js) svarar
   den, annars natet som vanligt. x-mfd-net pa den sparade = natet forst (tilejson).
   Natet forst, sa en ny version syns vid nasta start. Cachen svarar om natet inte gor det
   inom WAIT_MS (daligt nat ska inte hindra starten). no-cache: GitHub Pages later annars
   webblasaren ateranvanda filer i 10 minuter.
   ponytail: filerna sparas nar de forst hamtas, inte vid installation - forsta starten utan
   service worker sparar inget. Lista dem i install om appen maste ga offline direkt.
   ponytail: svarar natet for sent for bara nagra filer blandas versioner en start. */
const CACHE = 'mfd-map', OFFLINE = 'mfd-offline', WAIT_MS = 2000;

self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(ev){ ev.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(ev){
  const r = ev.request;
  if(r.method !== 'GET') return;
  if(new URL(r.url).origin !== self.location.origin){
    if(r.headers.has('range') || r.headers.has('authorization')) return;   // LM (gpkg.js) har egen cache
    ev.respondWith(caches.open(OFFLINE).then(function(c){ return c.match(r.url, { ignoreVary: true }); }).then(function(hit){
      if(!hit) return fetch(r);
      return hit.headers.get('x-mfd-net') ? fetch(r).catch(function(){ return hit; }) : hit;
    }));
    return;
  }
  ev.respondWith(caches.open(CACHE).then(function(c){
    return c.match(r).then(function(hit){
      const net = fetch(r.url, { cache: 'no-cache' }).then(function(res){
        if(res.ok){ c.put(r, res.clone()); return res; }
        return hit || res;
      });
      if(!hit) return net;
      return Promise.race([ net.catch(function(){ return hit; }),
                            new Promise(function(ok){ setTimeout(ok, WAIT_MS, hit); }) ]);
    });
  }));
});
