/**
 * Control y limitación del consumo diario de la Google Places API.
 * Evita facturación inesperada manteniendo las peticiones dentro del umbral gratuito.
 */

function obtenerFechaHoyUTC() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Consulta y opcionalmente incrementa el contador diario de llamadas.
 * @param {Record<string, any>} env
 * @param {number} [incremento=0]
 * @returns {Promise<{permitido: boolean, usadas: number|null, limite: number|null}>}
 */
export async function controlarUsoDiario(env, incremento = 0) {
  const limiteStr = env?.DAILY_LIMIT || '60';
  const limite = parseInt(limiteStr, 10) || 60;

  // Si no está vinculado el KV 'USO', operamos sin límite persistente
  if (!env?.USO || typeof env.USO.get !== 'function') {
    return {
      permitido: true,
      usadas: null,
      limite: null
    };
  }

  const hoy = obtenerFechaHoyUTC();
  const clave = `uso:${hoy}`;

  try {
    const valorActual = await env.USO.get(clave);
    const usadas = parseInt(valorActual || '0', 10) || 0;

    if (incremento > 0 && usadas + incremento > limite) {
      return {
        permitido: false,
        usadas,
        limite
      };
    }

    let nuevasUsadas = usadas;
    if (incremento > 0) {
      nuevasUsadas = usadas + incremento;
      // Expira en 48 horas (172800 segundos) para auto-limpieza
      await env.USO.put(clave, nuevasUsadas.toString(), { expirationTtl: 172800 });
    }

    return {
      permitido: true,
      usadas: nuevasUsadas,
      limite
    };
  } catch (err) {
    console.error('Error al acceder al KV de uso:', err);
    // En caso de fallo transitorio del KV, permitimos para no romper el flujo
    return { permitido: true, usadas: null, limite };
  }
}
