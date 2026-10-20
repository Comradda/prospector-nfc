/**
 * Prospector NFC · Controlador Principal de la Interfaz Minimalista
 * Orquesta la búsqueda en tiempo real, priorización por necesidad de reseñas,
 * detección de plazas pequeñas, extracción del Place ID (ChIJ...) para NFC Tools,
 * mapa interactivo y optimización de rutas 2-opt.
 */

import {
  obtenerConfiguracion,
  validarAcceso,
  obtenerCodigoGuardado,
  buscarProspectos,
  obtenerRuta,
  suscribirErrorAutenticacion
} from './api.js';

import { puntuar, distanciaMetros } from './scoring.js';
import {
  ordenarRuta,
  urlComoLlegar,
  urlsRutaCompleta,
  linkResena,
  extraerPlaceId,
  duracionTexto,
  distanciaTexto
} from './ruta.js';

import {
  inicializarMapa,
  refrescarTamanoMapa,
  centrarEn,
  pintarLugaresEnMapa,
  pintarUbicacionUsuario,
  pintarTrazoRutaEnMapa
} from './mapa.js';

/* ───────────────────────────── Iconos SVG ───────────────────────────── */

const ICONOS = {
  copy: `<svg class="icon icon-sm" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  plus: `<svg class="icon icon-sm" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  navigation: `<svg class="icon icon-sm" viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`,
  external: `<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  radar: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`,
  nfc: `<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M6 8v8"/><circle cx="10" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M13.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M16.5 7a7 7 0 0 1 0 10"/></svg>`,
  camera: `<svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  chart: `<svg class="icon icon-sm" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
};

/* ───────────────────────────── Estado Global ───────────────────────────── */

const estado = {
  config: null,
  ubicacion: null, // { lat, lng }
  radio: 800,
  giros: new Set([
    'restaurantes',
    'cafeterias',
    'barberias',
    'esteticas',
    'comida_rapida',
    'consultorios'
  ]),
  lugaresPuntuados: [],
  filtroPrioridad: 'alta_media', // 'alta_media' | 'todos'
  filtroSoloPlazas: false,
  paradasRuta: [],
  bitacoraVisitas: {}, // { [placeId]: { estado: 'vendido'|'interesado'|'no', fecha: string } }
  modoRutaGlobal: 'walking', // 'walking' | 'transit' | 'driving'
  lugarActivo: null,
  tabActivo: 'buscar'
};

/* ───────────────────────────── Inicialización ───────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  cargarEstadoPersistido();
  inicializarPWA();
  configurarEventosUI();

  suscribirErrorAutenticacion(() => {
    mostrarModalAcceso(true);
  });

  // Inicializar el mapa interactivo para que esté listo al cambiar de pestaña
  const mapEl = document.getElementById('mapaContainer');
  if (mapEl) {
    inicializarMapa(mapEl, estado.ubicacion || { lat: 19.4326, lng: -99.1332 });
  }

  try {
    estado.config = await obtenerConfiguracion();
    actualizarCatalogoGirosUI();

    if (estado.config?.requiereCodigo && !obtenerCodigoGuardado()) {
      mostrarModalAcceso(true);
    }
  } catch (err) {
    console.error('Error cargando configuración:', err);
  }

  // Restaurar última búsqueda de la sesión solo si contiene Place IDs reales (ChIJ...)
  const guardados = sessionStorage.getItem('prospector_ultimos_lugares');
  const guardadaUbicacion = sessionStorage.getItem('prospector_ubicacion');
  if (guardados && guardadaUbicacion) {
    try {
      const lugares = JSON.parse(guardados);
      if (Array.isArray(lugares) && lugares.length > 0 && String(lugares[0].placeId || '').startsWith('ChIJ')) {
        estado.ubicacion = JSON.parse(guardadaUbicacion);
        procesarYMostrarLugares(lugares);
        actualizarIndicadorGps('Ubicación activa', true);
      } else {
        sessionStorage.removeItem('prospector_ultimos_lugares');
      }
    } catch {}
  }
});

/* ───────────────────────────── Persistencia Local ───────────────────────────── */

function cargarEstadoPersistido() {
  try {
    const rGuardada = localStorage.getItem('prospector_ruta');
    if (rGuardada) estado.paradasRuta = JSON.parse(rGuardada);

    const bGuardada = localStorage.getItem('prospector_visitas');
    if (bGuardada) estado.bitacoraVisitas = JSON.parse(bGuardada);

    const gGuardados = localStorage.getItem('prospector_giros');
    if (gGuardados) {
      const arr = JSON.parse(gGuardados);
      if (Array.isArray(arr) && arr.length > 0) estado.giros = new Set(arr);
    }

    actualizarBadgeRuta();
  } catch (e) {
    console.warn('Error leyendo almacenamiento local:', e);
  }
}

function guardarRutaPersistida() {
  localStorage.setItem('prospector_ruta', JSON.stringify(estado.paradasRuta));
  localStorage.setItem('prospector_visitas', JSON.stringify(estado.bitacoraVisitas));
  actualizarBadgeRuta();
  pintarTrazoRutaEnMapa(estado.ubicacion, estado.paradasRuta);
}

/* ───────────────────────────── Navegación de Vistas ───────────────────────────── */

