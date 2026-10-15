/**
 * Prospector NFC · Algoritmo de prioridad (módulo PURO).
 *
 * Sin DOM, sin fetch, sin globals de Cloudflare: corre igual en el navegador y en Node 24.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PESOS POR DEFECTO (sobrescribibles con `opts.pesos`, se normalizan a 100):
 *
 *   resenas      45  Necesidad de reseñas. 0 reseñas = 1 (máximo); decae de forma
 *                    logarítmica suave:  1 - log10(n + 1) / log10(301)  → ~0 con ≥300.
 *   calificacion 15  Sin calificación = 0.9 · <4.0 = 1 · 4.0–4.4 = 0.6 ·
 *                    4.5–4.6 = 0.35 · ≥4.7 = 0.1
 *   distancia    20  Lineal: 1 a 0 m → 0 en `opts.radio` (def. 1000 m) o más lejos.
 *                    Sin origen válido = 0.5 (neutro).
 *   plaza        15  Plaza chica = 1 · aislado = 0.4 · plaza grande / centro comercial = 0
 *   ficha         5  Ficha incompleta: sin web Y sin teléfono = 1 · falta uno = 0.5 · completa = 0
 *
 *   puntaje = round(100 · Σ(peso·necesidad) / Σ(peso))           (entero 0–100)
 *   CLOSED_TEMPORARILY → puntaje × 0.3 (`opts.factorCerradoTemporal`) y motivo "Cerrado temporalmente".
 *   CLOSED_PERMANENTLY → se excluye del resultado.
 *   prioridad: 'alta' ≥ 65 · 'media' ≥ 40 · 'baja' resto.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Todo es determinista: mismas entradas → mismo resultado y mismo orden.
 */

/** Radio medio de la Tierra en metros (IUGG). */
const RADIO_TIERRA_M = 6371008.8;

/** Pesos por defecto del puntaje. */
export const PESOS_DEFECTO = Object.freeze({
  resenas: 45,
  calificacion: 15,
  distancia: 20,
  plaza: 15,
  ficha: 5,
});

/** Necesidad asignada a cada tipo de plaza. */
const NECESIDAD_PLAZA = Object.freeze({ chica: 1, aislado: 0.4, grande: 0 });

/** Umbral (inclusive) a partir del cual una agrupación se considera plaza grande. */
const UMBRAL_GRANDE = 15;

/** Opciones por defecto. */
const OPCIONES_DEFECTO = Object.freeze({
  radio: 1000,
  radioCluster: 45,
  minPlaza: 3,
  factorCerradoTemporal: 0.3,
  maxMotivos: 4,
});

/* ───────────────────────────── utilidades ───────────────────────────── */

/** @param {unknown} v */
const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);

