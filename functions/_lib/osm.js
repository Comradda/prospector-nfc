/**
 * Integración con OpenStreetMap (Overpass API).
 * 100% Gratuito, código abierto, sin requerir Google Cloud, tarjetas ni prepago.
 * Obtiene comercios reales, giros, direcciones y coordenadas geográficas.
 */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

/**
 * Mapeo de giros de la app a filtros de etiquetas en OpenStreetMap
 */
const FILTROS_OSM_GIROS = {
  restaurantes: [
    'node["amenity"="restaurant"]',
    'way["amenity"="restaurant"]',
    'node["amenity"="food_court"]',
    'way["amenity"="food_court"]'
  ],
  cafeterias: [
    'node["amenity"="cafe"]',
    'way["amenity"="cafe"]',
    'node["shop"="coffee"]'
  ],
  barberias: [
    'node["shop"="hairdresser"]',
    'way["shop"="hairdresser"]'
  ],
  esteticas: [
    'node["shop"="beauty"]',
    'way["shop"="beauty"]',
    'node["shop"="nail_salon"]',
    'way["shop"="nail_salon"]',
    'node["shop"="spa"]'
  ],
  comida_rapida: [
    'node["amenity"="fast_food"]',
    'way["amenity"="fast_food"]'
  ],
  consultorios: [
    'node["amenity"="dentist"]',
    'way["amenity"="dentist"]',
    'node["amenity"="doctors"]',
    'way["amenity"="doctors"]',
    'node["amenity"="clinic"]',
    'way["amenity"="clinic"]',
    'node["amenity"="veterinary"]',
    'way["amenity"="veterinary"]'
  ]
};

/**
 * Clasifica un elemento de OSM dentro de nuestro catálogo de giros
 * @param {Record<string, string>} tags
 * @returns {{clave: string, etiqueta: string}}
 */
export function clasificarGiroOSM(tags = {}) {
  const amenity = tags.amenity || '';
  const shop = tags.shop || '';

  if (amenity === 'cafe' || shop === 'coffee') {
    return { clave: 'cafeterias', etiqueta: 'Cafetería' };
  }
  if (shop === 'hairdresser') {
    return { clave: 'barberias', etiqueta: 'Barbería / Estética' };
  }
  if (shop === 'beauty' || shop === 'nail_salon' || shop === 'spa') {
    return { clave: 'esteticas', etiqueta: 'Estética / Salón' };
  }
  if (amenity === 'fast_food') {
    return { clave: 'comida_rapida', etiqueta: 'Comida rápida / Tacos' };
  }
  if (amenity === 'restaurant' || amenity === 'food_court') {
    return { clave: 'restaurantes', etiqueta: 'Restaurante' };
  }
  if (['dentist', 'doctors', 'clinic', 'veterinary'].includes(amenity)) {
    return { clave: 'consultorios', etiqueta: 'Consultorio / Clínica' };
  }
  return { clave: 'servicios', etiqueta: 'Comercio local' };
}

/**
 * Normaliza un elemento de OpenStreetMap al contrato uniforme de Lugar
 * @param {any} el
 * @param {string} [giroSugerido]
 */
