/**
 * POST /api/acceso
 * Valida el código de acceso del vendedor y permite guardarlo localmente.
 */

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const codigoIngresado = (body.codigo || '').trim();
    const codigoEsperado = (env?.ACCESS_CODE || '').trim();

    // Si no hay código configurado en las variables, cualquier entrada es válida
    if (!codigoEsperado) {
      return new Response(JSON.stringify({ ok: true, mensaje: 'Acceso concedido (modo libre)' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (codigoIngresado && codigoIngresado === codigoEsperado) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
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
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Error procesando solicitud', detalle: err.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }
}
