/* map/mobile/sw.js - sparar BARA appens egna filer (samma adress), sa att appen startar
   direkt och aven utan nat. Kartrutor, vektorrutor och hojddata gar orort forbi: de ligger
   i webblasarens vanliga cache och kartan kraver nat (ingen fornedladdning).
   Sparad version svaras direkt och uppdateras i bakgrunden - en ny version av appen
   syns darfor vid NASTA start.
   ponytail: filerna sparas nar de forst hamtas, inte vid installation - forsta starten utan
   service worker sparar inget. Lista dem i install om appen maste ga offline direkt. */
const CACHE = 'mfd-map';

self.addEventListener('activate', function(ev){ ev.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(ev){
  const r = ev.request;
  if(r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  ev.respondWith(caches.open(CACHE).then(function(c){
    return c.match(r).then(function(hit){
      const net = fetch(r).then(function(res){ if(res.ok) c.put(r, res.clone()); return res; });
      if(hit){ net.catch(function(){}); return hit; }
      return net;
    });
  }));
});
