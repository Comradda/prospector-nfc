/**
 * POST /api/ruta
 * Calcula el trayecto hacia un negocio.
 * Si GOOGLE_PLACES_KEY está configurada, consulta Google Routes API.
 * Si no está configurada, calcula la distancia física y proporciona el enlace directo de navegación en Google Maps (gratuito e ilimitado).
 */

import { verificarAutenticacion, respuestaNoAutorizado } from '../_lib/auth.js';
import { calcularRutaGoogle } from '../_lib/google.js';

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lon2 - lon1) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-codigo, Authorization, Accept',
  'Access-Control-Max-Age': '86400'
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

export async function onRequestPost({ request, env }) {
  if (!verificarAutenticacion(request, env)) {
    return respuestaNoAutorizado();
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Cuerpo de petición JSON inválido', codigo: 'BAD_REQUEST' }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const origen = body.origen;
  const destino = body.destino;
  const modoEntrante = (body.modo || 'TRANSIT').toUpperCase();
  const modo = ['TRANSIT', 'WALK', 'DRIVE'].includes(modoEntrante) ? modoEntrante : 'TRANSIT';

  if (!origen || isNaN(parseFloat(origen.lat)) || isNaN(parseFloat(origen.lng))) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Coordenadas de origen inválidas',
        codigo: 'ORIGEN_INVALIDO'
      }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  if (
    !destino ||
    (!destino.placeId && (isNaN(parseFloat(destino.lat)) || isNaN(parseFloat(destino.lng))))
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Destino inválido (se requiere placeId o lat/lng)',
        codigo: 'DESTINO_INVALIDO'
      }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const oLat = parseFloat(origen.lat);
  const oLng = parseFloat(origen.lng);
  const dLat = parseFloat(destino.lat || 0);
  const dLng = parseFloat(destino.lng || 0);
  const distM = calcularDistanciaMetros(oLat, oLng, dLat, dLng);

  const apiKey = (env?.GOOGLE_PLACES_KEY || '').trim();

  // Si no hay API key de Google, calculamos estimación física y derivamos a la app de Google Maps
  if (!apiKey) {
    const velKmh = modo === 'WALK' ? 4.5 : modo === 'DRIVE' ? 25 : 18;
    const duracionSeg = Math.max(60, Math.round((distM / 1000 / velKmh) * 3600));

    return new Response(
      JSON.stringify({
        ok: true,
        modo,
        duracionSeg,
        distanciaM: distM,
        resumen: `Distancia aproximada: ${distM} m. Usa el botón inferior para abrir la ruta y traslados paso a paso en tu app de Google Maps.`,
        pasos: [],
        avisos: [
          'Navegación nativa de Google Maps activada (100% gratuita y sin costo de API).'
        ]
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  try {
    const ruta = await calcularRutaGoogle({
      origen: { lat: oLat, lng: oLng },
      destino: {
        placeId: destino.placeId,
        lat: dLat,
        lng: dLng
      },
      modo,
      apiKey
    });

    const avisos = [];
    if (ruta.sinRuta || ruta.pasos.length === 0) {
      if (modo === 'TRANSIT') {
        avisos.push(
          'Google no encontró una combinación de transporte público directa para este tramo. Te sugerimos revisar a pie o en auto.'
        );
      } else {
        avisos.push('No se encontró una ruta directa.');
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        modo,
        duracionSeg: ruta.duracionSeg,
        distanciaM: ruta.distanciaM,
        resumen: ruta.resumen,
        pasos: ruta.pasos,
        avisos
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...CORS_HEADERS
        }
      }
    );
  } catch (err) {
    console.error('Error calculando ruta con Google:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Error al calcular la ruta en Google Routes API',
        detalle: err.message,
        codigo: 'ERROR_ROUTES'
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
      }
    );
  }
}
