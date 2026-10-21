/**
 * GET /api/config
 * Retorna configuración pública inicial: giros disponibles, uso de cuota y llave pública de mapas.
 */

import { obtenerCatalogoGiros } from '../_lib/giros.js';
import { controlarUsoDiario } from '../_lib/uso.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-codigo, Authorization, Accept',
  'Access-Control-Max-Age': '86400'
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

export async function onRequestGet({ env }) {
  try {
    const usoInfo = await controlarUsoDiario(env, 0);

    const config = {
      ok: true,
      mapsBrowserKey: env?.GOOGLE_MAPS_BROWSER_KEY ? env.GOOGLE_MAPS_BROWSER_KEY.trim() : null,
      giros: obtenerCatalogoGiros(),
      usoHoy: usoInfo.limite !== null ? { usadas: usoInfo.usadas, limite: usoInfo.limite } : null,
      requiereCodigo: Boolean((env?.ACCESS_CODE || '').trim()),
      tieneGoogleKey: Boolean((env?.GOOGLE_PLACES_KEY || '').trim()),
      motor: (env?.GOOGLE_PLACES_KEY || '').trim() ? 'google' : 'openstreetmap'
    };

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...CORS_HEADERS
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Error al obtener configuración', detalle: err.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
      }
    );
  }
}
