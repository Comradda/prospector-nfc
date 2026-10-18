/**
 * Extractor público de Google Maps (sin requerir Google Cloud Billing ni API Key).
 * Obtiene en tiempo real:
 * - Place ID oficial (ChIJ...)
 * - Link directo para NFC Tools: https://search.google.com/local/writereview?placeid=ChIJ...
 * - Número exacto de reseñas en Google Maps y calificación por estrellas
 * - Dirección, teléfono, sitio web, giro y coordenadas
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Términos de búsqueda en Google Maps para cada giro de nuestro catálogo.
 */
const TERMINOS_GIRO = {
  restaurantes: 'restaurante',
  cafeterias: 'cafeteria',
  barberias: 'barberia',
  esteticas: 'estetica salon de belleza',
  comida_rapida: 'taqueria comida rapida',
  consultorios: 'consultorio dental medico veterinaria'
};

/**
 * Calcula distancia Haversine en metros entre dos coordenadas.
 */
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Limpia cualquier emoji de un texto (por ejemplo, nombres de negocios que ponen emojis en Maps)
 * para mantener una interfaz 100% limpia y profesional.
 * @param {string} str
 * @returns {string}
 */
export function limpiarEmojis(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Parsear un registro individual de la matriz de Google Maps (tbm=map).
 * @param {Array<any>} item
 * @param {string} giroClave
 */
export function parsearItemGoogleMaps(item, giroClave = 'servicios') {
  if (!Array.isArray(item)) return null;

  const placeId =
    (typeof item[78] === 'string' && item[78].startsWith('ChIJ') ? item[78] : null) ||
    (typeof item[227]?.[0]?.[4] === 'string' && item[227][0][4].startsWith('ChIJ')
      ? item[227][0][4]
      : null);

  if (!placeId) return null;

  const nombreBruto = typeof item[11] === 'string' ? item[11] : '';
  const nombre = limpiarEmojis(nombreBruto) || nombreBruto.trim();
  if (!nombre) return null;

  const lat = typeof item[9]?.[2] === 'number' ? item[9][2] : null;
  const lng = typeof item[9]?.[3] === 'number' ? item[9][3] : null;
  if (lat === null || lng === null) return null;

  const categorias = Array.isArray(item[13]) ? item[13].filter((c) => typeof c === 'string') : [];
  const giro = limpiarEmojis(categorias[0] || 'Comercio');

  const calificacion = typeof item[4]?.[7] === 'number' ? item[4][7] : null;
  const resenas = typeof item[4]?.[8] === 'number' ? Math.max(0, Math.floor(item[4][8])) : 0;

  const direccionPartes = Array.isArray(item[2]) ? item[2].filter(Boolean) : [];
  const direccion =
    (typeof item[39] === 'string' && item[39].trim()) ||
    direccionPartes.join(', ') ||
    'Dirección no disponible';
  const direccionCorta = direccionPartes[0] || direccion;

  const telefono =
    (typeof item[178]?.[0]?.[0] === 'string' && item[178][0][0].trim()) || null;
  const telefonoIntl =
    (typeof item[178]?.[0]?.[3] === 'string' && item[178][0][3].trim()) || telefono;

  const web = (typeof item[7]?.[0] === 'string' && item[7][0].trim()) || null;

  const textoCategorias = categorias.join(' ').toLowerCase();
  const esCentroComercial =
    textoCategorias.includes('centro comercial') ||
    textoCategorias.includes('shopping mall') ||
    textoCategorias.includes('tienda departamental');

  return {
    placeId,
    nombre,
    giroClave,
    giro,
    tipos: categorias,
    direccion,
    direccionCorta,
    lat,
    lng,
    calificacion,
    resenas,
    estado: 'OPERATIONAL',
    abiertoAhora: null,
    telefono,
    telefonoIntl,
    web,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nombre)}&query_place_id=${encodeURIComponent(placeId)}`,
    linkResena: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
    contenidoEn: [],
    esCentroComercial
  };
}

/**
 * Consulta negocios cercanos para un giro específico en Google Maps público.
 * @param {{lat: number, lng: number, radio: number, giroClave: string}} params
 */
export async function buscarGiroGooglePublico({ lat, lng, radio, giroClave }) {
  const termino = TERMINOS_GIRO[giroClave] || giroClave || 'comercio';
  // Ajustar span de cámara al radio solicitado
  const span = Math.max(600, Math.round(radio * 2.2));
  const pb = `!4m12!1m3!1d${span}!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!7i20!10b1`;
  const url = `https://www.google.com/search?tbm=map&authuser=0&hl=es-419&gl=mx&q=${encodeURIComponent(termino)}&pb=${pb}`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'es-MX,es-419;q=0.9,es;q=0.8'
    }
  });

  if (!resp.ok) {
    throw new Error(`Google Maps respondió con estado ${resp.status}`);
  }

  const text = await resp.text();
  const clean = text.replace(/^\)\]\}'\n?/, '');
  const data = JSON.parse(clean);
  const entries = Array.isArray(data?.[0]?.[1]) ? data[0][1] : [];

  const lugares = [];
  // Permitimos un margen razonable (radio * 1.5) para no recortar negocios en bordes de cuadra
  const radioMaximo = Math.max(radio * 1.5, 500);

  for (const entry of entries) {
    const item = entry?.[14];
    const parsed = parsearItemGoogleMaps(item, giroClave);
    if (!parsed) continue;
    const dist = distanciaMetros(lat, lng, parsed.lat, parsed.lng);
    if (dist <= radioMaximo) {
      lugares.push(parsed);
    }
  }

  return lugares;
}
