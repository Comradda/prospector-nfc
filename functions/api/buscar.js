/**
 * POST /api/buscar
 * Busca comercios cercanos del público objetivo con su Place ID real (ChIJ...),
 * enlace directo para NFC Tools (https://search.google.com/local/writereview?placeid=ChIJ...)
 * y número real de reseñas y calificación en Google Maps.
 */

import { verificarAutenticacion, respuestaNoAutorizado } from '../_lib/auth.js';
import { GIROS, obtenerGiroPorClave } from '../_lib/giros.js';
import { buscarLugaresGoogle } from '../_lib/google.js';
import { buscarGiroGooglePublico } from '../_lib/gmaps-public.js';
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
        error: 'Coordenadas lat/lng requeridas o inválidas',
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
  const avisos = [];
  const todosLugares = [];
  let numConsultasGoogle = 0;
  let motorUtilizado = 'google_maps_direct';

  if (apiKey && body.proveedor === 'google_api') {
    // ── Modo Google Places API (con API Key de Cloud) ──
    motorUtilizado = 'google_api';
    numConsultasGoogle = girosAProcesar.length;
    const usoInfo = await controlarUsoDiario(env, numConsultasGoogle);
    if (!usoInfo.permitido) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Límite diario alcanzado (${usoInfo.limite} consultas).`,
          codigo: 'LIMITE_DIARIO_ALCANZADO',
          usoHoy: { usadas: usoInfo.usadas, limite: usoInfo.limite }
        }),
        { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const promesas = girosAProcesar.map(async (giro) => {
      try {
        return await buscarLugaresGoogle({
          lat,
          lng,
          radio,
          tipos: giro.googleTypes,
          apiKey,
          giroClave: giro.clave
        });
      } catch (err) {
        console.error(`Error buscando giro ${giro.clave}:`, err);
        return [];
      }
    });

    const resultados = await Promise.all(promesas);
    for (const lista of resultados) {
      todosLugares.push(...lista);
    }
  } else {
    // ── Modo Directo Google Maps (100% Gratuito, Place IDs ChIJ... reales y reseñas reales) ──
    const promesas = girosAProcesar.map(async (giro) => {
      try {
        return await buscarGiroGooglePublico({
          lat,
          lng,
          radio,
          giroClave: giro.clave
        });
      } catch (err) {
        console.warn(`Aviso buscando giro ${giro.clave} en Google Maps directo:`, err.message);
        return [];
      }
    });

    const resultados = await Promise.all(promesas);
    for (const lista of resultados) {
      todosLugares.push(...lista);
    }

    // Fallback a OpenStreetMap únicamente si Google Maps directo no devolvió resultados por red
    if (todosLugares.length === 0 && body.proveedor === 'osm') {
      motorUtilizado = 'openstreetmap';
      const claves = girosAProcesar.map((g) => g.clave);
      const osmLugares = await buscarLugaresOSM({ lat, lng, radio, giros: claves }).catch(() => []);
      todosLugares.push(...osmLugares);
    }
  }

  // Deduplicar por placeId y filtrar cerrados permanentemente
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
