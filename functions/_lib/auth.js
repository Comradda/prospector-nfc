/**
 * Verificación de seguridad para proteger los endpoints contra consumo no autorizado de la API Key.
 */

/**
 * Comparación de strings en tiempo constante.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function comparacionSegura(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;

  let dif = 0;
  for (let i = 0; i < bufA.length; i++) {
    dif |= bufA[i] ^ bufB[i];
  }
  return dif === 0;
}

/**
 * Valida el código de acceso proporcionado en la solicitud.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @returns {boolean}
 */
export function verificarAutenticacion(request, env) {
  const codigoRequerido = (env?.ACCESS_CODE || '').trim();
  // Si no se configuró código en el entorno, se permite (modo desarrollo permisivo)
  if (!codigoRequerido) return true;

  const codigoEnviado = (request.headers.get('x-codigo') || '').trim();
  if (!codigoEnviado) return false;

  return comparacionSegura(codigoEnviado, codigoRequerido);
}

/**
 * Genera una respuesta 401 estructurada.
 * @returns {Response}
 */
export function respuestaNoAutorizado() {
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'Código de acceso no válido o ausente. Ingresa tu código de vendedor.',
      codigo: 'NO_AUTORIZADO'
    }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    }
  );
}
