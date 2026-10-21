/**
 * POST /api/acceso
 * Valida el código de acceso del vendedor y permite guardarlo localmente.
 */

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
  try {
    const body = await request.json().catch(() => ({}));
    const codigoIngresado = (body.codigo || '').trim();
    const codigoEsperado = (env?.ACCESS_CODE || '').trim();

    // Si no hay código configurado en las variables, cualquier entrada es válida
    if (!codigoEsperado) {
      return new Response(JSON.stringify({ ok: true, mensaje: 'Acceso concedido (modo libre)' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
      });
    }

    if (codigoIngresado && codigoIngresado === codigoEsperado) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
      });
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: 'El código de acceso no es correcto. Verifica con el administrador.',
        codigo: 'CODIGO_INVALIDO'
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Error procesando solicitud', detalle: err.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
      }
    );
  }
}
