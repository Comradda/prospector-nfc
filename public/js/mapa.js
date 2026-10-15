/**
 * Integración con Google Maps JavaScript API.
 * Cumple estrictamente con los Términos de Servicio de Google:
 * Solo muestra datos de Places sobre el mapa oficial de Google Maps si existe GOOGLE_MAPS_BROWSER_KEY.
 */

let googleMapsCargado = false;
let cargandoScript = false;
let mapaInstancia = null;
let marcadores = [];
let marcadorUsuario = null;

/**
 * Carga de forma asíncrona la Google Maps JavaScript API.
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function cargarGoogleMapsScript(apiKey) {
  if (googleMapsCargado) return true;
  if (!apiKey) return false;

  if (cargandoScript) {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (googleMapsCargado) {
          clearInterval(interval);
          resolve(true);
        }
      }, 100);
    });
  }

  cargandoScript = true;

  return new Promise((resolve, reject) => {
    window.__initGoogleMapCallback = () => {
      googleMapsCargado = true;
      cargandoScript = false;
      delete window.__initGoogleMapCallback;
      resolve(true);
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&callback=__initGoogleMapCallback&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = (e) => {
      cargandoScript = false;
      console.warn('No se pudo cargar Google Maps JavaScript API:', e);
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

/**
 * Inicializa el contenedor del mapa.
 * @param {HTMLElement} contenedor
 * @param {{lat: number, lng: number}} centro
 */
export function inicializarMapa(contenedor, centro) {
  if (!googleMapsCargado || !window.google?.maps) return null;

  mapaInstancia = new window.google.maps.Map(contenedor, {
    center: centro,
    zoom: 15,
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }
    ]
  });

  return mapaInstancia;
}

/**
 * Centra el mapa en una coordenada.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [zoom]
 */
export function centrarEn(lat, lng, zoom = 16) {
  if (!mapaInstancia) return;
  mapaInstancia.panTo({ lat, lng });
  if (zoom) mapaInstancia.setZoom(zoom);
}

/**
 * Genera el SVG del pin coloreado según la prioridad.
 * @param {'alta'|'media'|'baja'} prioridad
 */
function iconoPinSvg(prioridad) {
  const color =
    prioridad === 'alta' ? '#10B981' : prioridad === 'media' ? '#F59E0B' : '#64748B';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 48" width="36" height="48">
    <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>
    <circle cx="18" cy="18" r="7" fill="#FFFFFF"/>
  </svg>`;

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new window.google.maps.Size(32, 42),
    anchor: new window.google.maps.Point(16, 42)
  };
}

/**
 * Actualiza los marcadores de los negocios en el mapa.
 * @param {Array<any>} lugares
 * @param {Function} onSelectLugar
 */
export function pintarLugaresEnMapa(lugares, onSelectLugar) {
  if (!mapaInstancia || !window.google?.maps) return;

  // Limpiar marcadores anteriores
  for (const m of marcadores) {
    m.setMap(null);
  }
  marcadores = [];

  const bounds = new window.google.maps.LatLngBounds();

  for (const l of lugares) {
    if (typeof l.lat !== 'number' || typeof l.lng !== 'number') continue;

    const pos = { lat: l.lat, lng: l.lng };
    bounds.extend(pos);

    const marker = new window.google.maps.Marker({
      position: pos,
      map: mapaInstancia,
      title: l.nombre,
      icon: iconoPinSvg(l.prioridad || 'baja')
    });

    marker.addListener('click', () => {
      if (typeof onSelectLugar === 'function') {
        onSelectLugar(l);
      }
    });

    marcadores.push(marker);
  }

  if (lugares.length > 0 && !bounds.isEmpty()) {
    mapaInstancia.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
  }
}

/**
 * Dibuja o actualiza la posición del usuario.
 * @param {{lat: number, lng: number}} pos
 */
export function pintarUbicacionUsuario(pos) {
  if (!mapaInstancia || !window.google?.maps) return;

  if (!marcadorUsuario) {
    marcadorUsuario = new window.google.maps.Marker({
      position: pos,
      map: mapaInstancia,
      title: 'Tu ubicación',
      zIndex: 999,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#3B82F6',
        fillOpacity: 1,
        strokeColor: '#FFFFFF',
        strokeWeight: 3
      }
    });
  } else {
    marcadorUsuario.setPosition(pos);
  }
}
