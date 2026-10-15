/**
 * Prospector NFC · Orden de ruta + URLs de Google Maps (módulo PURO).
 *
 * Sin DOM, sin fetch, sin globals de Cloudflare: corre igual en el navegador y en Node 24.
 *
 * - ordenarRuta: vecino más cercano desde el origen + mejora 2-opt (camino abierto: no regresa).
 * - URLs con la API universal de Google Maps: https://www.google.com/maps/dir/?api=1
 *   (destination / destination_place_id / origin / origin_place_id / waypoints /
 *    waypoint_place_ids / travelmode). En móvil Google admite máximo 3 waypoints por URL y
 *   NO admite waypoints en transporte público.
 */

const BASE_DIR = 'https://www.google.com/maps/dir/';

/** Modos válidos de Google Maps URLs. */
const MODOS = Object.freeze(['transit', 'walking', 'driving']);

/** Alias aceptados (valores de /api/ruta del contrato) → modo de Google Maps URLs. */
const ALIAS_MODO = Object.freeze({
  transit: 'transit',
  walking: 'walking',
  walk: 'walking',
  driving: 'driving',
  drive: 'driving',
});

/** Máximo de waypoints por URL (límite del navegador móvil de Google Maps). */
const MAX_WAYPOINTS = 3;

/* ───────────────────────────── utilidades ───────────────────────────── */

/** @param {unknown} v */
const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);

/** @param {any} p */
const esCoordenada = (p) =>
  !!p && esNumero(p.lat) && esNumero(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** Distancia haversine en metros (copia local para mantener el módulo independiente). */
function distancia(a, b) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Normaliza el modo de viaje. Inválido o ausente → 'transit'.
 * @param {string} [modo]
 * @returns {'transit'|'walking'|'driving'}
 */
function normalizarModo(modo) {
  const m = typeof modo === 'string' ? ALIAS_MODO[modo.trim().toLowerCase()] : undefined;
  return m && MODOS.includes(m) ? /** @type {any} */ (m) : 'transit';
}

/** Coordenada compacta "lat,lng" con máximo 6 decimales (~11 cm). */
function coordTexto(p) {
  return `${Number(p.lat.toFixed(6))},${Number(p.lng.toFixed(6))}`;
}

/** @param {any} p */
const placeIdDe = (p) => (p && typeof p.placeId === 'string' && p.placeId.trim() ? p.placeId.trim() : null);

/**
 * Texto de destino/origen: coordenadas si existen; si no, dirección o nombre.
 * @param {any} p
 * @returns {string|null}
 */
function puntoTexto(p) {
  if (esCoordenada(p)) return coordTexto(p);
  if (p && typeof p.direccion === 'string' && p.direccion.trim()) return p.direccion.trim();
  if (p && typeof p.nombre === 'string' && p.nombre.trim()) return p.nombre.trim();
  return null;
}

/**
 * Construye una URL de direcciones de Google Maps.
 * @param {{origen:any|null, destino:any, waypoints?:any[], modo:string}} args
 *        origen null = "Tu ubicación" (Google usa la ubicación actual del dispositivo).
 * @returns {string}
 */
function construirUrl({ origen, destino, waypoints = [], modo }) {
  const params = new URLSearchParams();
  params.set('api', '1');
  const origenTxt = origen ? puntoTexto(origen) : null;
  if (origenTxt) {
    params.set('origin', origenTxt);
    const pid = placeIdDe(origen);
    if (pid) params.set('origin_place_id', pid);
  }
  params.set('destination', puntoTexto(destino) ?? '');
  const pidDestino = placeIdDe(destino);
  if (pidDestino) params.set('destination_place_id', pidDestino);
  const wps = waypoints.filter((w) => puntoTexto(w));
  if (wps.length > 0) {
    params.set('waypoints', wps.map(puntoTexto).join('|'));
    // Google exige que waypoint_place_ids tenga exactamente el mismo número de elementos.
    const ids = wps.map(placeIdDe);
    if (ids.every(Boolean)) params.set('waypoint_place_ids', ids.join('|'));
  }
  params.set('travelmode', normalizarModo(modo));
  return `${BASE_DIR}?${params.toString()}`;
}

/* ───────────────────────────── orden de ruta ───────────────────────────── */

/**
 * Longitud total de un camino abierto (suma de tramos consecutivos) usando matriz de distancias.
 * @param {number[]} camino índices de nodos (0 = origen)
 * @param {number[][]} D
 */
function longitudCamino(camino, D) {
  let total = 0;
  for (let i = 1; i < camino.length; i++) total += D[camino[i - 1]][camino[i]];
  return total;
}

/**
 * Ordena lugares para visitarlos desde `origen` minimizando la distancia total (camino abierto,
 * no regresa al origen). Heurística: vecino más cercano + mejora 2-opt hasta converger.
 *
 * No muta la entrada: devuelve un arreglo nuevo con las MISMAS referencias de objetos.
 * Lugares sin coordenadas válidas se agregan al final en su orden original.
 * Si `origen` no es válido, se parte del primer lugar con coordenadas.
 *
 * @template {{lat:number,lng:number}} T
 * @param {{lat:number,lng:number}|null} origen
 * @param {T[]} lugares
 * @returns {T[]}
 */
export function ordenarRuta(origen, lugares) {
  if (!Array.isArray(lugares) || lugares.length === 0) return [];
  const validos = lugares.filter(esCoordenada);
  const invalidos = lugares.filter((l) => !esCoordenada(l));
  if (validos.length <= 1) return [...validos, ...invalidos];

  // Nodo 0 = origen (o el primer lugar si no hay origen); nodos 1..n = lugares válidos.
  const conOrigen = esCoordenada(origen);
  const nodos = conOrigen ? [origen, ...validos] : validos;
  const n = nodos.length;
  const D = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : distancia(nodos[i], nodos[j])))
  );

  // ── Vecino más cercano (empate: menor índice original) ──
  const camino = [0];
  const visitado = new Array(n).fill(false);
  visitado[0] = true;
  for (let paso = 1; paso < n; paso++) {
    const actual = camino[camino.length - 1];
    let mejor = -1;
    for (let j = 1; j < n; j++) {
      if (!visitado[j] && (mejor === -1 || D[actual][j] < D[actual][mejor])) mejor = j;
    }
    visitado[mejor] = true;
    camino.push(mejor);
  }

  // ── 2-opt para camino abierto con inicio fijo (índice 0) ──
  // Invertir camino[i..j] cambia los tramos (i-1,i) y (j,j+1); si j es el final, no hay (j,j+1).
  const EPS = 1e-9;
  let mejoro = true;
  let vueltas = 0;
  while (mejoro && vueltas < 1000) {
    mejoro = false;
    vueltas++;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = camino[i - 1];
        const b = camino[i];
        const c = camino[j];
        const d = j + 1 < n ? camino[j + 1] : -1;
        const antes = D[a][b] + (d >= 0 ? D[c][d] : 0);
        const despues = D[a][c] + (d >= 0 ? D[b][d] : 0);
        if (despues < antes - EPS) {
          // Invertir segmento i..j in situ.
          for (let x = i, y = j; x < y; x++, y--) {
            const t = camino[x];
            camino[x] = camino[y];
            camino[y] = t;
          }
          mejoro = true;
        }
      }
    }
  }

  const orden = (conOrigen ? camino.slice(1) : camino).map((idx) => nodos[idx]);
  return [...orden, ...invalidos];
}

