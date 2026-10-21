/**
 * Cloudflare Worker Entrypoint
 * Maneja las rutas de /api/* delegando en las funciones existentes,
 * da soporte completo a CORS (incluyendo preflight OPTIONS de Safari/iOS),
 * y sirve los archivos estáticos de /public para cualquier otra ruta.
 */

import { onRequestPost as buscarPost } from './functions/api/buscar.js';
import { onRequestGet as configGet } from './functions/api/config.js';
import { onRequestPost as accesoPost } from './functions/api/acceso.js';
import { onRequestPost as rutaPost } from './functions/api/ruta.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-codigo, Authorization, Accept',
  'Access-Control-Max-Age': '86400'
};

function conCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Responder de inmediato a cualquier preflight OPTIONS (Safari/iOS/Chrome PWA)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      if (url.pathname === '/api/buscar') {
        if (request.method === 'POST') {
          const res = await buscarPost({ request, env: env || {}, params: {} });
          return conCors(res);
        }
        return conCors(new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405 }));
      }

      if (url.pathname === '/api/config') {
        if (request.method === 'GET') {
          const res = await configGet({ request, env: env || {}, params: {} });
          return conCors(res);
        }
        return conCors(new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405 }));
      }

      if (url.pathname === '/api/acceso') {
        if (request.method === 'POST') {
          const res = await accesoPost({ request, env: env || {}, params: {} });
          return conCors(res);
        }
        return conCors(new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405 }));
      }

      if (url.pathname === '/api/ruta') {
        if (request.method === 'POST') {
          const res = await rutaPost({ request, env: env || {}, params: {} });
          return conCors(res);
        }
        return conCors(new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405 }));
      }

      // Servir archivos estáticos del frontend (HTML, CSS, JS, imágenes)
      if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        return await env.ASSETS.fetch(request);
      }

      return conCors(new Response('No encontrado', { status: 404 }));
    } catch (err) {
      console.error('Error no capturado en Worker:', err);
      return conCors(
        new Response(
          JSON.stringify({ ok: false, error: 'Error interno del servidor', detalle: err.message }),
          { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        )
      );
    }
  }
};
