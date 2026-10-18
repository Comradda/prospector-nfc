/**
 * GET /api/config
 * Retorna configuración pública inicial: giros disponibles, uso de cuota y llave pública de mapas.
 */

import { obtenerCatalogoGiros } from '../_lib/giros.js';
import { controlarUsoDiario } from '../_lib/uso.js';

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
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Error al obtener configuración', detalle: err.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }
}