/* ───────────────────────────── URLs ───────────────────────────── */

/**
 * URL "Cómo llegar" de Google Maps hacia un lugar.
 * @param {{lat:number,lng:number}|null} origen null = ubicación actual del dispositivo.
 * @param {{placeId?:string, lat:number, lng:number}} lugar
 * @param {'transit'|'walking'|'driving'} [modo] inválido → 'transit'
 * @returns {string}
 */
export function urlComoLlegar(origen, lugar, modo) {
  // El origen del vendedor es una coordenada, no un negocio: no se manda origin_place_id.
  const o = esCoordenada(origen) ? { lat: origen.lat, lng: origen.lng } : null;
  return construirUrl({ origen: o, destino: lugar, modo });
}

/**
 * URLs de Google Maps para recorrer la ruta completa.
 *
 * - walking / driving: tramos de hasta 5 paradas por URL (origen + ≤3 waypoints + destino); cada
 *   URL empieza donde terminó la anterior. Con N lugares → ceil(N / 4) URLs.
 * - transit: Google no admite waypoints en transporte público → una URL por tramo (N URLs).
 *
 * Si `origen` es null, la primera URL omite `origin` (Google usa la ubicación actual).
 *
 * @param {{lat:number,lng:number}|null} origen
 * @param {Array<{placeId?:string, lat:number, lng:number}>} lugaresOrdenados
 * @param {'transit'|'walking'|'driving'} [modo]
 * @returns {string[]}
 */
export function urlsRutaCompleta(origen, lugaresOrdenados, modo) {
  if (!Array.isArray(lugaresOrdenados)) return [];
  const paradas = lugaresOrdenados.filter((l) => puntoTexto(l));
  if (paradas.length === 0) return [];
  const m = normalizarModo(modo);
  const inicio = esCoordenada(origen) ? { lat: origen.lat, lng: origen.lng } : null;
  // Secuencia completa de puntos; el índice 0 es el origen (null = ubicación actual).
  const puntos = [inicio, ...paradas];
  const urls = [];

  if (m === 'transit') {
    for (let k = 0; k + 1 < puntos.length; k++) {
      urls.push(construirUrl({ origen: puntos[k], destino: puntos[k + 1], modo: m }));
    }
    return urls;
  }

  const porUrl = MAX_WAYPOINTS + 1; // tramos (lugares nuevos) por URL
  for (let k = 0; k + 1 < puntos.length; k += porUrl) {
    const fin = Math.min(k + porUrl, puntos.length - 1);
    urls.push(
      construirUrl({
        origen: puntos[k],
        destino: puntos[fin],
        waypoints: puntos.slice(k + 1, fin),
        modo: m,
      })
    );
  }
  return urls;
}

/**
 * Link directo para que el cliente escriba una reseña en Google (para grabar en la tarjeta NFC).
 * @param {string} placeId
 * @returns {string}
 */
export function linkResena(placeId) {
  return 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(String(placeId ?? ''));
}

/**
 * Duración legible: "45 s", "12 min", "1 h 05 min". Dato inválido → "Sin dato".
 * @param {number} seg
 * @returns {string}
 */
export function duracionTexto(seg) {
  if (!esNumero(seg) || seg < 0) return 'Sin dato';
  const s = Math.round(seg);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `${h} h ${String(resto).padStart(2, '0')} min`;
}

/**
 * Distancia legible: "850 m", "1.2 km", "12 km". Dato inválido → "Sin dato".
 * @param {number} m metros
 * @returns {string}
 */
export function distanciaTexto(m) {
  if (!esNumero(m) || m < 0) return 'Sin dato';
  const r = Math.round(m);
  if (r < 1000) return `${r} m`;
  const km = m / 1000;
  if (km >= 10) return `${Math.round(km)} km`;
  const unDecimal = Math.round(km * 10) / 10;
  if (unDecimal >= 10) return '10 km';
  return `${Number.isInteger(unDecimal) ? unDecimal : unDecimal.toFixed(1)} km`;
}
