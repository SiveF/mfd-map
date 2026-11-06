/* =====================================================================
   map/mobile/gps.js  -  MIN POSITION. Geolocation + kompass + lager (prick,
   noggrannhetscirkel, riktningskil). GPS kraver https (eller localhost).

     const g = MapGps(view, { color, outline, onFix(), onError(text) })
     g.start() / g.stop()        -> maste startas fran ett knapptryck (iOS fragar om lov)
     g.on() / g.pos()            -> { lat, lon, acc, heading (grader, null om okand) } | null
     g.follow() / g.setFollow(b) -> foljlage: kartan centreras pa positionen

   Riktning: GPS-kursen nar man ror sig (annars ar den brus), annars telefonens
   kompass om den finns och iOS fatt lov. Finns ingen ritas ingen kil.
   ===================================================================== */
(function(root){
  const MOVING = 1;                                    // m/s: over detta ar GPS-kursen palitlig
  const RES0 = 156543.03392804097;                     // m per px vid zoom 0

  function MapGps(view, o){
    let watch = null, pos = null, follow = false, compass = null, listening = false;

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
      pos = { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0, moving: moving, heading: moving ? c.heading : compass };
      if(follow) view.setCenter(pos.lon, pos.lat, view.zoom < 12 ? 14 : view.zoom);
      else view.redraw();
      if(o.onFix) o.onFix();
    }
    function onOrient(ev){
      // iOS: webkitCompassHeading (0 = norr, medurs). Ovriga: deviceorientationabsolute.
      const h = ev.webkitCompassHeading != null ? ev.webkitCompassHeading : ev.absolute && ev.alpha != null ? 360 - ev.alpha : null;
      if(h == null) return;
      compass = h;
      if(pos && !pos.moving){ pos.heading = h; view.redraw(); }
    }
    function listenCompass(){
      if(listening) return;
      listening = true;
      window.addEventListener('deviceorientation', onOrient);
      window.addEventListener('deviceorientationabsolute', onOrient);
    }

    return {
      start: function(){
        if(watch != null) return;
        if(!navigator.geolocation || !window.isSecureContext){
          if(o.onError) o.onError('GPS kräver https (sidan körs över ' + location.protocol + ')');
          return;
        }
        follow = true;
        watch = navigator.geolocation.watchPosition(fix, function(e){ if(o.onError) o.onError(e.message || ('fel ' + e.code)); },
                                                    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
        // iOS vill ha lov for kompassen, i samma knapptryck. Nekat = ingen kil nar man star still.
        const DO = window.DeviceOrientationEvent;
        if(DO && DO.requestPermission) DO.requestPermission().then(function(s){ if(s === 'granted') listenCompass(); }, function(){});
        else if(DO) listenCompass();
      },
      stop: function(){
        if(watch != null) navigator.geolocation.clearWatch(watch);
        watch = null; pos = null; follow = false;
        view.redraw();
      },
      on: function(){ return watch != null; },
      pos: function(){ return pos; },
      follow: function(){ return follow; },
      setFollow: function(b){
        follow = b;
        if(b && pos) view.setCenter(pos.lon, pos.lat, view.zoom < 12 ? 14 : view.zoom);
      },
    };
  }
  root.MapGps = MapGps;
})(typeof window !== 'undefined' ? window : globalThis);
