/**
 * Prospector NFC · Motor de Mapa Interactivo Minimalista
 * Funciona de forma 100% inmediata y gratuita usando Leaflet + CartoDB Positron (paleta blanca arquitectónica),
 * mostrando la ubicación del vendedor, radio de cobertura, prospectos por prioridad y trazo de ruta.
 */

let mapaInstancia = null;
let capaMarcadores = null;
let capaRuta = null;
let marcadorUsuario = null;
let circuloRadio = null;
let leafletCargado = false;
let promesaCarga = null;

const CENTRO_DEFECTO = { lat: 19.4326, lng: -99.1332 }; // CDMX Centro

/**
 * Carga dinámicamente Leaflet (CSS + JS) si aún no está presente en el documento.
 * @returns {Promise<boolean>}
 */
export async function asegurarMotorMapa() {
  if (leafletCargado && window.L) return true;
  if (promesaCarga) return promesaCarga;

  promesaCarga = new Promise((resolve) => {
    if (window.L) {
      leafletCargado = true;
      resolve(true);
      return;
    }

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => {
      leafletCargado = true;
      resolve(true);
    };
    script.onerror = () => {
      console.warn('No se pudo cargar la librería de mapas.');
      promesaCarga = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return promesaCarga;
}

/**
 * Inicializa el mapa en el contenedor indicado.
 * @param {HTMLElement} contenedor
 * @param {{lat: number, lng: number}} [centro]
 */
export async function inicializarMapa(contenedor, centro = CENTRO_DEFECTO) {
  if (!contenedor) return null;
  const ok = await asegurarMotorMapa();
  if (!ok || !window.L) return null;

  if (mapaInstancia) {
    setTimeout(() => mapaInstancia.invalidateSize(), 60);
    return mapaInstancia;
  }

  // Limpiar cualquier mensaje estático previo dentro del contenedor
  contenedor.innerHTML = '';

  const L = window.L;
  const coords =
    centro && typeof centro.lat === 'number' && typeof centro.lng === 'number'
      ? [centro.lat, centro.lng]
      : [CENTRO_DEFECTO.lat, CENTRO_DEFECTO.lng];

  mapaInstancia = L.map(contenedor, {
    center: coords,
    zoom: 15,
    zoomControl: false,
    attributionControl: true
  });

  // Control de zoom en esquina inferior derecha (fácil alcance con el pulgar)
  L.control.zoom({ position: 'bottomright' }).addTo(mapaInstancia);

  // CartoDB Positron (diseño blanco minimalista de alta legibilidad)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(mapaInstancia);

  capaRuta = L.layerGroup().addTo(mapaInstancia);
  capaMarcadores = L.layerGroup().addTo(mapaInstancia);

  setTimeout(() => {
    if (mapaInstancia) mapaInstancia.invalidateSize();
  }, 100);

  return mapaInstancia;
}

/**
 * Recalcula dimensiones del mapa cuando la pestaña se hace visible.
 */
export function refrescarTamanoMapa() {
  if (!mapaInstancia) return;
  setTimeout(() => {
    mapaInstancia.invalidateSize({ animate: false });
  }, 50);
}

/**
 * Centra el mapa en una coordenada específica.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [zoom]
 */
export function centrarEn(lat, lng, zoom = 16) {
  if (!mapaInstancia || typeof lat !== 'number' || typeof lng !== 'number') return;
  mapaInstancia.setView([lat, lng], zoom, { animate: true });
}

/**
 * Dibuja o actualiza la posición actual del vendedor y su radio de búsqueda.
 * @param {{lat: number, lng: number}} pos
 * @param {number} [radioMetros]
 */
export function pintarUbicacionUsuario(pos, radioMetros = 800) {
  if (!mapaInstancia || !window.L || !pos || typeof pos.lat !== 'number') return;
  const L = window.L;

  if (marcadorUsuario) {
    marcadorUsuario.setLatLng([pos.lat, pos.lng]);
  } else {
    const iconoUsuario = L.divIcon({
      className: 'map-user-pin-wrapper',
      html: `<div class="map-user-dot"><div class="map-user-pulse"></div></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    marcadorUsuario = L.marker([pos.lat, pos.lng], {
      icon: iconoUsuario,
      zIndexOffset: 1000
    })
      .bindTooltip('Tu ubicación actual', { direction: 'top', offset: [0, -10] })
      .addTo(mapaInstancia);
  }

  if (circuloRadio) {
    circuloRadio.setLatLng([pos.lat, pos.lng]);
    circuloRadio.setRadius(radioMetros);
  } else {
    circuloRadio = L.circle([pos.lat, pos.lng], {
      radius: radioMetros,
      color: '#09090B',
      weight: 1,
      dashArray: '4 4',
      fillColor: '#09090B',
      fillOpacity: 0.03,
      interactive: false
    }).addTo(mapaInstancia);
  }
}

/**
 * Dibuja los marcadores de los comercios con etiqueta de reseñas y color de prioridad.
 * @param {Array<any>} lugares
 * @param {Function} onSelectLugar
 */
export function pintarLugaresEnMapa(lugares, onSelectLugar) {
  if (!mapaInstancia || !window.L || !capaMarcadores) return;
  const L = window.L;

  capaMarcadores.clearLayers();
  if (!Array.isArray(lugares) || lugares.length === 0) return;

  const puntos = [];

  for (const l of lugares) {
    if (typeof l.lat !== 'number' || typeof l.lng !== 'number') continue;
    puntos.push([l.lat, l.lng]);

    const prio = l.prioridad || 'baja';
    const numResenas = typeof l.resenas === 'number' ? l.resenas : 0;
    const textoPin = numResenas > 99 ? '99+' : String(numResenas);

    const icono = L.divIcon({
      className: 'map-prospect-pin-wrapper',
      html: `
        <div class="map-prospect-pin prio-${prio}">
          <span class="map-prospect-count">${textoPin}</span>
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const marker = L.marker([l.lat, l.lng], {
      icon: icono,
      zIndexOffset: prio === 'alta' ? 500 : prio === 'media' ? 300 : 100
    });

    marker.on('click', () => {
      if (typeof onSelectLugar === 'function') {
        onSelectLugar(l);
      }
    });

    capaMarcadores.addLayer(marker);
  }

  if (marcadorUsuario) {
    const uPos = marcadorUsuario.getLatLng();
    puntos.push([uPos.lat, uPos.lng]);
  }

  if (puntos.length > 0) {
    const bounds = L.latLngBounds(puntos);
    mapaInstancia.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
  }
}

/**
 * Dibuja la línea de la ruta de visitas seleccionadas sobre el mapa.
 * @param {{lat: number, lng: number}|null} origen
 * @param {Array<any>} paradasOrdenadas
 */
export function pintarTrazoRutaEnMapa(origen, paradasOrdenadas) {
  if (!mapaInstancia || !window.L || !capaRuta) return;
  const L = window.L;

  capaRuta.clearLayers();
  if (!Array.isArray(paradasOrdenadas) || paradasOrdenadas.length === 0) return;

  const coords = [];
  if (origen && typeof origen.lat === 'number' && typeof origen.lng === 'number') {
    coords.push([origen.lat, origen.lng]);
  }

  paradasOrdenadas.forEach((p, idx) => {
    if (typeof p.lat === 'number' && typeof p.lng === 'number') {
      coords.push([p.lat, p.lng]);
      const badgeParada = L.divIcon({
        className: 'map-route-step-wrapper',
        html: `<div class="map-route-step-badge">${idx + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [-10, 24]
      });
      L.marker([p.lat, p.lng], { icon: badgeParada, interactive: false, zIndexOffset: 800 }).addTo(
        capaRuta
      );
    }
  });

  if (coords.length >= 2) {
    L.polyline(coords, {
      color: '#09090B',
      weight: 2.5,
      dashArray: '6 6',
      opacity: 0.75
    }).addTo(capaRuta);
  }
}
