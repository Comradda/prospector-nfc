/**
 * POST /api/buscar
 * Busca negocios del público objetivo cerca de las coordenadas del vendedor usando Google Places API (New).
 */

import { verificarAutenticacion, respuestaNoAutorizado } from '../_lib/auth.js';
import { GIROS, obtenerGiroPorClave } from '../_lib/giros.js';
import { buscarLugaresGoogle } from '../_lib/google.js';
import { controlarUsoDiario } from '../_lib/uso.js';

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

  // Verificar cuota diaria
  const numConsultas = girosAProcesar.length;
  const usoInfo = await controlarUsoDiario(env, numConsultas);
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

  const avisos = [];
  const todosLugares = [];

  // Ejecución paralela de búsquedas por cada giro
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
          `${giro.etiqueta}: Google devolvió el tope de 20 resultados. Reduce el radio de búsqueda si deseas mayor detalle local.`
        );
      }
      return lugares;
    } catch (err) {
      console.error(`Error buscando giro ${giro.clave}:`, err);
      avisos.push(`No se pudo consultar el giro ${giro.etiqueta}: ${err.message}`);
      return [];
    }
  });

  const resultados = await Promise.all(promesas);
  for (const lista of resultados) {
    todosLugares.push(...lista);
  }

  // Deduplicar por placeId y filtrar negocios cerrados permanentemente
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
      origen: { lat, lng },
      radio,
      generado: new Date().toISOString(),
      consultasGoogle: numConsultas,
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