export function normalizarLugarOSM(el, giroSugerido) {
  const tags = el.tags || {};
  const nombre = tags.name || tags['name:es'] || 'Comercio sin nombre';
  const giroInfo = clasificarGiroOSM(tags);
  const placeId = `osm:${el.type}:${el.id}`;

  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;

  // Armar dirección con etiquetas addr:*
  const partesDireccion = [];
  if (tags['addr:street']) {
    let calle = tags['addr:street'];
    if (tags['addr:housenumber']) calle += ` #${tags['addr:housenumber']}`;
    partesDireccion.push(calle);
  }
  if (tags['addr:suburb']) partesDireccion.push(tags['addr:suburb']);
  if (tags['addr:city']) partesDireccion.push(tags['addr:city']);

  const direccion = partesDireccion.length > 0
    ? partesDireccion.join(', ')
    : (lat && lng ? `Cerca de ${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Dirección no especificada');

  const direccionCorta = tags['addr:street']
    ? `${tags['addr:street']}${tags['addr:housenumber'] ? ' #' + tags['addr:housenumber'] : ''}`
    : direccion;

  const telefono = tags.phone || tags['contact:phone'] || null;
  const web = tags.website || tags['contact:website'] || null;

  // URL universal de búsqueda en Google Maps:
  // Al tocar la tarjeta NFC o abrir el enlace, el móvil abre automáticamente la ficha oficial en Google Maps
  const queryBusqueda = encodeURIComponent(`${nombre} ${direccion !== 'Dirección no especificada' ? direccion : ''}`.trim());
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${queryBusqueda}`;

  return {
    placeId,
    nombre,
    giroClave: giroSugerido || giroInfo.clave,
    giro: giroInfo.etiqueta,
    tipos: [tags.amenity, tags.shop].filter(Boolean),
    direccion,
    direccionCorta,
    lat,
    lng,
    calificacion: null,
    resenas: 0,
    estado: 'OPERATIONAL',
    abiertoAhora: null,
    telefono,
    telefonoIntl: telefono,
    web,
    mapsUrl,
    linkResena: mapsUrl, // Enlace para escribir a la tarjeta NFC
    contenidoEn: [],
    esCentroComercial: tags.shop === 'mall' || tags.amenity === 'marketplace',
    fuente: 'openstreetmap'
  };
}

/**
 * Consulta negocios cercanos a través de la Overpass API
 * @param {{
 *   lat: number,
 *   lng: number,
 *   radio: number,
 *   giros: string[]
 * }} params
 */
export async function buscarLugaresOSM({ lat, lng, radio, giros }) {
  const lineasFiltro = [];

  for (const g of giros) {
    const filtros = FILTROS_OSM_GIROS[g] || [];
    for (const f of filtros) {
      lineasFiltro.push(`  ${f}(around:${radio}, ${lat}, ${lng});`);
    }
  }

  // Si no se pasaron giros o no hay filtros, buscar categorías principales
  if (lineasFiltro.length === 0) {
    lineasFiltro.push(`  node["amenity"~"restaurant|cafe|fast_food|dentist|doctors|clinic"](around:${radio}, ${lat}, ${lng});`);
    lineasFiltro.push(`  way["amenity"~"restaurant|cafe|fast_food|dentist|doctors|clinic"](around:${radio}, ${lat}, ${lng});`);
    lineasFiltro.push(`  node["shop"~"hairdresser|beauty|nail_salon|spa"](around:${radio}, ${lat}, ${lng});`);
    lineasFiltro.push(`  way["shop"~"hairdresser|beauty|nail_salon|spa"](around:${radio}, ${lat}, ${lng});`);
  }

  const queryOverpass = `
[out:json][timeout:25];
(
${lineasFiltro.join('\n')}
);
out center tags;
  `.trim();

  let ultimoError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: `data=${encodeURIComponent(queryOverpass)}`
      });

      if (!resp.ok) {
        ultimoError = new Error(`Overpass status ${resp.status} en ${endpoint}`);
        continue;
      }

      const data = await resp.json();
      const elementos = Array.isArray(data.elements) ? data.elements : [];

      // Filtrar elementos que tengan nombre real para que el vendedor tenga prospectos válidos
      const validos = elementos.filter((el) => {
        const n = el.tags?.name || el.tags?.['name:es'];
        return typeof n === 'string' && n.trim().length > 0;
      });

      return validos.map((el) => normalizarLugarOSM(el));
    } catch (err) {
      ultimoError = err;
      console.warn(`Fallo al consultar endpoint OSM ${endpoint}:`, err.message);
    }
  }

  throw ultimoError || new Error('No se pudo conectar a los servidores de OpenStreetMap.');
}
