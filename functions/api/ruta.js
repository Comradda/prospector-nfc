/**
 * POST /api/ruta
 * Calcula el trayecto exacto hacia un negocio (transporte público, a pie o auto) mediante Google Routes API.
 */

import { verificarAutenticacion, respuestaNoAutorizado } from '../_lib/auth.js';
import { calcularRutaGoogle } from '../_lib/google.js';

export async function onRequestPost({ request, env }) {
  if (!verificarAutenticacion(request, env)) {
    return respuestaNoAutorizado();
  }

  const apiKey = (env?.GOOGLE_PLACES_KEY || '').trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'La variable GOOGLE_PLACES_KEY no está configurada en el servidor. Configúrala en Cloudflare Pages o en tu archivo .dev.vars.',
        codigo: 'FALTA_API_KEY'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
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

  try {
    const ruta = await calcularRutaGoogle({
      origen: { lat: parseFloat(origen.lat), lng: parseFloat(origen.lng) },
      destino: {
        placeId: destino.placeId,
        lat: parseFloat(destino.lat || 0),
        lng: parseFloat(destino.lng || 0)
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
          'Cache-Control': 'no-store'
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
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }
}