async function cambiarTab(nuevoTab) {
  estado.tabActivo = nuevoTab;

  document.querySelectorAll('.view-section').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav-tab-btn').forEach((b) => b.classList.remove('active'));

  const sec = document.getElementById(`view-${nuevoTab}`);
  const btn = document.getElementById(`tabBtn-${nuevoTab}`);
  if (sec) sec.classList.add('active');
  if (btn) btn.classList.add('active');

  if (nuevoTab === 'ruta') {
    renderizarVistaRuta();
  } else if (nuevoTab === 'mapa') {
    const mapEl = document.getElementById('mapaContainer');
    await inicializarMapa(mapEl, estado.ubicacion || { lat: 19.4326, lng: -99.1332 });
    refrescarTamanoMapa();
    if (estado.ubicacion) {
      pintarUbicacionUsuario(estado.ubicacion, estado.radio);
    }
    if (estado.lugaresPuntuados.length > 0) {
      pintarLugaresEnMapa(estado.lugaresPuntuados, (l) => abrirDetalleLugar(l));
    }
    pintarTrazoRutaEnMapa(estado.ubicacion, estado.paradasRuta);
  }
}

function configurarEventosUI() {
  document.getElementById('tabBtn-buscar')?.addEventListener('click', () => cambiarTab('buscar'));
  document.getElementById('tabBtn-mapa')?.addEventListener('click', () => cambiarTab('mapa'));
  document.getElementById('tabBtn-ruta')?.addEventListener('click', () => cambiarTab('ruta'));

  document.getElementById('btnBuscarGps')?.addEventListener('click', iniciarBusquedaConGps);

  // Botón centrar mapa en ubicación del vendedor
  document.getElementById('btnCentrarMapa')?.addEventListener('click', () => {
    if (estado.ubicacion) {
      centrarEn(estado.ubicacion.lat, estado.ubicacion.lng, 16);
    } else {
      iniciarBusquedaConGps();
    }
  });

  // Selector de radio
  document.querySelectorAll('.chip-radio').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip-radio').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      estado.radio = parseInt(btn.dataset.radio, 10) || 800;
      const lbl = document.getElementById('radioActivoLabel');
      if (lbl) lbl.textContent = btn.textContent;
      if (estado.ubicacion) {
        pintarUbicacionUsuario(estado.ubicacion, estado.radio);
      }
      if (estado.lugaresPuntuados.length > 0) {
        filtrarYRenderizarLista();
      }
    });
  });

  // Filtros de lista
  document.getElementById('btnFiltroPrioridad')?.addEventListener('click', () => {
    estado.filtroPrioridad = 'alta_media';
    actualizarBotonesFiltro();
    filtrarYRenderizarLista();
  });

  document.getElementById('btnFiltroTodos')?.addEventListener('click', () => {
    estado.filtroPrioridad = 'todos';
    actualizarBotonesFiltro();
    filtrarYRenderizarLista();
  });

  document.getElementById('btnTogglePlaza')?.addEventListener('click', () => {
    estado.filtroSoloPlazas = !estado.filtroSoloPlazas;
    document.getElementById('btnTogglePlaza')?.classList.toggle('active', estado.filtroSoloPlazas);
    filtrarYRenderizarLista();
  });

  // Modo de transporte en vista Ruta
  document.querySelectorAll('#rutaModoSelector .travel-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('#rutaModoSelector .travel-mode-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      estado.modoRutaGlobal = btn.dataset.modo || 'walking';
    });
  });

  // Cerrar hoja de detalle
  document.getElementById('sheetOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'sheetOverlay' || e.target.classList.contains('sheet-drag-handle')) {
      cerrarDetalleLugar();
    }
  });
  document.getElementById('btnCerrarSheet')?.addEventListener('click', cerrarDetalleLugar);

  // Cerrar con tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && estado.lugarActivo) cerrarDetalleLugar();
  });

  // Modal de acceso
  document.getElementById('btnGuardarPin')?.addEventListener('click', async () => {
    const input = document.getElementById('inputPinAcceso');
    const pin = (input?.value || '').trim();
    if (!pin) return;

    try {
      await validarAcceso(pin);
      mostrarModalAcceso(false);
      mostrarToast('Acceso verificado');
    } catch (err) {
      alert(err.message || 'Código incorrecto');
    }
  });
}

function actualizarBotonesFiltro() {
  const pBtn = document.getElementById('btnFiltroPrioridad');
  const tBtn = document.getElementById('btnFiltroTodos');
  if (pBtn && tBtn) {
    pBtn.classList.toggle('active', estado.filtroPrioridad === 'alta_media');
    tBtn.classList.toggle('active', estado.filtroPrioridad === 'todos');
  }
}