/** @param {any} p */
const esCoordenada = (p) =>
  !!p && esNumero(p.lat) && esNumero(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** @param {number} x @param {number} min @param {number} max */
const limitar = (x, min, max) => Math.min(max, Math.max(min, x));

/** Redondeo estable (evita 64.49999999 por ruido de punto flotante). */
const redondear = (x) => Math.round(Number(x.toFixed(6)));

/** Comparación de cadenas determinista (independiente del locale). */
const compararTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* ───────────────────────────── distancia ───────────────────────────── */

/**
 * Distancia en metros entre dos puntos sobre la esfera terrestre (fórmula de haversine).
 * @param {{lat:number,lng:number}} a
 * @param {{lat:number,lng:number}} b
 * @returns {number} metros (NaN si alguna coordenada es inválida)
 */
export function distanciaMetros(a, b) {
  if (!esCoordenada(a) || !esCoordenada(b)) return NaN;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* ───────────────────────────── plazas ───────────────────────────── */

/**
 * @typedef {Object} Plaza
 * @property {string|null} id      placeId de la plaza (containingPlaces), 'prox:<placeId>' si se
 *                                 detectó por cercanía, o null si el negocio está aislado.
 * @property {string|null} nombre  Nombre de la plaza si Google lo da; si no, null.
 * @property {number} tamano       Negocios DETECTADOS en los resultados (cota inferior: la plaza
 *                                 real puede tener más negocios que no salieron en la búsqueda).
 * @property {'chica'|'grande'|'aislado'} tipo
 */

/**
 * Agrupa negocios en plazas.
 *
 * 1) Señal principal: `lugar.contenidoEn` (containingPlaces de Google). Los negocios que comparten
 *    un lugar contenedor pertenecen a la misma plaza (nombre = nombre del contenedor). Si un negocio
 *    trae varios contenedores se usa el que agrupa más negocios del resultado (empate: el primero
 *    de su lista). Es 'grande' si el contenedor o algún miembro tiene `esCentroComercial`, o si el
 *    grupo tiene ≥ 15 negocios; si no, 'chica' (Google confirma que está dentro de un lugar).
 *    Un negocio cuyo `placeId` ES el contenedor (p. ej. la propia plaza) se asigna a ese grupo pero
 *    no cuenta en `tamano`.
 * 2) Señal secundaria (solo negocios sin `contenidoEn`): agrupamiento por cercanía de enlace simple
 *    (tipo DBSCAN con minPts=1): dos negocios a ≤ `opts.radioCluster` m (def. 45) quedan unidos,
 *    transitivamente. Componentes de ≥ `opts.minPlaza` (def. 3) negocios: 3–14 'chica', ≥15 'grande'
 *    (también 'grande' si algún miembro es centro comercial). Componentes menores → 'aislado'.
 *
 * @param {Array<Object>} lugares Lugares normalizados (ver CONTRATO.md).
 * @param {{radioCluster?:number, minPlaza?:number}} [opts]
 * @returns {Map<string, Plaza>} placeId → plaza (los miembros de una plaza comparten el objeto).
 */
export function detectarPlazas(lugares, opts = {}) {
  const radioCluster = esNumero(opts?.radioCluster) && opts.radioCluster >= 0
    ? opts.radioCluster
    : OPCIONES_DEFECTO.radioCluster;
  const minPlaza = esNumero(opts?.minPlaza) && opts.minPlaza >= 2
    ? Math.floor(opts.minPlaza)
    : OPCIONES_DEFECTO.minPlaza;

  /** @type {Map<string, Plaza>} */
  const resultado = new Map();
  if (!Array.isArray(lugares) || lugares.length === 0) return resultado;

  // Lugares únicos por placeId (primera aparición gana).
  const unicos = [];
  const vistos = new Set();
  for (const l of lugares) {
    if (!l || typeof l.placeId !== 'string' || !l.placeId || vistos.has(l.placeId)) continue;
    vistos.add(l.placeId);
    unicos.push(l);
  }
  const porId = new Map(unicos.map((l) => [l.placeId, l]));

  // ── 1) Agrupación por contenedor (containingPlaces) ──
  const contenedoresDe = (l) =>
    Array.isArray(l.contenidoEn)
      ? l.contenidoEn.filter((c) => c && typeof c.placeId === 'string' && c.placeId)
      : [];

  // Cuántos lugares menciona cada contenedor (para elegir el más representativo).
  const menciones = new Map();
  for (const l of unicos) {
    for (const c of new Set(contenedoresDe(l).map((c) => c.placeId))) {
      menciones.set(c, (menciones.get(c) || 0) + 1);
    }
  }

  /** contenedorId → {info, miembros:[lugar], centro:boolean} */
  const grupos = new Map();
  const asignados = new Set();
  for (const l of unicos) {
    const conts = contenedoresDe(l);
    if (conts.length === 0) continue;
    let elegido = conts[0];
    for (const c of conts) {
      if ((menciones.get(c.placeId) || 0) > (menciones.get(elegido.placeId) || 0)) elegido = c;
    }
    let g = grupos.get(elegido.placeId);
    if (!g) {
      g = { id: elegido.placeId, nombre: null, miembros: [], centro: false };
      grupos.set(elegido.placeId, g);
    }
    if (!g.nombre && typeof elegido.nombre === 'string' && elegido.nombre.trim()) {
      g.nombre = elegido.nombre.trim();
    }
    if (elegido.esCentroComercial === true) g.centro = true;
    g.miembros.push(l);
    asignados.add(l.placeId);
  }

  // El propio contenedor puede venir como lugar (p. ej. la plaza o el mall en sí).
  for (const g of grupos.values()) {
    const propio = porId.get(g.id);
    if (!propio) continue;
    if (propio.esCentroComercial === true) g.centro = true;
    if (!g.nombre && typeof propio.nombre === 'string' && propio.nombre.trim()) {
      g.nombre = propio.nombre.trim();
    }
  }

  for (const g of grupos.values()) {
    const miembrosReales = g.miembros.filter((m) => m.placeId !== g.id);
    if (miembrosReales.some((m) => m.esCentroComercial === true)) g.centro = true;
    const tamano = miembrosReales.length;
    /** @type {Plaza} */
    const plaza = {
      id: g.id,
      nombre: g.nombre,
      tamano,
      tipo: g.centro || tamano >= UMBRAL_GRANDE ? 'grande' : 'chica',
    };
    for (const m of g.miembros) resultado.set(m.placeId, plaza);
    // Si el contenedor también vino como lugar sin contenidoEn propio, pertenece a su plaza.
    const propio = porId.get(g.id);
    if (propio && !asignados.has(propio.placeId)) {
      resultado.set(propio.placeId, plaza);
      asignados.add(propio.placeId);
    }
  }

  // ── 2) Agrupación por cercanía para el resto ──
  const resto = unicos.filter((l) => !asignados.has(l.placeId));
  const conCoord = resto.filter(esCoordenada);
  const sinCoord = resto.filter((l) => !esCoordenada(l));

  // Union-find sobre índices de `conCoord`.
  const padre = conCoord.map((_, i) => i);
  const raiz = (i) => {
    while (padre[i] !== i) {
      padre[i] = padre[padre[i]];
      i = padre[i];
    }
    return i;
  };
  for (let i = 0; i < conCoord.length; i++) {
    for (let j = i + 1; j < conCoord.length; j++) {
      if (distanciaMetros(conCoord[i], conCoord[j]) <= radioCluster) {
        const ri = raiz(i);
        const rj = raiz(j);
        if (ri !== rj) padre[Math.max(ri, rj)] = Math.min(ri, rj);
      }
    }
  }
  const componentes = new Map();
  conCoord.forEach((l, i) => {
    const r = raiz(i);
    if (!componentes.has(r)) componentes.set(r, []);
    componentes.get(r).push(l);
  });

  for (const miembros of componentes.values()) {
    const tamano = miembros.length;
    if (tamano >= minPlaza) {
      const ancla = miembros.map((m) => m.placeId).sort(compararTexto)[0];
      const centro = miembros.some((m) => m.esCentroComercial === true);
      /** @type {Plaza} */
      const plaza = {
        id: `prox:${ancla}`,
        nombre: null,
        tamano,
        tipo: centro || tamano >= UMBRAL_GRANDE ? 'grande' : 'chica',
      };
      for (const m of miembros) resultado.set(m.placeId, plaza);
    } else {
      for (const m of miembros) {
        resultado.set(m.placeId, { id: null, nombre: null, tamano, tipo: 'aislado' });
      }
    }
  }
  for (const l of sinCoord) {
    resultado.set(l.placeId, { id: null, nombre: null, tamano: 1, tipo: 'aislado' });
  }

  return resultado;
}

/* ───────────────────────────── necesidades ───────────────────────────── */

/**
 * Necesidad por número de reseñas (0..1). 0 reseñas = 1; ≥300 ≈ 0.
 * @param {number} n
 */
function necesidadResenas(n) {
  return limitar(1 - Math.log10(n + 1) / Math.log10(301), 0, 1);
}

/**
 * Necesidad por calificación (0..1).
 * @param {number|null} r
 */
function necesidadCalificacion(r) {
  if (!esNumero(r) || r <= 0) return 0.9;
  if (r < 4.0) return 1;
  if (r < 4.5) return 0.6;
  if (r < 4.7) return 0.35;
  return 0.1;
}

/** @param {any} v */
const tieneTexto = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Normaliza los pesos recibidos (solo números finitos ≥ 0 sobrescriben).
 * @param {Partial<typeof PESOS_DEFECTO>} [pesos]
 */
function resolverPesos(pesos) {
  const out = { ...PESOS_DEFECTO };
  if (pesos && typeof pesos === 'object') {
    for (const k of Object.keys(PESOS_DEFECTO)) {
      if (esNumero(pesos[k]) && pesos[k] >= 0) out[k] = pesos[k];
    }
  }
  return out;
}

/** Texto corto de distancia para motivos: "A 250 m", "A 1.2 km". */
function textoDistanciaMotivo(m) {
  if (m < 10) return 'A menos de 10 m';
  const r10 = Math.round(m / 10) * 10;
  if (r10 < 1000) return `A ${r10} m`;
  const km = Math.round(m / 100) / 10;
  return `A ${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/* ───────────────────────────── puntuar ───────────────────────────── */

/**
 * Puntúa y ordena lugares según cuánto necesitan reseñas (y lo práctico que es visitarlos).
 *
 * No muta la entrada: devuelve un arreglo NUEVO con copias superficiales enriquecidas con
 * `distancia` (m, entero o null si no hay origen), `plaza`, `puntaje` (0–100 entero),
 * `prioridad` ('alta'|'media'|'baja') y `motivos` (≤ 4 textos cortos, el más importante primero).
 * Orden: puntaje desc, luego distancia asc, luego placeId asc (determinista).
 *
 * @param {Array<Object>} lugares
 * @param {{lat:number,lng:number}|null} origen
 * @param {{radio?:number, pesos?:Partial<typeof PESOS_DEFECTO>, radioCluster?:number,
 *          minPlaza?:number, factorCerradoTemporal?:number, maxMotivos?:number}} [opts]
 * @returns {Array<Object>}
 */
export function puntuar(lugares, origen, opts = {}) {
  if (!Array.isArray(lugares)) return [];
  const o = opts || {};
  const radio = esNumero(o.radio) && o.radio > 0 ? o.radio : OPCIONES_DEFECTO.radio;
  const factorCerrado = esNumero(o.factorCerradoTemporal)
    ? limitar(o.factorCerradoTemporal, 0, 1)
    : OPCIONES_DEFECTO.factorCerradoTemporal;
  const maxMotivos = esNumero(o.maxMotivos) && o.maxMotivos >= 0
    ? Math.floor(o.maxMotivos)
    : OPCIONES_DEFECTO.maxMotivos;
  const pesos = resolverPesos(o.pesos);
  const sumaPesos = Object.values(pesos).reduce((a, b) => a + b, 0);
  const origenValido = esCoordenada(origen);

  // Los cerrados definitivamente no son prospectos ni cuentan para detectar plazas.
  const vigentes = lugares.filter((l) => l && l.estado !== 'CLOSED_PERMANENTLY');
  const plazas = detectarPlazas(vigentes, o);

  const enriquecidos = vigentes.map((l) => {
    const resenas = esNumero(l.resenas) && l.resenas > 0 ? Math.floor(l.resenas) : 0;
    const calificacion = esNumero(l.calificacion) && l.calificacion > 0 ? l.calificacion : null;
    const dist = origenValido && esCoordenada(l) ? distanciaMetros(origen, l) : null;
    const plazaBase = plazas.get(l.placeId) || { id: null, nombre: null, tamano: 1, tipo: 'aislado' };
    const plaza = { ...plazaBase };
    const sinWeb = !tieneTexto(l.web);
    const sinTel = !tieneTexto(l.telefono) && !tieneTexto(l.telefonoIntl);

    const nec = {
      resenas: necesidadResenas(resenas),
      calificacion: necesidadCalificacion(calificacion),
      distancia: dist === null ? 0.5 : limitar(1 - dist / radio, 0, 1),
      plaza: NECESIDAD_PLAZA[plaza.tipo] ?? NECESIDAD_PLAZA.aislado,
      ficha: sinWeb && sinTel ? 1 : sinWeb || sinTel ? 0.5 : 0,
    };
    const aporte = {};
    let suma = 0;
    for (const k of Object.keys(pesos)) {
      aporte[k] = pesos[k] * nec[k];
      suma += aporte[k];
    }
    let base = sumaPesos > 0 ? (100 * suma) / sumaPesos : 0;
    const cerradoTemporal = l.estado === 'CLOSED_TEMPORARILY';
    if (cerradoTemporal) base *= factorCerrado;
    const puntaje = limitar(redondear(base), 0, 100);

    // ── Motivos: candidatos ordenados por su aporte al puntaje ──
    const candidatos = [];
    if (resenas === 0) candidatos.push({ t: 'Sin reseñas', a: aporte.resenas, o: 0 });
    else if (resenas <= 50) {
      candidatos.push({
        t: resenas === 1 ? 'Solo 1 reseña' : `Solo ${resenas} reseñas`,
        a: aporte.resenas,
        o: 0,
      });
    }
    if (calificacion !== null && calificacion < 4.5) {
      candidatos.push({ t: `Calificación ${calificacion.toFixed(1)}`, a: aporte.calificacion, o: 1 });
    }
    if (plaza.tipo === 'chica') {
      const t = plaza.tamano >= 2 ? `Plaza chica (${plaza.tamano} negocios)` : 'En plaza chica';
      candidatos.push({ t, a: aporte.plaza, o: 2 });
    }
    if (dist !== null) candidatos.push({ t: textoDistanciaMotivo(dist), a: aporte.distancia, o: 3 });
    if (sinWeb && sinTel) candidatos.push({ t: 'Sin web ni teléfono', a: aporte.ficha, o: 4 });
    else if (sinWeb) candidatos.push({ t: 'Sin sitio web', a: aporte.ficha, o: 4 });
    else if (sinTel) candidatos.push({ t: 'Sin teléfono', a: aporte.ficha, o: 4 });

    candidatos.sort((x, y) => y.a - x.a || x.o - y.o);
    const motivos = candidatos.map((c) => c.t);
    if (cerradoTemporal) motivos.unshift('Cerrado temporalmente');

    return {
      ...l,
      distancia: dist === null ? null : Math.round(dist),
      plaza,
      puntaje,
      prioridad: puntaje >= 65 ? 'alta' : puntaje >= 40 ? 'media' : 'baja',
      motivos: motivos.slice(0, maxMotivos),
    };
  });

  enriquecidos.sort((a, b) => {
    if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje;
    const da = a.distancia ?? Infinity;
    const db = b.distancia ?? Infinity;
    if (da !== db) return da - db;
    return compararTexto(String(a.placeId ?? ''), String(b.placeId ?? ''));
  });
  return enriquecidos;
}
