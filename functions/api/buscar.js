/**
 * POST /api/buscar
 * Busca negocios del público objetivo cerca de las coordenadas del vendedor.
 * Soporta dos motores:
 * 1) OpenStreetMap (Overpass API): 100% Gratuito, sin tarjetas, sin prepago ni Google Cloud.
 * 2) Google Places API (New): Si está configurada la llave GOOGLE_PLACES_KEY.
 */

import { verificarAutenticacion, respuestaNoAutorizado } from '../_lib/auth.js';
import { GIROS, obtenerGiroPorClave } from '../_lib/giros.js';
import { buscarLugaresGoogle } from '../_lib/google.js';
import { buscarLugaresOSM } from '../_lib/osm.js';
import { controlarUsoDiario } from '../_lib/uso.js';

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

  const lat = parseFloat(body.lat);
  const lng = parseFloat(body.lng);

  if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Coordenadas lat/lng requeridas e inválidas',
        codigo: 'COORDENADAS_INVALIDAS'
      }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  // Radio entre 200 y 3000 metros (defecto 800)
  const radio = Math.min(Math.max(parseInt(body.radio, 10) || 800, 200), 3000);

  // Determinar giros a consultar
  const girosSolicitados = Array.isArray(body.giros) && body.giros.length > 0 ? body.giros : [];
  const girosAProcesar = [];

  if (girosSolicitados.length === 0) {
    girosAProcesar.push(...GIROS);
  } else {
    for (const clave of girosSolicitados) {
      const g = obtenerGiroPorClave(clave);
      if (g) girosAProcesar.push(g);
    }
    if (girosAProcesar.length === 0) {
      girosAProcesar.push(...GIROS);
    }
  }

  const apiKey = (env?.GOOGLE_PLACES_KEY || '').trim();
  const forzarOSM = body.proveedor === 'osm' || !apiKey;
  const avisos = [];
  let todosLugares = [];
  let numConsultasGoogle = 0;
  let motorUtilizado = 'openstreetmap';

  if (!forzarOSM && apiKey) {
    // ── Modo Google Places API (New) ──
    motorUtilizado = 'google';
    numConsultasGoogle = girosAProcesar.length;
    const usoInfo = await controlarUsoDiario(env, numConsultasGoogle);
    if (!usoInfo.permitido) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Has alcanzado el límite de seguridad diario (${usoInfo.limite} consultas) para proteger tu cuenta de Google. Vuelve a intentarlo mañana.`,
          codigo: 'LIMITE_DIARIO_ALCANZADO',
          usoHoy: { usadas: usoInfo.usadas, limite: usoInfo.limite }
        }),
        { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const promesas = girosAProcesar.map(async (giro) => {
      try {
        const lugares = await buscarLugaresGoogle({
          lat,
          lng,
          radio,
          tipos: giro.googleTypes,
          apiKey,
          giroClave: giro.clave
        });

        if (lugares.length >= 20) {
          avisos.push(
            `${giro.etiqueta}: Google devolvió el tope de 20 resultados. Reduce el radio para mayor detalle local.`
          );
        }
        return lugares;
      } catch (err) {
        console.error(`Error buscando giro ${giro.clave} en Google:`, err);
        avisos.push(`No se pudo consultar el giro ${giro.etiqueta} en Google: ${err.message}`);
        return [];
      }
    });

    const resultados = await Promise.all(promesas);
    for (const lista of resultados) {
      todosLugares.push(...lista);
    }
  } else {
    // ── Modo OpenStreetMap (100% Libre y Gratuito) ──
    motorUtilizado = 'openstreetmap';
    try {
      const claves = girosAProcesar.map((g) => g.clave);
      todosLugares = await buscarLugaresOSM({ lat, lng, radio, giros: claves });
      avisos.push('Búsqueda realizada con OpenStreetMap (100% Gratuito y Libre).');
    } catch (err) {
      console.error('Error buscando en OpenStreetMap:', err);
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Error al consultar comercios en OpenStreetMap: ${err.message}`,
          codigo: 'ERROR_OSM'
        }),
        { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }
  }

  // Deduplicar por placeId y filtrar cerrados
  const vistos = new Set();
  const lugaresDeduplicados = [];

  for (const lugar of todosLugares) {
    if (!lugar.placeId || vistos.has(lugar.placeId)) continue;
    if (lugar.estado === 'CLOSED_PERMANENTLY') continue;
    vistos.add(lugar.placeId);
    lugaresDeduplicados.push(lugar);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      motor: motorUtilizado,
      origen: { lat, lng },
      radio,
      generado: new Date().toISOString(),
      consultasGoogle: numConsultasGoogle,
      desdeCache: 0,
      totalEncontrados: lugaresDeduplicados.length,
      lugares: lugaresDeduplicados,
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
}