function actualizarCatalogoGirosUI() {
  const cont = document.getElementById('girosChipsContainer');
  if (!cont) return;

  const catalogo =
    Array.isArray(estado.config?.giros) && estado.config.giros.length > 0
      ? estado.config.giros
      : [
          { clave: 'restaurantes', etiqueta: 'Restaurantes' },
          { clave: 'cafeterias', etiqueta: 'Cafeterías' },
          { clave: 'barberias', etiqueta: 'Barberías' },
          { clave: 'esteticas', etiqueta: 'Estéticas y salones' },
          { clave: 'comida_rapida', etiqueta: 'Taquerías y comida rápida' },
          { clave: 'consultorios', etiqueta: 'Consultorios y clínicas' }
        ];

  cont.innerHTML = '';

  for (const g of catalogo) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip-selectable ${estado.giros.has(g.clave) ? 'active' : ''}`;
    chip.textContent = g.etiqueta;
    chip.addEventListener('click', () => {
      if (estado.giros.has(g.clave)) {
        if (estado.giros.size > 1) {
          estado.giros.delete(g.clave);
          chip.classList.remove('active');
        } else {
          mostrarToast('Mantén al menos un giro activo');
        }
      } else {
        estado.giros.add(g.clave);
        chip.classList.add('active');
      }
      localStorage.setItem('prospector_giros', JSON.stringify([...estado.giros]));
      actualizarConteoConsultas();
    });
    cont.appendChild(chip);
  }
  actualizarConteoConsultas();
}

function actualizarConteoConsultas() {
  const infoEl = document.getElementById('queryUsageInfo');
  if (!infoEl) return;
  const cant = estado.giros.size;
  infoEl.textContent = `${cant} ${cant === 1 ? 'giro activo' : 'giros activos'}`;
}

/* ───────────────────────────── Geolocalización & Búsqueda ───────────────────────────── */

async function iniciarBusquedaConGps() {
  const btn = document.getElementById('btnBuscarGps');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Obteniendo coordenadas GPS...</span>`;
  }

  if (!navigator.geolocation) {
    alert('Tu navegador no permite geolocalización.');
    restaurarBotonBuscar();
    return;
  }

  actualizarIndicadorGps('Localizando...', false);

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      estado.ubicacion = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      sessionStorage.setItem('prospector_ubicacion', JSON.stringify(estado.ubicacion));
      actualizarIndicadorGps('Ubicación activa', true);

      if (btn) btn.innerHTML = `<span>Analizando comercios y reseñas...</span>`;
      mostrarSkeletons();

      try {
        const respuesta = await buscarProspectos({
          lat: estado.ubicacion.lat,
          lng: estado.ubicacion.lng,
          radio: estado.radio,
          giros: [...estado.giros]
        });

        sessionStorage.setItem('prospector_ultimos_lugares', JSON.stringify(respuesta.lugares));
        procesarYMostrarLugares(respuesta.lugares);
      } catch (err) {
        console.error('Error en búsqueda:', err);
        alert(err.message || 'No se pudieron consultar los comercios cercanos.');
      } finally {
        restaurarBotonBuscar();
      }
    },
    (err) => {
      console.warn('Error GPS:', err);
      actualizarIndicadorGps('Sin señal GPS', false);
      restaurarBotonBuscar();
      let msg = 'No se pudo obtener tu ubicación actual.';
      if (err.code === 1) {
        msg =
          'Permiso de ubicación denegado. Activa el permiso de ubicación en la barra de dirección de tu navegador.';
      }
      alert(msg);
    },
    { enableHighAccuracy: true, timeout: 14000, maximumAge: 30000 }
  );
}

function restaurarBotonBuscar() {
  const btn = document.getElementById('btnBuscarGps');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `${ICONOS.radar}<span>Escanear comercios cercanos</span>`;
  }
}

function actualizarIndicadorGps(texto, activo = false) {
  const chip = document.getElementById('gpsIndicator');
  const txt = document.getElementById('gpsIndicatorText');
  if (txt) txt.textContent = texto;
  if (chip) chip.classList.toggle('gps-on', Boolean(activo));
}

/* ───────────────────────────── Procesamiento & Renderizado ───────────────────────────── */

function procesarYMostrarLugares(lugaresBrutos) {
  estado.lugaresPuntuados = puntuar(lugaresBrutos, estado.ubicacion, { radio: estado.radio });

  if (estado.ubicacion) {
    pintarUbicacionUsuario(estado.ubicacion, estado.radio);
  }
  pintarLugaresEnMapa(estado.lugaresPuntuados, (l) => abrirDetalleLugar(l));
  pintarTrazoRutaEnMapa(estado.ubicacion, estado.paradasRuta);

  filtrarYRenderizarLista();
}

