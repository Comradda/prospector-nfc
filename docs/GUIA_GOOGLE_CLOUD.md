# Guía de Configuración: Google Cloud Platform & Despliegue en Cloudflare Pages

Esta guía detalla cómo configurar las APIs oficiales de Google Maps Platform, proteger tu cuenta para que **siempre opere dentro del nivel gratuito sin cobros**, y publicar la web en **Cloudflare Pages** (100% gratuito).

---

## 1. Crear tu Proyecto en Google Cloud y Vincular Facturación

Google Cloud requiere registrar una tarjeta de crédito o débito para activar las APIs de Maps, pero **otorga una cuota mensual gratuita recurrente**:
- **Places API (New):** Permite aproximadamente 1,000 búsquedas gratuitas al mes (cada una devuelve hasta 20 negocios).
- **Routes API:** Permite miles de cálculos de ruta y transporte al mes dentro del crédito gratuito.
- **URL Navigation de Google Maps:** Es 100% gratuita e ilimitada (abrir rutas y paradas directamente en la app nativa de Maps no consume crédito de API).

### Pasos:
1. Entra a [Google Cloud Console](https://console.cloud.google.com/).
2. Inicia sesión con tu cuenta de Google.
3. Arriba a la izquierda, haz clic en el selector de proyectos y luego en **"Nuevo proyecto"**.
4. Nómbralo: `Prospector NFC` y haz clic en **Crear**.
5. Ve al menú lateral ☰ → **Facturación (Billing)** y vincula tu cuenta de facturación.

---

## 2. Protección Anti-Cobros: Presupuesto y Alertas a $0 USD

Para garantizar que nunca te llegue un cobro imprevisto:
1. En Google Cloud Console, ve a ☰ → **Facturación** → **Presupuestos y alertas** (Budgets & alerts).
2. Haz clic en **"Crear presupuesto"**.
3. En alcance, selecciona tu proyecto `Prospector NFC`.
4. En monto del presupuesto, define: **$100 MXN** (o **$5 USD**).
5. En reglas de alerta:
   - 50% ($50 MXN)
   - 90% ($90 MXN)
   - 100% ($100 MXN)
6. Activa la casilla para que te envíe notificaciones inmediatas por correo si el consumo se acerca al límite.

Adicionalmente, nuestro backend en Cloudflare incluye un **limitador de seguridad diario** (`DAILY_LIMIT=60`) que bloquea automáticamente consultas excesivas antes de que alcancen cuotas críticas.

---

## 3. Habilitar las APIs Necesarias

Ve a ☰ → **APIs y servicios** → **Biblioteca** (Library) y habilita las siguientes APIs:
1. **Places API (New)** *(Importante: debe ser la versión "New", no la legacy)*.
2. **Routes API** *(Para cálculo de rutas en transporte público y a pie)*.
3. *(Opcional)* **Maps JavaScript API** *(Solo si deseas visualizar el mapa interactivo en pantalla; si no la activas, la app funciona perfectamente con la lista y los enlaces a Google Maps)*.

---

## 4. Crear y Restringir las API Keys (Llaves de Acceso)

Para máxima seguridad, crearemos dos llaves distintas:

### Llave 1: Servidor Backend (`GOOGLE_PLACES_KEY`)
Esta llave **nunca se expone al público** ni al navegador; se guarda como variable de entorno secreta en Cloudflare Pages.
1. Ve a ☰ → **APIs y servicios** → **Credenciales**.
2. Haz clic en **+ Crear credenciales** → **Clave de API** (API Key).
3. Nómbrala: `Prospector Server Key`.
4. En **Restricciones de API**:
   - Selecciona **"Restringir clave"**.
   - Marca únicamente: **Places API (New)** y **Routes API**.
5. Guarda la clave. Ésta será tu valor para `GOOGLE_PLACES_KEY`.

### Llave 2 (Opcional): Navegador / Mapa (`GOOGLE_MAPS_BROWSER_KEY`)
Esta llave solo se usa si quieres mostrar el mapa interactivo en la pestaña "Mapa".
1. En **Credenciales**, crea otra Clave de API.
2. Nómbrala: `Prospector Browser Maps Key`.
3. En **Restricciones de aplicaciones**:
   - Selecciona **"Sitios web" (HTTP referrers)**.
   - Agrega tu dominio de Cloudflare Pages (ejemplo: `https://nfc-prospector.pages.dev/*`) y para pruebas locales: `http://localhost:*`.
4. En **Restricciones de API**:
   - Marca únicamente: **Maps JavaScript API**.
5. Ésta será tu valor para `GOOGLE_MAPS_BROWSER_KEY`.

---

## 5. Probar Localmente en tu Máquina

1. En la carpeta `c:\Users\Victo\pulso-ops\nfc-prospector`:
2. Crea el archivo `.dev.vars` (copiando `.dev.vars.example`):
   ```env
   GOOGLE_PLACES_KEY=AIzaSy...TuClaveDeServidor...
   GOOGLE_MAPS_BROWSER_KEY=AIzaSy...TuClaveDeNavegador...
   ACCESS_CODE=mi-codigo-secreto-2026
   DAILY_LIMIT=60
   ```
3. Ejecuta el servidor local:
   ```bash
   npx wrangler pages dev public --port 8788
   ```
4. Abre `http://localhost:8788` en tu navegador o desde el navegador de tu celular (en la misma red WiFi).

---

## 6. Despliegue Gratuito en Cloudflare Pages

Cloudflare Pages ofrece hosting gratuito ultra-rápido con soporte nativo para Pages Functions (`functions/`):

### Opción A: Mediante Conexión con GitHub (Recomendada)
1. Sube la carpeta `nfc-prospector` a un nuevo repositorio en tu cuenta de GitHub (ejemplo: `tu-usuario/nfc-prospector`).
2. Entra a tu panel de [Cloudflare Dashboard](https://dash.cloudflare.com/).
3. En el menú lateral, ve a **Workers & Pages** → **Crear aplicación** → pestaña **Pages** → **Conectar a Git**.
4. Selecciona tu repositorio `nfc-prospector`.
5. En la configuración de compilación:
   - **Framework preset:** `None`
   - **Build command:** (dejar vacío)
   - **Build output directory:** `public`
6. En **Variables de entorno (Environment variables)**, agrega:
   - `GOOGLE_PLACES_KEY`: Tu clave de servidor de Google.
   - `GOOGLE_MAPS_BROWSER_KEY`: Tu clave de navegador (opcional).
   - `ACCESS_CODE`: El código que tus vendedores deberán ingresar en la app.
   - `DAILY_LIMIT`: `60`
7. Haz clic en **Guardar e implementar**.
8. ¡Listo! Cloudflare te entregará una URL pública segura (ej: `https://nfc-prospector.pages.dev`) con HTTPS automático.

---

## 7. Cómo Grabar las Tarjetas con NFC Tools

1. Abre la app web en tu celular.
2. Busca comercios cercanos y selecciona el que vas a visitar.
3. En el detalle del comercio, presiona el botón gigante verde: **"📋 Copiar link de reseña"**.
   - El enlace copiado tiene el formato oficial:
     `https://search.google.com/local/writereview?placeid=ChIJ...`
4. Abre la app **NFC Tools** en tu celular (disponible gratis en Android e iOS):
   - Ve a la pestaña **Escribir** (Write).
   - Selecciona **Añadir un registro** → **URL / Enlace**.
   - Pega el enlace copiado.
   - Toca **Escribir** y acerca tu tarjeta NFC al teléfono.
5. Al acercar la tarjeta a cualquier celular, se abrirá instantáneamente la ventana oficial de Google Maps con las 5 estrellas listas para calificar al negocio.
