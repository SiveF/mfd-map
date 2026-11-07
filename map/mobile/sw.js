/* map/mobile/sw.js - sparar BARA appens egna filer (samma adress), sa att appen startar
   aven utan nat. Kartrutor, vektorrutor och hojddata gar orort forbi: de ligger i
   webblasarens vanliga cache och kartan kraver nat (ingen fornedladdning).
   Natet forst, sa en ny version syns vid nasta start. Cachen svarar om natet inte gor det
   inom WAIT_MS (daligt nat ska inte hindra starten). no-cache: GitHub Pages later annars
   webblasaren ateranvanda filer i 10 minuter.
   ponytail: filerna sparas nar de forst hamtas, inte vid installation - forsta starten utan
   service worker sparar inget. Lista dem i install om appen maste ga offline direkt.
   ponytail: svarar natet for sent for bara nagra filer blandas versioner en start. */
const CACHE = 'mfd-map', WAIT_MS = 2000;

self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(ev){ ev.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(ev){
  const r = ev.request;
  if(r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
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