function filtrarYRenderizarLista() {
  const cont = document.getElementById('lugaresListaContainer');
  const summaryBar = document.getElementById('resultsSummaryBar');
  const countText = document.getElementById('resultsCountText');
  if (!cont) return;

  let filtrados = estado.lugaresPuntuados;

  if (estado.filtroPrioridad === 'alta_media') {
    filtrados = filtrados.filter((l) => l.prioridad === 'alta' || l.prioridad === 'media');
  }

  if (estado.filtroSoloPlazas) {
    filtrados = filtrados.filter((l) => l.plaza && l.plaza.tipo === 'chica');
  }

  if (summaryBar && countText) {
    summaryBar.style.display = estado.lugaresPuntuados.length > 0 ? 'flex' : 'none';
    countText.textContent = `${filtrados.length} de ${estado.lugaresPuntuados.length} comercios`;
  }

  if (filtrados.length === 0) {
    cont.innerHTML = `
      <div class="empty-state-box">
        <p class="empty-state-title">Sin comercios bajo este filtro</p>
        <p class="empty-state-desc">
          Cambia la vista a <strong>Todos los comercios</strong>, desactiva el filtro de plazas o amplía el radio de búsqueda.
        </p>
      </div>
    `;
    return;
  }

  cont.innerHTML = '';

  for (const l of filtrados) {
    const card = document.createElement('article');
    card.className = 'card-lugar';

    const prioTexto =
      l.prioridad === 'alta'
        ? `Alta · ${l.puntaje} pts`
        : l.prioridad === 'media'
        ? `Media · ${l.puntaje} pts`
        : `Baja · ${l.puntaje} pts`;

    const distTxt = l.distancia !== null ? distanciaTexto(l.distancia) : '';

    // Métrica 1: Reseñas
    const numResenas = typeof l.resenas === 'number' ? l.resenas : 0;
    const textoResenas =
      numResenas === 0
        ? 'Sin reseñas'
        : numResenas === 1
        ? '1 reseña'
        : `${numResenas.toLocaleString('es-MX')} reseñas`;
    const esUrgente = numResenas <= 15;

    // Métrica 2: Calificación
    const textoCalif =
      typeof l.calificacion === 'number' ? `${l.calificacion.toFixed(1)} / 5.0` : 'Sin calificar';

    // Métrica 3: Tipo de ubicación / Plaza
    const esPlazaChica = l.plaza && l.plaza.tipo === 'chica';
    const textoUbicacion = esPlazaChica
      ? `Plaza (${l.plaza.tamano} locales)`
      : l.plaza?.tipo === 'grande'
      ? 'Centro comercial'
      : 'Local en calle';

    const motivosHtml = (l.motivos || [])
      .slice(0, 3)
      .map((m) => `<span class="pill-motivo">${escapeHtml(m)}</span>`)
      .join('');

    const enRuta = estado.paradasRuta.some((p) => p.placeId === l.placeId);
    const placeIdLimpio = extraerPlaceId(l.placeId);
    const urlNfcDirecta = linkResena(placeIdLimpio);

    const fotoHtml = l.fotoUrl
      ? `<div class="card-thumb-wrap">
           <img src="${escapeHtml(l.fotoUrl)}" alt="${escapeHtml(l.nombre)}" class="card-thumb" loading="lazy" onerror="this.parentElement.style.display='none'" />
         </div>`
      : '';

    const trafico = l.traficoResenas || {
      dias7: 0,
      dias30: 0,
      dias90: 0,
      estadoFlujo: 'estancado',
      etiquetaFlujo: 'Sin reseñas'
    };
    const pillTrafico = `
      <span class="pill-traffic traffic-${escapeHtml(trafico.estadoFlujo)} tabular" title="Opiniones recientes estimadas">
        7d: ${trafico.dias7} · 30d: ${trafico.dias30} · 90d: ${trafico.dias90} (${escapeHtml(trafico.etiquetaFlujo)})
      </span>
    `;

    card.innerHTML = `
      <div class="card-top-meta">
        <div class="card-category-distance">
          <span>${escapeHtml(l.giro || 'Comercio')}</span>
          ${distTxt ? `<span class="meta-sep">·</span><span class="tabular">${escapeHtml(distTxt)}</span>` : ''}
        </div>
        <span class="badge-prioridad ${l.prioridad} tabular">${prioTexto}</span>
      </div>

      <div class="card-header-main" data-action="detalle">
        <div class="card-title-col">
          <h3 class="card-title">${escapeHtml(l.nombre)}</h3>
          <p class="card-address">${escapeHtml(l.direccionCorta || l.direccion)}</p>
        </div>
        ${fotoHtml}
      </div>

      <div class="card-metrics-strip tabular" data-action="detalle">
        <div class="metric-col">
          <span class="metric-label">Reseñas Google</span>
          <span class="metric-value ${esUrgente ? 'urgent' : ''}">${textoResenas}</span>
        </div>
        <div class="metric-col">
          <span class="metric-label">Calificación</span>
          <span class="metric-value">${textoCalif}</span>
        </div>
        <div class="metric-col">
          <span class="metric-label">Agrupación</span>
          <span class="metric-value ${esPlazaChica ? 'plaza-highlight' : ''}">${textoUbicacion}</span>
        </div>
      </div>

      <div class="badges-container">
        ${pillTrafico}
        ${esPlazaChica ? `<span class="badge-plaza-chica">Plaza comercial pequeña (${l.plaza.tamano} negocios)</span>` : ''}
        ${motivosHtml}
      </div>

      <div class="card-quick-actions">
        <button type="button" class="btn-card-action primary-nfc" data-action="copiar-nfc">
          ${ICONOS.copy}
          <span>Copiar link NFC</span>
        </button>
        <button type="button" class="btn-card-action ${enRuta ? 'in-route' : ''}" data-action="toggle-ruta">
          ${enRuta ? ICONOS.check : ICONOS.plus}
          <span>${enRuta ? 'En ruta' : 'Agregar a ruta'}</span>
        </button>
        <button type="button" class="btn-card-action" data-action="detalle">
          <span>Ficha</span>
        </button>
      </div>
    `;

    card.querySelectorAll('[data-action="detalle"]').forEach((el) => {
      el.addEventListener('click', () => abrirDetalleLugar(l));
    });

    card.querySelector('[data-action="copiar-nfc"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      copiarAlPortapapeles(urlNfcDirecta, 'Link writereview copiado para NFC Tools');
    });

    card.querySelector('[data-action="toggle-ruta"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLugarEnRuta(l);
      filtrarYRenderizarLista();
    });

    cont.appendChild(card);
  }
}

