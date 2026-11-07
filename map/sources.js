/* =====================================================================
   map/sources.js  -  KARTKALLOR. Bara data. Delas av datorn (via config.js)
   och telefonappen (map/mobile/). Egen fil for att telefonappen ska kunna
   publiceras utan config.js - den innehaller hempunkten och det lokala
   kartutdraget. Lagg aldrig personliga uppgifter har.
   ===================================================================== */
(function(){
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  // blankTile=false: saknad Esri-ruta = fel (da forstoras narmaste niva) i stallet
  // for en "Map data not yet available"-bild.
  const esri = function(svc){ return ESRI + svc + '/MapServer/tile/{z}/{y}/{x}?blankTile=false'; };
  // Lantmateriets Topografisk webbkarta Nedladdning, raster: fri, kraver konto pa Geotorget.
  // Lases direkt ur filen (map/gpkg.js). Inloggningen matas in i OPTN - aldrig har.
  const LM = 'https://dl1.lantmateriet.se/karta/topowebb/data/';

window.MAP_SOURCES = {
  // Vektorrutor i realtid (map/vtiles.js): WATER, ROADS, NAMES och husen till LOS.
  // OpenFreeMap (OpenMapTiles-schema, OSM-data, ingen nyckel), zoom 0-14 - darover
  // anvands zoom 14-rutorna skarpt. Inget sparas lokalt.
  vtiles: { tilejson: 'https://tiles.openfreemap.org/planet', maxZoom: 14 },

  // Hojddata for LASER, TOPO 3D, TOPO LINES, HGHT och LOS: Mapterhorn - Terrarium-kodade
  // 512 px-rutor ur oppna laserdata (Sverige 1 m), ingen nyckel, CORS. Saknas en niva
  // nagonstans anvands narmaste overliggande. (Grovre alternativ: AWS Terrarium,
  // https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png, maxZoom 15.)
  dem: { url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp', maxZoom: 16 },

  /* ---- BASKARTOR, i kategorier (rubrikerna i BASE-fonstret). ----
     id = unikt, label = text i fonstret, short = rad 2 pa BASE (max 4 tecken).
     layers = rasterkallor som ritas i ordning (platta, sedan t.ex. namn ovanpa):
       { url, maxZoom, filter, subdomains, key }  - {s} = subdoman, {key} = API-nyckel
       (tom nyckel -> lagret ritar inget, DIAG TILE-01). Over maxZoom forstoras rutorna.
     vector:true = VECT (offline, map/data/). dimmer:true = ljusstyrka pa OSB 21/22
     (alla ljusa kartor - de morka och VECT behover ingen).
     Ingen kalla har kraver nyckel, men attribution visas och villkoren galler.
     OpenStreetMap-servrarna (OSM, HOT, CyclOSM, OpenTopoMap) ar ideella - bara
     latt, personlig anvandning. De kraver en Referer, darfor servar run.py sidan
     over http://127.0.0.1 i stallet for file://. CARTO dark_all kraver numera nyckel. */
  bases: [
    { head: 'VEKTOR', maps: [
      { id: 'vect', label: 'VECT', short: 'VECT', vector: true, attribution: 'Natural Earth' },
    ] },
    { head: 'TILE', maps: [
      // Esri morkgra platta + ortnamn ovanpa. Lugn, men till zoom 16 och utan byggnader.
      { id: 'tile', label: 'TILE', short: 'TILE', attribution: 'Esri, HERE, Garmin, © OpenStreetMap', layers: [
        { url: esri('Canvas/World_Dark_Gray_Base'), maxZoom: 16, filter: 'brightness(0.6)' },
        { url: esri('Canvas/World_Dark_Gray_Reference'), maxZoom: 16 } ] },
      // Esri gatukarta inverterad till mork graskala: ortnamn, vagar, byggnader till zoom 19.
      { id: 'strt', label: 'STRT', short: 'STRT', attribution: 'Esri, HERE, Garmin, USGS, © OpenStreetMap', layers: [
        { url: esri('World_Street_Map'), maxZoom: 19, filter: 'invert(1) hue-rotate(180deg) grayscale(1) brightness(0.8) contrast(1.15)' } ] },
    ] },
    { head: 'STANDARD', maps: [
      { id: 'osm', label: 'OPENSTREETMAP', short: 'OSM', dimmer: true, attribution: '© OpenStreetMap', layers: [
        { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19 } ] },
      { id: 'esri', label: 'ESRI GATA', short: 'ESRI', dimmer: true, attribution: 'Esri, HERE, Garmin, USGS, © OpenStreetMap', layers: [
        { url: esri('World_Street_Map'), maxZoom: 19 } ] },
      { id: 'hot', label: 'HUMANITÄR', short: 'HOT', dimmer: true, attribution: '© OpenStreetMap, Humanitarian OSM Team', layers: [
        { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 19 } ] },
      { id: 'cyclosm', label: 'CYCLOSM', short: 'CYCL', dimmer: true, attribution: '© OpenStreetMap, CyclOSM', layers: [
        { url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 19 } ] },
    ] },
    { head: 'TOPO', maps: [
      { id: 'otm', label: 'OPENTOPOMAP', short: 'OTM', dimmer: true, attribution: '© OpenStreetMap, SRTM, © OpenTopoMap (CC-BY-SA)', layers: [
        { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 17 } ] },
      { id: 'etopo', label: 'ESRI TOPO', short: 'ETOP', dimmer: true, attribution: 'Esri, HERE, Garmin, USGS, © OpenStreetMap', layers: [
        { url: esri('World_Topo_Map'), maxZoom: 19 } ] },
      { id: 'lm', label: 'LANTMÄTERIET', short: 'LM', dimmer: true, attribution: '© Lantmäteriet', layers: [
        { gpkg: LM + 'topowebb-3857.gpkg', maxZoom: 17 } ] },
      { id: 'lmgr', label: 'LANTMÄTERIET GRÅ', short: 'LMGR', dimmer: true, attribution: '© Lantmäteriet', layers: [
        { gpkg: LM + 'topowebb_nedtonad-3857.gpkg', maxZoom: 17 } ] },
    ] },
    { head: 'LASER', maps: [
      // Terrangskuggning ur laserdata (Sverige: Lantmateriets 1 m-markmodell via Mapterhorn).
      // Ritas av appen ur hojddatan (layers.dem) - ingen rasterkalla.
      { id: 'laser', label: 'LASER', short: 'LASR', dem: 'laser', attribution: '© Mapterhorn, Lantmäteriet (laserdata)' },
    ] },
    { head: 'SAT', maps: [
      // Satellitbild till zoom 19 dar den finns - annars forstoras narmaste niva.
      { id: 'sat', label: 'SAT', short: 'SAT', dimmer: true, attribution: 'Esri, Maxar, Earthstar Geographics', layers: [
        { url: esri('World_Imagery'), maxZoom: 19 } ] },
    ] },
  ],
};
})();
