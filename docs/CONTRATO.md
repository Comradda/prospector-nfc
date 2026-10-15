# Prospector NFC · Contrato técnico compartido

App web **móvil** (Android / iPhone) para vendedores de tarjetas NFC de reseñas Google.
Encuentra negocios de servicio cercanos, **prioriza los que más reseñas necesitan**, detecta
**plazas pequeñas (<15 negocios)**, arma rutas (transporte público / a pie / auto) y entrega el
**Place ID + link de reseña** listo para pegar en la app *NFC Tools*.

> Regla de oro: **solo datos reales** de Google Places API. Nada inventado, nada simulado en producción.
> Si un dato no existe, se muestra "Sin dato". Google **no** expone dueño, correo ni estado "reclamado".

## Stack
- **Hosting:** Cloudflare Pages (estático en `public/`) + Pages Functions (`functions/`). Gratis.
- **Frontend:** HTML + CSS + JavaScript vanilla (ES modules), sin build step, PWA instalable.
- **Backend:** Pages Functions (Workers runtime, `fetch`), sin dependencias de runtime.
- **Tests:** `node --test tests/` (Node 24). Los módulos puros no deben usar globals de Cloudflare al importarse.
- **Dev local:** `npx wrangler pages dev public` con `.dev.vars` (nunca se commitea).

## Estructura
```
nfc-prospector/
  public/
    index.html, manifest.webmanifest, sw.js, icons/
    css/app.css
    js/app.js        # UI principal (frontend)
    js/api.js        # cliente de /api/* (frontend)
    js/mapa.js       # mapa Google Maps JS opcional (frontend)
    js/scoring.js    # algoritmo de prioridad (algoritmo) — puro
    js/ruta.js       # orden de ruta + URLs de Google Maps (algoritmo) — puro
  functions/
    api/acceso.js    # POST
    api/config.js    # GET
    api/buscar.js    # POST
    api/ruta.js      # POST
    _lib/            # helpers puros del backend (giros, normalizar, auth, cache, uso)
  tests/             # node:test
  docs/
```

## Variables de entorno (Cloudflare → Settings → Variables / `.dev.vars` local)
| Nombre | Tipo | Uso |
|---|---|---|
| `GOOGLE_PLACES_KEY` | Secreto (solo servidor) | Places API (New) + Routes API. Nunca llega al navegador. |
| `GOOGLE_MAPS_BROWSER_KEY` | Público opcional | Maps JavaScript API para el mapa. Restringida por HTTP referrer. Si falta, la app funciona sin mapa. |
| `ACCESS_CODE` | Secreto | Código que el vendedor captura una vez. Protege la clave de abuso. |
| `DAILY_LIMIT` | Opcional (def. `60`) | Máx. llamadas a Google por día (requiere KV `USO`). |
| KV `USO` | Binding opcional | Contador diario de llamadas. Si no existe, no hay tope (se avisa en `/api/config`). |

## Autenticación
Todas las rutas excepto `POST /api/acceso` exigen header `x-codigo: <ACCESS_CODE>`.
Comparación en tiempo constante. Respuesta 401 `{ok:false, error:"Código de acceso inválido", codigo:"NO_AUTORIZADO"}`.

## Formato de error común
`{ "ok": false, "error": "Mensaje claro en español", "codigo": "CODIGO_MAYUS" }` con status HTTP adecuado
(400 validación, 401 auth, 429 tope diario, 502 error de Google, 500 interno).

## Endpoints

### `POST /api/acceso`
Body `{ "codigo": "..." }` → `200 {ok:true}` o `401`.

### `GET /api/config`
→ `{ ok:true, mapsBrowserKey: string|null, giros: [{clave, etiqueta, emoji}], usoHoy: {usadas, limite}|null }`

### `POST /api/buscar`
Body:
```json
{ "lat": 19.4326, "lng": -99.1332, "radio": 800, "giros": ["restaurantes","cafeterias"] }
```
- `radio`: 200–3000 m (se ajusta al rango). `giros`: subconjunto de las claves de abajo (vacío = todas).
- Una llamada a `places:searchNearby` por giro (máx. 20 resultados c/u, `rankPreference: DISTANCE`),
  deduplicando por `placeId`. Se descartan negocios con `businessStatus` `CLOSED_PERMANENTLY`.
- Caché (Cache API de Workers) 12 h con clave = lat/lng redondeados a 3 decimales + radio + giro.

Respuesta:
```json
{
  "ok": true,
  "origen": {"lat": 19.4326, "lng": -99.1332},
  "radio": 800,
  "generado": "2026-10-15T08:00:00.000Z",
  "consultasGoogle": 2,
  "desdeCache": 0,
  "lugares": [ /* Lugar */ ],
  "avisos": ["Restaurantes: Google devolvió el máximo (20); acerca la búsqueda para ver más."]
}
```