/* ───────────────────────────── Detalle (Bottom Sheet) ───────────────────────────── */

function abrirDetalleLugar(lugar) {
  estado.lugarActivo = lugar;
  const overlay = document.getElementById('sheetOverlay');
  const body = document.getElementById('sheetBody');
  if (!overlay || !body) return;

  const enRuta = estado.paradasRuta.some((p) => p.placeId === lugar.placeId);
  const placeIdReal = extraerPlaceId(lugar.placeId);
  const revLink = linkResena(placeIdReal);

  const numResenas = typeof lugar.resenas === 'number' ? lugar.resenas : 0;
  const califTxt =
    typeof lugar.calificacion === 'number' ? `${lugar.calificacion.toFixed(1)} / 5.0` : 'Sin calificación';

  const bannerFotoHtml = lugar.fotoUrl
    ? `
      <div class="sheet-photo-banner">
        <img src="${escapeHtml(lugar.fotoUrl)}" alt="${escapeHtml(lugar.nombre)}" class="sheet-photo-img" onerror="this.parentElement.style.display='none'" />
        <div class="sheet-photo-badge">
          ${ICONOS.camera}
          <span>Fachada en Google Maps</span>
        </div>
      </div>
    `
    : '';

  const trafico = lugar.traficoResenas || {
    dias7: 0,
    dias30: 0,
    dias90: 0,
    estadoFlujo: 'estancado',
    etiquetaFlujo: 'Sin reseñas',
    velocidadMensual: '0 / mes',
    diagnosticoVenta: 'Perfil sin reseñas. Los clientes no están calificando en Google.'
  };

  const traficoBoxHtml = `
    <div class="review-traffic-box">
      <div class="traffic-header">
        <span class="traffic-title">
          ${ICONOS.chart}
          <span>Tráfico Reciente de Reseñas</span>
        </span>
        <span class="traffic-badge ${escapeHtml(trafico.estadoFlujo)}">${escapeHtml(trafico.etiquetaFlujo)}</span>
      </div>

      <div class="traffic-grid tabular">
        <div class="traffic-item">
          <span class="traffic-period">Últimos 7 días</span>
          <span class="traffic-count ${trafico.dias7 === 0 ? 'zero' : ''}">${trafico.dias7}</span>
          <span class="traffic-sub">${trafico.dias7 === 1 ? 'opinión' : 'opiniones'}</span>
        </div>
        <div class="traffic-item">
          <span class="traffic-period">Últimos 30 días</span>
          <span class="traffic-count ${trafico.dias30 === 0 ? 'zero' : ''}">${trafico.dias30}</span>
          <span class="traffic-sub">${trafico.dias30 === 1 ? 'opinión' : 'opiniones'}</span>
        </div>
        <div class="traffic-item">
          <span class="traffic-period">Últimos 90 días</span>
          <span class="traffic-count ${trafico.dias90 === 0 ? 'zero' : ''}">${trafico.dias90}</span>
          <span class="traffic-sub">${trafico.dias90 === 1 ? 'opinión' : 'opiniones'}</span>
        </div>
      </div>

      <p class="traffic-diagnosis">
        <strong>Argumento para venta:</strong> ${escapeHtml(trafico.diagnosticoVenta)} (ritmo: ${escapeHtml(trafico.velocidadMensual)})
      </p>
    </div>
  `;

  body.innerHTML = `
    ${bannerFotoHtml}

    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-top: 4px;">
      <div>
        <div style="font-size: 0.74rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary);">
          ${escapeHtml(lugar.giro)} ${lugar.distancia !== null ? `· A ${distanciaTexto(lugar.distancia)}` : ''}
        </div>
        <h2 style="font-size: 1.2rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; margin-top: 2px;">
          ${escapeHtml(lugar.nombre)}
        </h2>
      </div>
      <span class="badge-prioridad ${lugar.prioridad} tabular">Prioridad ${lugar.prioridad}</span>
    </div>

    <!-- Bloque NFC Tools -->
    <div class="nfc-action-box">
      <div class="nfc-box-header">
        <span class="nfc-action-title">
          ${ICONOS.nfc}
          <span>Enlace para NFC Tools</span>
        </span>
        <span class="placeid-tag mono">ID: ${escapeHtml(placeIdReal.slice(0, 14))}...</span>
      </div>

      <div class="nfc-url-preview mono" id="nfcUrlPreviewBox">
        https://search.google.com/local/writereview?placeid=<strong>${escapeHtml(placeIdReal)}</strong>
      </div>

      <div class="nfc-buttons-row">
        <button type="button" class="btn-copiar-nfc" id="btnCopiarReviewLink">
          ${ICONOS.copy}
          <span>Copiar link de reseña</span>
        </button>
        <button type="button" class="btn-secondary-copy mono" id="btnCopiarPlaceId">
          <span>Copiar Place ID</span>
        </button>
      </div>
    </div>

    ${traficoBoxHtml}

    <!-- Tabla de Datos Reales -->
    <div class="detail-list">
      <div class="detail-row">
        <span class="detail-row-label">Reseñas actuales</span>
        <span class="detail-row-val tabular"><strong>${numResenas} reseñas</strong> (${califTxt})</span>
      </div>

      <div class="detail-row">
        <span class="detail-row-label">Place ID oficial</span>
        <span class="detail-row-val mono" style="font-size: 0.78rem;">${escapeHtml(placeIdReal)}</span>
      </div>

      <div class="detail-row">
        <span class="detail-row-label">Teléfono público</span>
        <span class="detail-row-val">
          ${
            lugar.telefono
              ? `<a href="tel:${escapeHtml(lugar.telefonoIntl || lugar.telefono)}" class="detail-link tabular">${escapeHtml(lugar.telefono)}</a>`
              : '<span style="color: var(--text-muted);">No registrado en Maps</span>'
          }
        </span>
      </div>

      <div class="detail-row">
        <span class="detail-row-label">Sitio web</span>
        <span class="detail-row-val">
          ${
            lugar.web
              ? `<a href="${escapeHtml(lugar.web)}" target="_blank" rel="noopener noreferrer" class="detail-link">${escapeHtml(
                  lugar.web.replace(/^https?:\/\/(www\.)?/, '').slice(0, 32)
                )}</a>`
              : '<span style="color: var(--text-muted);">Sin sitio web</span>'
          }
        </span>
      </div>

      <div class="detail-row">
        <span class="detail-row-label">Dirección</span>
        <span class="detail-row-val" style="max-width: 65%;">${escapeHtml(lugar.direccion)}</span>
      </div>
    </div>

    <div class="info-disclaimer">
      Nota de privacidad: Google Maps no expone públicamente el nombre del propietario ni el correo personal de quien registró el anuncio.
    </div>

    <!-- Acciones de Navegación y Ruta -->
    <div class="sheet-actions-grid">
      <button type="button" class="btn-action-sheet highlight" id="btnComoLlegarSheet">
        ${ICONOS.navigation}
        <span>Cómo llegar</span>
      </button>

      <button type="button" class="btn-action-sheet" id="btnToggleRutaSheet">
        ${enRuta ? ICONOS.check : ICONOS.plus}
        <span>${enRuta ? 'Quitar de la ruta' : 'Agregar a mi ruta'}</span>
      </button>
    </div>

    <div style="margin-top: 8px;">
      <a href="${escapeHtml(lugar.mapsUrl)}" target="_blank" rel="noopener noreferrer" class="btn-action-sheet" style="width: 100%;">
        ${ICONOS.external}
        <span>Ver anuncio original en Google Maps</span>
      </a>
    </div>

    <div id="transitStepsContainer" style="display: none;"></div>
  `;

  document.getElementById('btnCopiarReviewLink')?.addEventListener('click', () => {
    copiarAlPortapapeles(revLink, 'Enlace writereview copiado para NFC Tools');
  });

  document.getElementById('btnCopiarPlaceId')?.addEventListener('click', () => {
    copiarAlPortapapeles(placeIdReal, `Place ID copiado: ${placeIdReal}`);
  });

  document.getElementById('btnToggleRutaSheet')?.addEventListener('click', () => {
    toggleLugarEnRuta(lugar);
    filtrarYRenderizarLista();
    abrirDetalleLugar(lugar);
  });

  document.getElementById('btnComoLlegarSheet')?.addEventListener('click', () => {
    desplegarComoLlegar(lugar, 'TRANSIT');
  });

  overlay.classList.add('open');
}

