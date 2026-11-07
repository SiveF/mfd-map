/* =====================================================================
   map/mobile/gps.js  -  MIN POSITION. Geolocation + kompass + lager (prick,
   noggrannhetscirkel, riktningskil). GPS kraver https (eller localhost).

     const g = MapGps(view, { color, outline, onFix(), onError(text), compassTurn() -> grader })
     g.setOn(pa)                 -> maste anropas fran ett knapptryck (iOS fragar om lov)
     g.on() / g.pos()            -> { lat, lon, acc (m), t (ms), heading (grader, null om okand) } | null
     g.setFollow(b)              -> kartan centreras pa positionen och vrids sa att riktningen ar uppat

   Riktning: GPS-kursen nar man ror sig (annars ar den brus), annars telefonens
   kompass om den finns och iOS fatt lov. Finns ingen ritas ingen kil.
   ===================================================================== */
(function(root){
  const MOVING = 1;                                    // m/s: over detta ar GPS-kursen palitlig
  const RES0 = 156543.03392804097;                     // m per px vid zoom 0
  const OPT = { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 };

  function MapGps(view, o){
    let watch = null, pos = null, follow = false, jump = false, compass = null, listening = false;

    view.addLayer({ id: 'gps', visible: true, status: '', draw: function(ctx, v){
      if(watch == null || !pos) return;
      const p = v.toScreen(pos.lon, pos.lat);
      const r = pos.acc / (RES0 * Math.cos(pos.lat * Math.PI / 180) / Math.pow(2, v.zoom));
      ctx.save();
      if(r > 10){
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        ctx.globalAlpha = .15; ctx.fillStyle = o.color; ctx.fill();
        ctx.globalAlpha = .6; ctx.lineWidth = 1.5; ctx.strokeStyle = o.color; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if(pos.heading != null){
        // Kilen pekar i fardriktningen; kartans vridning laggs pa.
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(pos.heading * Math.PI / 180 + v.rot);
        ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(9, -6); ctx.lineTo(-9, -6); ctx.closePath();
        ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = o.outline; ctx.stroke();
        ctx.fillStyle = o.color; ctx.fill();
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
      ctx.lineWidth = 3; ctx.strokeStyle = o.outline; ctx.stroke();
      ctx.fillStyle = o.color; ctx.fill();
      ctx.restore();
    } });

    function fix(g){
      const c = g.coords, moving = c.speed != null && c.speed > MOVING && c.heading != null && !isNaN(c.heading);
      pos = { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0, t: g.timestamp, moving: moving, heading: moving ? c.heading : compass };
      if(follow) center();
      else view.redraw();
      if(o.onFix) o.onFix();
    }
    // Riktningen uppat. Under ~2 graders andring ligger kartan still, annars darrar den med kompassen.
    function aim(){
      if(!follow || !pos || pos.heading == null) return;
      const r = -pos.heading * Math.PI / 180;
      if(Math.abs(Math.sin((r - view.rot) / 2)) > 0.017) view.setRotation(r);
    }
    // Bara forsta gangen hoppar utzoomad karta in, sa att man kan zooma ut medan den foljer.
    function center(){
      view.setCenter(pos.lon, pos.lat, jump && view.zoom < 12 ? 14 : view.zoom);
      jump = false;
      aim();
    }
    function onOrient(ev){
      // iOS: webkitCompassHeading (0 = norr, medurs). Ovriga: deviceorientationabsolute.
      const h = ev.webkitCompassHeading != null ? ev.webkitCompassHeading : ev.absolute && ev.alpha != null ? 360 - ev.alpha : null;
      if(h == null) return;
      compass = h + (o.compassTurn ? o.compassTurn() : 0);   // innehallets overkant, inte telefonens
      if(pos && !pos.moving){ pos.heading = h; aim(); view.redraw(); }
    }
    function listenCompass(){
      if(listening) return;
      listening = true;
      window.addEventListener('deviceorientation', onOrient);
      window.addEventListener('deviceorientationabsolute', onOrient);
    }

    function quietCompass(){
      if(!listening) return;
      listening = false;
      window.removeEventListener('deviceorientation', onOrient);
      window.removeEventListener('deviceorientationabsolute', onOrient);
      compass = null;
      if(pos && !pos.moving) pos.heading = null;
    }

    return {
      setOn: function(b){
        if(b === (watch != null)) return;
        if(!b){
          navigator.geolocation.clearWatch(watch);
          watch = null; pos = null;
          quietCompass();
          view.redraw();
          return;
        }
        if(!navigator.geolocation || !window.isSecureContext){
          if(o.onError) o.onError('GPS requires https (page is served over ' + location.protocol + ')');
          return;
        }
        jump = true;
        watch = navigator.geolocation.watchPosition(fix, function(e){ if(o.onError) o.onError(e.message || ('error ' + e.code)); }, OPT);
        // iOS vill ha lov for kompassen, i samma knapptryck. Nekat = ingen kil nar man star still.
        const DO = window.DeviceOrientationEvent;
        if(DO && DO.requestPermission) DO.requestPermission().then(function(s){ if(s === 'granted') listenCompass(); }, function(){});
        else if(DO) listenCompass();
      },
      on: function(){ return watch != null; },
      pos: function(){ return pos; },
      setFollow: function(b){
        follow = b;
        if(b){ jump = true; if(pos) center(); }
      },
    };
  }
  root.MapGps = MapGps;
})(typeof window !== 'undefined' ? window : globalThis);
