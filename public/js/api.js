/**
 * Cliente HTTP para comunicación con los endpoints de Cloudflare Pages Functions.
 * Gestiona el header x-codigo, almacenamiento local y manejo unificado de errores.
 */

const STORAGE_KEY_CODIGO = 'nfc_prospector_codigo';

let onAuthErrorCallback = null;

export function suscribirErrorAutenticacion(callback) {
  onAuthErrorCallback = callback;
}

export function obtenerCodigoGuardado() {
  return localStorage.getItem(STORAGE_KEY_CODIGO) || '';
}

export function guardarCodigoAcceso(codigo) {
  if (codigo) {
    localStorage.setItem(STORAGE_KEY_CODIGO, codigo.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_CODIGO);
  }
}

export function limpiarCodigoAcceso() {
  localStorage.removeItem(STORAGE_KEY_CODIGO);
}

/**
 * Petición fetch envuelta con cabeceras de autorización y manejo de errores.
 * @param {string} url
 * @param {RequestInit} [opciones={}]
 */
async function fetchConAuth(url, opciones = {}) {
  const codigo = obtenerCodigoGuardado();
  const headers = new Headers(opciones.headers || {});

  if (codigo) {
    headers.set('x-codigo', codigo);
  }

  if (opciones.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...opciones, headers });

  if (res.status === 401) {
    limpiarCodigoAcceso();
    if (typeof onAuthErrorCallback === 'function') {
      onAuthErrorCallback();
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Sesión expirada o código de acceso inválido.');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const mensaje = (data && data.error) || `Error del servidor (${res.status})`;
    const errorObj = new Error(mensaje);
    errorObj.codigo = data?.codigo;
    errorObj.status = res.status;
    errorObj.data = data;
    throw errorObj;
  }

  return data;
}

/**
 * Valida un código de acceso ante el servidor.
 * @param {string} codigo
 */
export async function validarAcceso(codigo) {
  const res = await fetch('/api/acceso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Código incorrecto');
  }

  guardarCodigoAcceso(codigo);
  return data;
}

/**
 * Obtiene la configuración pública inicial del servidor.
 */
export async function obtenerConfiguracion() {
  try {
    const res = await fetch('/api/config');
    return await res.json();
  } catch (err) {
    console.error('Error obteniendo /api/config:', err);
    return {
      ok: false,
      mapsBrowserKey: null,
      giros: [],
      usoHoy: null,
      requiereCodigo: false
    };
  }
}

/**
 * Realiza la búsqueda de prospectos según ubicación, radio y giros seleccionados.
 * @param {{
 *   lat: number,
 *   lng: number,
 *   radio: number,
 *   giros: string[]
 * }} params
 */
export async function buscarProspectos(params) {
  return await fetchConAuth('/api/buscar', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

/**
 * Consulta la ruta punto a punto (transporte público, a pie o auto).
 * @param {{
 *   origen: {lat: number, lng: number},
 *   destino: {placeId?: string, lat: number, lng: number},
 *   modo: 'TRANSIT' | 'WALK' | 'DRIVE'
 * }} params
 */
export async function obtenerRuta(params) {
  return await fetchConAuth('/api/ruta', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}
