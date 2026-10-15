/**
 * Integración oficial y directa con Google Maps Platform:
 * - Places API (New): https://places.googleapis.com/v1/places:searchNearby
 * - Routes API: https://routes.googleapis.com/directions/v2:computeRoutes
 */

import { clasificarGiro, esCentroComercialTipo } from './giros.js';

const URL_SEARCH_NEARBY = 'https://places.googleapis.com/v1/places:searchNearby';
const URL_COMPUTE_ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const FIELD_MASK_PLACES = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.location',
  'places.businessStatus',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.currentOpeningHours',
  'places.regularOpeningHours',
  'places.containingPlaces'
].join(',');

const FIELD_MASK_ROUTES = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.description',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails',
  'routes.legs.steps.navigationInstruction',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.distanceMeters'
].join(',');

/**
 * Normaliza un objeto devuelto por Google Places API (New) a nuestro contrato.
 * @param {any} p
 * @param {string} [giroSugerido]
 */
export function normalizarLugarGoogle(p, giroSugerido) {
  const tipos = Array.isArray(p.types) ? p.types : [];
  const giroInfo = clasificarGiro(tipos);
  const placeId = p.id || '';
  const lat = p.location?.latitude ?? null;
  const lng = p.location?.longitude ?? null;
  const nombre = p.displayName?.text || 'Sin nombre';

  const contenidoEn = Array.isArray(p.containingPlaces)
    ? p.containingPlaces.map((c) => ({
        placeId: c.id || '',
        nombre: c.displayName?.text || null,
        esCentroComercial: esCentroComercialTipo(c.types || [])
      }))
    : [];

  return {
    placeId,
    nombre,
    giroClave: giroSugerido || giroInfo.clave,
    giro: p.primaryTypeDisplayName?.text || giroInfo.etiqueta,
    tipos,
    direccion: p.formattedAddress || 'Dirección no disponible',
    direccionCorta: p.shortFormattedAddress || null,
    lat,
    lng,
    calificacion: typeof p.rating === 'number' ? p.rating : null,
    resenas: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
    estado: p.businessStatus || 'OPERATIONAL',
    abiertoAhora: p.currentOpeningHours?.openNow ?? null,
    telefono: p.nationalPhoneNumber || null,
    telefonoIntl: p.internationalPhoneNumber || null,
    web: p.websiteUri || null,
    mapsUrl:
      p.googleMapsUri ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nombre)}&query_place_id=${placeId}`,
    linkResena: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
    contenidoEn,
    esCentroComercial: esCentroComercialTipo(tipos)
  };
}

/**
 * Realiza una búsqueda de lugares cercanos vía Places API (New).
 * @param {{
 *   lat: number,
 *   lng: number,
 *   radio: number,
 *   tipos: string[],
 *   apiKey: string,
 *   giroClave?: string
 * }} params
 */
export async function buscarLugaresGoogle({ lat, lng, radio, tipos, apiKey, giroClave }) {
  const body = {
    includedTypes: tipos,
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: Math.min(Math.max(radio, 100), 50000)
      }
    },
    rankPreference: 'DISTANCE',
    languageCode: 'es-419',
    regionCode: 'MX'
  };

  const resp = await fetch(URL_SEARCH_NEARBY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK_PLACES
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errorTexto = await resp.text();
    let detalle = errorTexto;
    try {
      const errJson = JSON.parse(errorTexto);
      detalle = errJson.error?.message || errorTexto;
    } catch {}
    throw new Error(`Google Places API error (${resp.status}): ${detalle}`);
  }

  const datos = await resp.json();
  const rawPlaces = Array.isArray(datos.places) ? datos.places : [];

  return rawPlaces.map((p) => normalizarLugarGoogle(p, giroClave));
}

/**
 * Calcula ruta paso a paso mediante Routes API (TRANSIT, WALK o DRIVE).
 * @param {{
 *   origen: {lat: number, lng: number},
 *   destino: {placeId?: string, lat: number, lng: number},
 *   modo: 'TRANSIT' | 'WALK' | 'DRIVE',
 *   apiKey: string
 * }} params
 */
export async function calcularRutaGoogle({ origen, destino, modo, apiKey }) {
  const travelMode = modo === 'WALK' ? 'WALK' : modo === 'DRIVE' ? 'DRIVE' : 'TRANSIT';

  const body = {
    origin: {
      location: {
        latLng: {
          latitude: origen.lat,
          longitude: origen.lng
        }
      }
    },
    destination: destino.placeId
      ? { placeId: destino.placeId }
      : {
          location: {
            latLng: {
              latitude: destino.lat,
              longitude: destino.lng
            }
          }
        },
    travelMode,
    languageCode: 'es-419',
    units: 'METRIC'
  };

  const resp = await fetch(URL_COMPUTE_ROUTES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK_ROUTES
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errorTexto = await resp.text();
    let detalle = errorTexto;
    try {
      const errJson = JSON.parse(errorTexto);
      detalle = errJson.error?.message || errorTexto;
    } catch {}
    throw new Error(`Google Routes API error (${resp.status}): ${detalle}`);
  }

  const data = await resp.json();
  const ruta = Array.isArray(data.routes) && data.routes.length > 0 ? data.routes[0] : null;

  if (!ruta) {
    return {
      duracionSeg: 0,
      distanciaM: 0,
      resumen: null,
      pasos: [],
      sinRuta: true
    };
  }

  // Parsear duración (viene en formato "1234s" de protobuf)
  const duracionSeg = ruta.duration ? parseInt(ruta.duration.replace('s', ''), 10) || 0 : 0;
  const distanciaM = ruta.distanceMeters || 0;

  const pasos = [];
  const resumenPartes = [];

  const legs = Array.isArray(ruta.legs) ? ruta.legs : [];
  for (const leg of legs) {
    const steps = Array.isArray(leg.steps) ? leg.steps : [];
    for (const step of steps) {
      const stepDuracion = step.staticDuration ? parseInt(step.staticDuration.replace('s', ''), 10) || 0 : 0;
      const stepDistancia = step.distanceMeters || 0;
      const stepModo = step.travelMode || travelMode;
      const instruccion = step.navigationInstruction?.instructions || '';

      const pasoObj = {
        tipo: stepModo,
        instruccion,
        duracionSeg: stepDuracion,
        distanciaM: stepDistancia
      };

      if (stepModo === 'TRANSIT' && step.transitDetails) {
        const td = step.transitDetails;
        const linea = td.transitLine?.name || td.transitLine?.nameShort || 'Transporte';
        const vehiculo = td.transitLine?.vehicle?.type || 'BUS';
        const vehiculoNombre = td.transitLine?.vehicle?.name?.text || 'Transporte';
        const color = td.transitLine?.color || '#0057A8';
        const colorTexto = td.transitLine?.textColor || '#FFFFFF';
        const desde = td.stopDetails?.departureStop?.name || 'Origen';
        const hasta = td.stopDetails?.arrivalStop?.name || 'Destino';
        const paradas = td.stopCount || 1;
        const direccion = td.headsign || '';

        pasoObj.transporte = {
          linea,
          lineaCorta: td.transitLine?.nameShort || linea,
          vehiculo,
          vehiculoNombre,
          color,
          colorTexto,
          desde,
          hasta,
          paradas,
          direccion
        };

        const min = Math.max(1, Math.round(stepDuracion / 60));
        resumenPartes.push(`${vehiculoNombre} ${linea} (${min} min, ${paradas} paradas)`);
      } else if (stepModo === 'WALK') {
        const min = Math.max(1, Math.round(stepDuracion / 60));
        resumenPartes.push(`Camina ${min} min`);
      }

      pasos.push(pasoObj);
    }
  }

  const resumen = resumenPartes.length > 0 ? resumenPartes.join(' · ') : ruta.description || 'Ruta calculada';

  return {
    duracionSeg,
    distanciaM,
    resumen,
    pasos,
    sinRuta: false
  };
}