**Lugar** (normalizado por el backend):
```json
{
  "placeId": "ChIJ...",
  "nombre": "Barbería El Güero",
  "giroClave": "barberias",
  "giro": "Barbería",
  "tipos": ["barber_shop","hair_care"],
  "direccion": "Calle X 123, Col. Y, CDMX",
  "direccionCorta": "Calle X 123, Col. Y",
  "lat": 19.43, "lng": -99.13,
  "calificacion": 4.6,
  "resenas": 12,
  "estado": "OPERATIONAL",
  "abiertoAhora": true,
  "telefono": "55 1234 5678",
  "telefonoIntl": "+52 55 1234 5678",
  "web": null,
  "mapsUrl": "https://maps.google.com/?cid=...",
  "linkResena": "https://search.google.com/local/writereview?placeid=ChIJ...",
  "contenidoEn": [{"placeId": "ChIJ...", "nombre": "Plaza Las Flores"}],
  "esCentroComercial": false
}
```
`calificacion`, `abiertoAhora`, `telefono*`, `web` pueden ser `null`. `resenas` = 0 si no hay.
`contenidoEn` = `containingPlaces` de Google (si está disponible; si no, `[]`).

### `POST /api/ruta`
Body:
```json
{ "origen": {"lat": 19.43, "lng": -99.13}, "destino": {"placeId": "ChIJ...", "lat": 19.44, "lng": -99.12}, "modo": "TRANSIT" }
```
`modo`: `TRANSIT` | `WALK` | `DRIVE`. Llama a Routes API `computeRoutes`. Caché 30 min.
Respuesta:
```json
{
  "ok": true,
  "modo": "TRANSIT",
  "duracionSeg": 1260,
  "distanciaM": 4300,
  "resumen": "Camina 4 min · Metro L2 (5 paradas) · Camina 3 min",
  "pasos": [
    {"tipo":"WALK","instruccion":"Camina hacia el norte por Av. X","duracionSeg":240,"distanciaM":300},
    {"tipo":"TRANSIT","instruccion":"Metro hacia Cuatro Caminos","duracionSeg":600,"distanciaM":3500,
     "transporte":{"linea":"Línea 2","lineaCorta":"2","vehiculo":"SUBWAY","vehiculoNombre":"Metro",
                   "color":"#0057A8","colorTexto":"#FFFFFF","desde":"Zócalo","hasta":"Hidalgo",
                   "paradas":5,"direccion":"Cuatro Caminos"}}
  ],
  "avisos": []
}
```
Si Google no encuentra ruta en transporte: `200 {ok:true, pasos:[], resumen:null, avisos:["Sin ruta en transporte público; prueba a pie o en auto."]}`.

## Giros (claves fijas)
| clave | etiqueta | emoji |
|---|---|---|
| `restaurantes` | Restaurantes | 🍽️ |
| `cafeterias` | Cafeterías | ☕ |
| `barberias` | Barberías | 💈 |
| `esteticas` | Estéticas y uñas | 💅 |
| `comida_rapida` | Taquerías y comida rápida | 🌮 |
| `consultorios` | Consultorios | 🩺 |

El mapeo giro → `includedTypes` de Google vive solo en `functions/_lib/giros.js`.

## Módulos del algoritmo (frontend, puros, testeables en Node)

### `public/js/scoring.js`
```js
export function distanciaMetros(a, b)            // haversine, {lat,lng}
export function detectarPlazas(lugares, opts)    // → Map<placeId, {id, nombre|null, tamano, tipo:'chica'|'grande'|'aislado'}>
export function puntuar(lugares, origen, opts)   // → copia enriquecida y ordenada desc por puntaje
```
`puntuar` agrega a cada lugar: `distancia` (m), `plaza` (objeto de arriba), `puntaje` (0–100 entero),
`prioridad` (`'alta'|'media'|'baja'`), `motivos` (strings cortos en español, p. ej. "Solo 3 reseñas",
"Plaza chica (6 negocios)", "A 250 m", "Sin sitio web").

### `public/js/ruta.js`
```js
export function ordenarRuta(origen, lugares)                 // vecino más cercano + 2-opt → arreglo ordenado
export function urlComoLlegar(origen, lugar, modo)           // URL Google Maps (origen null = ubicación actual)
export function urlsRutaCompleta(origen, lugaresOrdenados, modo) // arreglo de URLs (fragmentado por límite de waypoints)
export function linkResena(placeId)                          // https://search.google.com/local/writereview?placeid=...
export function duracionTexto(seg), distanciaTexto(m)        // "12 min", "1.2 km"
```
`modo` en ruta.js: `'transit'|'walking'|'driving'` (valores de Google Maps URLs).

## Atribución
Mostrar siempre "Datos de Google Maps" / logo de Google cuando se listan resultados sin mapa de Google.
Nunca mostrar datos de Places sobre mapas que no sean de Google.
