/**
 * Servidor Local de Desarrollo para Prospector NFC
 * Cero dependencias externas: corre con Node.js 24 nativo.
 * Sirve los archivos estáticos de /public y ejecuta las funciones de /api.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PUERTO = 8788;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// Cargar controladores de functions/api
const { onRequestGet: handleConfig } = await import('./functions/api/config.js');
const { onRequestPost: handleBuscar } = await import('./functions/api/buscar.js');
const { onRequestPost: handleRuta } = await import('./functions/api/ruta.js');
const { onRequestPost: handleAcceso } = await import('./functions/api/acceso.js');

/**
 * Convierte una petición http.IncomingMessage a un Request del estándar Web Fetch
 * @param {http.IncomingMessage} req
 * @returns {Promise<Request>}
 */
async function adaptarReqAFetch(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const bodyBuffer = Buffer.concat(chunks);
  const fullUrl = `http://${req.headers.host || 'localhost'}${req.url}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }

  const init = {
    method: req.method,
    headers
  };

  if (['POST', 'PUT', 'PATCH'].includes(req.method) && bodyBuffer.length > 0) {
    init.body = bodyBuffer;
  }

  return new Request(fullUrl, init);
}

/**
 * Escribe una Response Web estándar en el http.ServerResponse de Node
 * @param {Response} webRes
 * @param {http.ServerResponse} nodeRes
 */
async function enviarWebResponse(webRes, nodeRes) {
  nodeRes.statusCode = webRes.status;
  for (const [k, v] of webRes.headers.entries()) {
    nodeRes.setHeader(k, v);
  }
  const arrayBuf = await webRes.arrayBuffer();
  nodeRes.end(Buffer.from(arrayBuf));
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // ── Manejo de Rutas de la API (/api/*) ──
  if (pathname.startsWith('/api/')) {
    try {
      const webReq = await adaptarReqAFetch(req);
      const env = process.env;

      if (pathname === '/api/config' && req.method === 'GET') {
        const webRes = await handleConfig({ request: webReq, env });
        return await enviarWebResponse(webRes, res);
      }
      if (pathname === '/api/buscar' && req.method === 'POST') {
        const webRes = await handleBuscar({ request: webReq, env });
        return await enviarWebResponse(webRes, res);
      }
      if (pathname === '/api/ruta' && req.method === 'POST') {
        const webRes = await handleRuta({ request: webReq, env });
        return await enviarWebResponse(webRes, res);
      }
      if (pathname === '/api/acceso' && req.method === 'POST') {
        const webRes = await handleAcceso({ request: webReq, env });
        return await enviarWebResponse(webRes, res);
      }

      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: false, error: 'Endpoint no encontrado' }));
    } catch (err) {
      console.error('Error en controlador API:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: false, error: 'Error interno del servidor', detalle: err.message }));
    }
  }

  // ── Archivos Estáticos (/public) ──
  let rutaRelativa = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  let archivoFisico = path.join(PUBLIC_DIR, rutaRelativa);

  if (!fs.existsSync(archivoFisico) || fs.statSync(archivoFisico).isDirectory()) {
    archivoFisico = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(archivoFisico).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const contenido = fs.readFileSync(archivoFisico);
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.end(contenido);
  } catch (err) {
    res.statusCode = 404;
    res.end('Archivo no encontrado');
  }
});

function obtenerIPLocal() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PUERTO, () => {
  const ipLocal = obtenerIPLocal();
  console.log(`\n======================================================`);
  console.log(`🚀 Prospector NFC iniciado exitosamente`);
  console.log(`======================================================`);
  console.log(`💻 En tu computadora: http://localhost:${PUERTO}`);
  console.log(`📱 En tu celular (misma red WiFi): http://${ipLocal}:${PUERTO}`);
  console.log(`======================================================\n`);
});