function cerrarDetalleLugar() {
  const overlay = document.getElementById('sheetOverlay');
  if (overlay) overlay.classList.remove('open');
  estado.lugarActivo = null;
}

/* ───────────────────────────── Cómo Llegar y Transporte ───────────────────────────── */

async function desplegarComoLlegar(lugar, modo = 'TRANSIT') {
  const cont = document.getElementById('transitStepsContainer');
  if (!cont) return;

  cont.style.display = 'block';
  cont.innerHTML = `
    <div class="transit-steps-box" style="text-align: center; padding: 18px;">
      <p style="font-size: 0.84rem; font-weight: 600; color: var(--text-secondary);">Calculando ruta de traslado...</p>
    </div>
  `;

  const modoUrl = modo === 'WALK' ? 'walking' : modo === 'DRIVE' ? 'driving' : 'transit';
  const urlMapsDirecto = urlComoLlegar(estado.ubicacion, lugar, modoUrl);

  if (!estado.ubicacion) {
    cont.innerHTML = `
      <div class="transit-steps-box">
        <p style="font-size: 0.83rem; color: var(--text-secondary);">Abre Google Maps para trazar la ruta desde tu posición actual:</p>
        <a href="${urlMapsDirecto}" target="_blank" rel="noopener noreferrer" class="btn-action-sheet highlight" style="margin-top: 10px; width: 100%;">
          ${ICONOS.navigation}
          <span>Abrir indicaciones en Google Maps</span>
        </a>
      </div>
    `;
    return;
  }

  try {
    const res = await obtenerRuta({
      origen: estado.ubicacion,
      destino: { placeId: lugar.placeId, lat: lugar.lat, lng: lugar.lng },
      modo
    });

    const duracion = duracionTexto(res.duracionSeg);
    const distancia = distanciaTexto(res.distanciaM);

    let pasosHtml = '';
    if (Array.isArray(res.pasos) && res.pasos.length > 0) {
      for (const p of res.pasos) {
        let detallePaso = escapeHtml(p.instruccion || 'Avanza hacia el destino');
        if (p.tipo === 'TRANSIT' && p.transporte) {
          const t = p.transporte;
          detallePaso = `
            <div>
              <span class="transit-line-chip" style="background-color: ${t.color}; color: ${t.colorTexto};">
                ${escapeHtml(t.lineaCorta || t.linea)}
              </span>
              <strong>${escapeHtml(t.vehiculoNombre || 'Transporte')} · ${escapeHtml(t.linea)}</strong> (${t.paradas} paradas)
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 3px;">
              Subir en <strong>${escapeHtml(t.desde)}</strong> → Bajar en <strong>${escapeHtml(t.hasta)}</strong>
            </div>
          `;
        }
        pasosHtml += `
          <div class="transit-step-item">
            <div style="flex: 1;">
              ${detallePaso}
              <div class="tabular" style="font-size: 0.74rem; color: var(--text-tertiary); margin-top: 2px;">
                ${duracionTexto(p.duracionSeg)} · ${distanciaTexto(p.distanciaM)}
              </div>
            </div>
          </div>
        `;
      }
    } else {
      const modoEtiqueta =
        modo === 'WALK' ? 'caminando' : modo === 'DRIVE' ? 'en automóvil' : 'en transporte público';
      pasosHtml = `
        <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 10px;">
          Distancia estimada de <strong>${distancia}</strong> (~${duracion} ${modoEtiqueta}). Presiona el botón inferior para ver las líneas de transporte público o indicaciones paso a paso en Google Maps.
        </p>
      `;
    }

    cont.innerHTML = `
      <div class="transit-steps-box">
        <div class="travel-mode-tabs">
          <button type="button" class="travel-mode-btn ${modo === 'TRANSIT' ? 'active' : ''}" data-modo-sheet="TRANSIT">Transporte público</button>
          <button type="button" class="travel-mode-btn ${modo === 'WALK' ? 'active' : ''}" data-modo-sheet="WALK">A pie</button>
          <button type="button" class="travel-mode-btn ${modo === 'DRIVE' ? 'active' : ''}" data-modo-sheet="DRIVE">En auto</button>
        </div>

        <div class="tabular" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border-faint);">
          <span style="font-weight: 700; color: var(--text-primary); font-size: 0.92rem;">Tiempo estimado: ${duracion}</span>
          <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-secondary);">${distancia}</span>
        </div>

        ${pasosHtml}

        <a href="${urlMapsDirecto}" target="_blank" rel="noopener noreferrer" class="btn-action-sheet highlight" style="margin-top: 10px; width: 100%;">
          ${ICONOS.navigation}
          <span>Iniciar navegación en Google Maps</span>
        </a>
      </div>
    `;

    cont.querySelectorAll('[data-modo-sheet]').forEach((b) => {
      b.addEventListener('click', () => {
        desplegarComoLlegar(lugar, b.dataset.modoSheet);
      });
    });
  } catch (err) {
    cont.innerHTML = `
      <div class="transit-steps-box">
        <a href="${urlMapsDirecto}" target="_blank" rel="noopener noreferrer" class="btn-action-sheet highlight" style="width: 100%;">
          ${ICONOS.navigation}
          <span>Abrir ruta en Google Maps</span>
        </a>
      </div>
    `;
  }
}

