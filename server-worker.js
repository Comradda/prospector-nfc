/**
 * Cloudflare Worker Entrypoint
 * Maneja las rutas de /api/* delegando en las funciones existentes,
 * y sirve los archivos estáticos de /public para cualquier otra ruta.
 */

import { onRequestPost as buscarPost } from './functions/api/buscar.js';
import { onRequestGet as configGet } from './functions/api/config.js';
import { onRequestPost as accesoPost } from './functions/api/acceso.js';
import { onRequestPost as rutaPost } from './functions/api/ruta.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/buscar') {
      if (request.method === 'POST') {
        return buscarPost({ request, env: env || {}, params: {} });
      }
      return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405 });
    }

    if (url.pathname === '/api/config') {
      if (request.method === 'GET') {
        return configGet({ request, env: env || {}, params: {} });
      }
      return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405 });
    }

    if (url.pathname === '/api/acceso') {
      if (request.method === 'POST') {
        return accesoPost({ request, env: env || {}, params: {} });
      }
      return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405 });
    }

    if (url.pathname === '/api/ruta') {
      if (request.method === 'POST') {
        return rutaPost({ request, env: env || {}, params: {} });
      }
      return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405 });
    }

    // Servir archivos estáticos del frontend (HTML, CSS, JS, imágenes)
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('No encontrado', { status: 404 });
  }
};