/* ───────────────────────────── Armado y Gestión de Ruta ───────────────────────────── */

function toggleLugarEnRuta(lugar) {
  const index = estado.paradasRuta.findIndex((p) => p.placeId === lugar.placeId);
  if (index >= 0) {
    estado.paradasRuta.splice(index, 1);
    mostrarToast('Comercio quitado de la ruta');
  } else {
    estado.paradasRuta.push(lugar);
    mostrarToast('Comercio agregado a la ruta');
  }
  guardarRutaPersistida();
}

function actualizarBadgeRuta() {
  const badge = document.getElementById('badgeRutaCount');
  if (badge) {
    badge.textContent = estado.paradasRuta.length;
    badge.style.display = estado.paradasRuta.length > 0 ? 'inline-flex' : 'none';
  }
}

function renderizarVistaRuta() {
  const cont = document.getElementById('rutaParadasContainer');
  const btnMaps = document.getElementById('btnAbrirRutaCompletaMaps');
  if (!cont) return;

  if (estado.paradasRuta.length === 0) {
    cont.innerHTML = `
      <div class="empty-state-box">
        <p class="empty-state-title">No hay paradas en tu ruta</p>
        <p class="empty-state-desc">
          Agrega comercios desde la lista de prospectos para ordenarlos automáticamente por distancia y trazar tu recorrido.
        </p>
      </div>
    `;
    if (btnMaps) btnMaps.style.display = 'none';
    return;
  }

  // Optimizar orden mediante vecino más cercano + 2-opt
  const rutaOrdenada = ordenarRuta(estado.ubicacion, estado.paradasRuta);
  estado.paradasRuta = rutaOrdenada;
  guardarRutaPersistida();

  cont.innerHTML = '';

  let puntoAnterior = estado.ubicacion;

  rutaOrdenada.forEach((l, i) => {
    const card = document.createElement('div');
    card.className = 'route-stop-card';

    const distTramo =
      puntoAnterior && typeof l.lat === 'number'
        ? distanciaMetros(puntoAnterior, l)
        : null;
    puntoAnterior = l;

    const visita = estado.bitacoraVisitas[l.placeId];
    let estadoVisitaBadge = '';
    if (visita) {
      if (visita.estado === 'vendido') {
        estadoVisitaBadge = '<span class="visit-status-pill vendido">Tarjeta NFC vendida</span>';
      } else if (visita.estado === 'interesado') {
        estadoVisitaBadge = '<span class="visit-status-pill interesado">Seguimiento / Interesado</span>';
      } else if (visita.estado === 'no') {
        estadoVisitaBadge = '<span class="visit-status-pill no">No interesado</span>';
      }
    }

    const placeIdLimpio = extraerPlaceId(l.placeId);
    const linkNfc = linkResena(placeIdLimpio);

    card.innerHTML = `
      <div class="route-stop-number tabular">${i + 1}</div>
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
          <h4 style="font-size: 0.96rem; font-weight: 700; color: var(--text-primary);">${escapeHtml(l.nombre)}</h4>
          ${
            distTramo !== null && Number.isFinite(distTramo)
              ? `<span class="tabular" style="font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary);">+${distanciaTexto(distTramo)}</span>`
              : ''
          }
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 1px;">${escapeHtml(l.giro)} · ${escapeHtml(l.direccionCorta || l.direccion)}</p>
        ${estadoVisitaBadge}

        <div class="route-actions-row">
          <button type="button" class="btn-card-action primary-nfc" style="min-height: 32px; font-size: 0.74rem;" data-copiar="${escapeHtml(l.placeId)}">
            ${ICONOS.copy}
            <span>Copiar link NFC</span>
          </button>
          <button type="button" class="btn-card-action" style="min-height: 32px; font-size: 0.74rem;" data-ver="${escapeHtml(l.placeId)}">
            <span>Ficha y transporte</span>
          </button>
          <button type="button" class="btn-card-action" style="min-height: 32px; font-size: 0.74rem;" data-resultado="${escapeHtml(l.placeId)}">
            <span>Estado</span>
          </button>
        </div>
      </div>
    `;

    card.querySelector(`[data-copiar="${l.placeId}"]`)?.addEventListener('click', () => {
      copiarAlPortapapeles(linkNfc, 'Link writereview copiado');
    });
    card.querySelector(`[data-ver="${l.placeId}"]`)?.addEventListener('click', () => abrirDetalleLugar(l));
    card.querySelector(`[data-resultado="${l.placeId}"]`)?.addEventListener('click', () => registrarVisita(l));

    cont.appendChild(card);
  });

  if (btnMaps) {
    btnMaps.style.display = 'flex';
    btnMaps.onclick = () => {
      const urls = urlsRutaCompleta(estado.ubicacion, estado.paradasRuta, estado.modoRutaGlobal);
      if (urls.length > 0) {
        window.open(urls[0], '_blank', 'noopener');
      }
    };
  }

  const btnLimpiar = document.getElementById('btnLimpiarRuta');
  if (btnLimpiar) {
    btnLimpiar.onclick = () => {
      if (estado.paradasRuta.length === 0) return;
      if (confirm('¿Deseas vaciar todas las paradas de la ruta actual?')) {
        estado.paradasRuta = [];
        guardarRutaPersistida();
        renderizarVistaRuta();
        filtrarYRenderizarLista();
      }
    };
  }
}

function registrarVisita(lugar) {
  const actual = estado.bitacoraVisitas[lugar.placeId]?.estado || '';
  const siguiente =
    actual === '' ? 'vendido' : actual === 'vendido' ? 'interesado' : actual === 'interesado' ? 'no' : '';

  if (!siguiente) {
    delete estado.bitacoraVisitas[lugar.placeId];
    mostrarToast('Estado de visita reiniciado');
  } else {
    estado.bitacoraVisitas[lugar.placeId] = {
      estado: siguiente,
      fecha: new Date().toISOString()
    };
    const etiqueta =
      siguiente === 'vendido'
        ? 'Marcado como Vendido'
        : siguiente === 'interesado'
        ? 'Marcado como Interesado'
        : 'Marcado como No interesado';
    mostrarToast(etiqueta);
  }

  guardarRutaPersistida();
  renderizarVistaRuta();
}

/* ───────────────────────────── Utilidades ───────────────────────────── */

function mostrarModalAcceso(mostrar) {
  const m = document.getElementById('authModal');
  if (m) m.style.display = mostrar ? 'flex' : 'none';
}

function copiarAlPortapapeles(texto, mensajeToast) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(() => {
      mostrarToast(mensajeToast);
    });
  } else {
    const t = document.createElement('textarea');
    t.value = texto;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    document.body.removeChild(t);
    mostrarToast(mensajeToast);
  }
}

let toastTimer = null;
function mostrarToast(mensaje) {
  const toast = document.getElementById('appToast');
  if (!toast) return;
  toast.textContent = mensaje;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

function mostrarSkeletons() {
  const cont = document.getElementById('lugaresListaContainer');
  if (!cont) return;
  cont.innerHTML = `
    <div class="skeleton"></div>
    <div class="skeleton"></div>
    <div class="skeleton"></div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inicializarPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
