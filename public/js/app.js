/**
 * Prospector NFC · Controlador Principal de la Aplicación Móvil
 * Orquesta la búsqueda, puntuación de negocios, detección de plazas,
 * generación de links para NFC Tools, mapa interactivo y armado de rutas.
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
  duracionTexto,
  distanciaTexto
} from './ruta.js';

import {
  cargarGoogleMapsScript,
  inicializarMapa,
  pintarLugaresEnMapa,
  pintarUbicacionUsuario
} from './mapa.js';

/* ───────────────────────────── Estado Global ───────────────────────────── */

const estado = {
  config: null,
  ubicacion: null, // { lat, lng }
  radio: 800,
  giros: new Set(['restaurantes', 'cafeterias', 'barberias', 'esteticas', 'comida_rapida', 'consultorios']),
  lugaresPuntuados: [],
  filtroPrioridad: 'alta_media', // 'alta_media' | 'todos'
  filtroSoloPlazas: false,
  paradasRuta: [],
  bitacoraVisitas: {}, // { [placeId]: { estado: 'vendido'|'interesado'|'no', fecha: string } }
  lugarActivo: null,
  mapaListo: false,
  tabActivo: 'buscar'
};

/* ───────────────────────────── Inicialización ───────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  cargarEstadoPersistido();
  inicializarPWA();
  configurarEventosUI();

  // Escuchar errores 401 para desplegar modal de código
  suscribirErrorAutenticacion(() => {
    mostrarModalAcceso(true);
  });

  // Cargar configuración del servidor
  try {
    estado.config = await obtenerConfiguracion();
    actualizarCatalogoGirosUI();

    if (estado.config.requiereCodigo && !obtenerCodigoGuardado()) {
      mostrarModalAcceso(true);
    }

    // Inicializar Google Maps si hay API key de navegador disponible
    if (estado.config.mapsBrowserKey) {
      cargarGoogleMapsScript(estado.config.mapsBrowserKey).then((cargado) => {
        if (cargado) {
          const mapEl = document.getElementById('mapaContainer');
          if (mapEl) {
            inicializarMapa(mapEl, { lat: 19.4326, lng: -99.1332 });
            estado.mapaListo = true;
          }
        }
      });
    }
  } catch (err) {
    console.error('Error inicial:', err);
  }

  // Si hay resultados previos en sessionStorage, restaurarlos
  const guardados = sessionStorage.getItem('prospector_ultimos_lugares');
  const guardadaUbicacion = sessionStorage.getItem('prospector_ubicacion');
  if (guardados && guardadaUbicacion) {
    try {
      estado.ubicacion = JSON.parse(guardadaUbicacion);
      const lugares = JSON.parse(guardados);
      procesarYMostrarLugares(lugares);
      actualizarIndicadorGps('GPS Guardado');
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
    if (gGuardados) estado.giros = new Set(JSON.parse(gGuardados));

    actualizarBadgeRuta();
  } catch (e) {
    console.warn('Error leyendo localStorage:', e);
  }
}

function guardarRutaPersistida() {
  localStorage.setItem('prospector_ruta', JSON.stringify(estado.paradasRuta));
  localStorage.setItem('prospector_visitas', JSON.stringify(estado.bitacoraVisitas));
  actualizarBadgeRuta();
}

/* ───────────────────────────── UI & Tabs ───────────────────────────── */

function cambiarTab(nuevoTab) {
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
    if (estado.mapaListo && estado.lugaresPuntuados.length > 0) {
      pintarLugaresEnMapa(estado.lugaresPuntuados, (l) => abrirDetalleLugar(l));
    }
  }
}

function configurarEventosUI() {
  // Tabs inferiores
  document.getElementById('tabBtn-buscar')?.addEventListener('click', () => cambiarTab('buscar'));
  document.getElementById('tabBtn-mapa')?.addEventListener('click', () => cambiarTab('mapa'));
  document.getElementById('tabBtn-ruta')?.addEventListener('click', () => cambiarTab('ruta'));

  // Botón principal de búsqueda GPS
  document.getElementById('btnBuscarGps')?.addEventListener('click', iniciarBusquedaConGps);

  // Chips de radio
  document.querySelectorAll('.chip-radio').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip-radio').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      estado.radio = parseInt(btn.dataset.radio, 10) || 800;
      actualizarConteoConsultas();
    });
  });

  // Filtros de resultados
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

  // Cerrar bottom sheet
  document.getElementById('sheetOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'sheetOverlay' || e.target.classList.contains('sheet-drag-handle')) {
      cerrarDetalleLugar();
    }
  });

  // Modal de autenticación
  document.getElementById('btnGuardarPin')?.addEventListener('click', async () => {
    const input = document.getElementById('inputPinAcceso');
    const pin = (input?.value || '').trim();
    if (!pin) return;

    try {
      await validarAcceso(pin);
      mostrarModalAcceso(false);
      mostrarToast('Código verificado con éxito');
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
  if (!cont || !estado.config?.giros) return;

  cont.innerHTML = '';

  for (const g of estado.config.giros) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip-selectable ${estado.giros.has(g.clave) ? 'active' : ''}`;
    chip.textContent = `${g.emoji} ${g.etiqueta}`;
    chip.addEventListener('click', () => {
      if (estado.giros.has(g.clave)) {
        if (estado.giros.size > 1) {
          estado.giros.delete(g.clave);
          chip.classList.remove('active');
        } else {
          mostrarToast('Debes seleccionar al menos un giro');
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
  if (!estado.config?.tieneGoogleKey) {
    infoEl.textContent = `Búsqueda libre con OpenStreetMap (${cant} giro${cant === 1 ? '' : 's'} · 100% Gratuita e Ilimitada).`;
  } else {
    infoEl.textContent = `Esta búsqueda utilizará ${cant} consulta${cant === 1 ? '' : 's'} a Google Places.`;
  }
}

/* ───────────────────────────── Geolocalización & Búsqueda ───────────────────────────── */

async function iniciarBusquedaConGps() {
  const btn = document.getElementById('btnBuscarGps');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Obteniendo ubicación...</span>';
  }

  if (!navigator.geolocation) {
    alert('Tu dispositivo o navegador no soporta geolocalización.');
    restaurarBotonBuscar();
    return;
  }

  actualizarIndicadorGps('Localizando...');

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      estado.ubicacion = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      sessionStorage.setItem('prospector_ubicacion', JSON.stringify(estado.ubicacion));
      actualizarIndicadorGps('GPS Activo');

      if (btn) btn.innerHTML = '<span>Consultando negocios reales...</span>';
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

        if (Array.isArray(respuesta.avisos) && respuesta.avisos.length > 0) {
          mostrarToast(respuesta.avisos[0]);
        }
      } catch (err) {
        console.error('Error buscando lugares:', err);
        alert(err.message || 'No se pudieron consultar los lugares');
      } finally {
        restaurarBotonBuscar();
      }
    },
    (err) => {
      console.warn('Error GPS:', err);
      actualizarIndicadorGps('Sin GPS');
      restaurarBotonBuscar();
      let msg = 'No se pudo obtener tu ubicación.';
      if (err.code === 1) {
        msg =
          'Permiso de ubicación denegado. En iPhone o Android, ve a los ajustes de tu navegador y activa "Permitir ubicación precisa".';
      }
      alert(msg);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}

function restaurarBotonBuscar() {
  const btn = document.getElementById('btnBuscarGps');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<span>📍 Buscar cerca de mí</span>';
  }
}

function actualizarIndicadorGps(texto) {
  const el = document.getElementById('gpsIndicator');
  if (el) {
    el.textContent = texto;
    el.className = `chip-status ${texto.includes('Activo') ? 'gps-on' : ''}`;
  }
}

/* ───────────────────────────── Procesamiento & Scoring ───────────────────────────── */

function procesarYMostrarLugares(lugaresBrutos) {
  // Aplicar el algoritmo matemático puro de puntuación y detección de plazas
  estado.lugaresPuntuados = puntuar(lugaresBrutos, estado.ubicacion, { radio: estado.radio });

  // Actualizar mapa si está listo
  if (estado.mapaListo) {
    pintarLugaresEnMapa(estado.lugaresPuntuados, (l) => abrirDetalleLugar(l));
    pintarUbicacionUsuario(estado.ubicacion);
  }

  filtrarYRenderizarLista();
}

function filtrarYRenderizarLista() {
  const cont = document.getElementById('lugaresListaContainer');
  if (!cont) return;

  let filtrados = estado.lugaresPuntuados;

  if (estado.filtroPrioridad === 'alta_media') {
    filtrados = filtrados.filter((l) => l.prioridad === 'alta' || l.prioridad === 'media');
  }

  if (estado.filtroSoloPlazas) {
    filtrados = filtrados.filter((l) => l.plaza && l.plaza.tipo === 'chica');
  }

  if (filtrados.length === 0) {
    cont.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: var(--text-dim);">
        <p style="font-size: 2rem; margin-bottom: 8px;">🔍</p>
        <p style="font-weight: 700; color: var(--text-muted);">No hay prospectos con este filtro</p>
        <p style="font-size: 0.88rem; margin-top: 4px;">Prueba seleccionar "Todos" o ampliar el radio de búsqueda.</p>
      </div>
    `;
    return;
  }

  cont.innerHTML = '';

  for (const l of filtrados) {
    const card = document.createElement('div');
    card.className = 'card-lugar';

    const prioLabel = l.prioridad === 'alta' ? 'Alta' : l.prioridad === 'media' ? 'Media' : 'Baja';
    const prioClase = l.prioridad;

    let resenasTxt = `${l.resenas} reseñas`;
    let resenasAlertaClase = '';
    if (l.resenas === 0) {
      resenasTxt = '0 reseñas ¡URGE!';
      resenasAlertaClase = 'alerta';
    } else if (l.resenas <= 5) {
      resenasTxt = `Solo ${l.resenas} reseñas`;
      resenasAlertaClase = 'alerta';
    }

    const ratingTxt = l.calificacion ? `★ ${l.calificacion.toFixed(1)}` : '★ S/C';
    const distTxt = l.distancia !== null ? distanciaTexto(l.distancia) : '';

    let plazaBadgeHtml = '';
    if (l.plaza && l.plaza.tipo === 'chica') {
      const cant = l.plaza.tamano >= 2 ? `${l.plaza.tamano} negocios` : 'plaza';
      plazaBadgeHtml = `<span class="badge-plaza-chica">🏬 Plaza chica (${cant})</span>`;
    }

    const motivosHtml = (l.motivos || [])
      .slice(0, 3)
      .map((m) => `<span class="pill-motivo">${escapeHtml(m)}</span>`)
      .join('');

    card.innerHTML = `
      <div class="card-header-row">
        <div>
          <h3 class="card-title">${escapeHtml(l.nombre)}</h3>
          <p class="card-giro">${escapeHtml(l.giro)}</p>
        </div>
        <span class="badge-prioridad ${prioClase}">${prioLabel}</span>
      </div>

      <div class="resenas-highlight-row">
        <span class="star-rating">${ratingTxt}</span>
        <span class="reviews-count-badge ${resenasAlertaClase}">${resenasTxt}</span>
        <span class="distancia-text">${distTxt}</span>
      </div>

      <div class="badges-container">
        ${plazaBadgeHtml}
        ${motivosHtml}
      </div>
    `;

    card.addEventListener('click', () => abrirDetalleLugar(l));
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
  const esOSM = lugar.fuente === 'openstreetmap' || lugar.placeId?.startsWith('osm:');
  const revLink = esOSM ? (lugar.linkResena || lugar.mapsUrl) : linkResena(lugar.placeId);

  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
      <div>
        <h2 style="font-size: 1.25rem; font-weight: 800; color: #FFFFFF; line-height: 1.2;">${escapeHtml(lugar.nombre)}</h2>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(lugar.giro)} · ${lugar.direccionCorta || lugar.direccion}</p>
      </div>
      <span class="badge-prioridad ${lugar.prioridad}">${lugar.prioridad.toUpperCase()}</span>
    </div>

    <!-- Bloque Especial NFC Tools -->
    <div class="nfc-action-box">
      <div class="nfc-action-title">
        <span>📲 Configurar Tarjeta NFC</span>
      </div>
      <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">
        ${esOSM 
          ? 'Enlace universal de búsqueda en Google Maps. Al acercar la tarjeta NFC a cualquier iPhone o Android, abrirá directamente la ficha del comercio para calificar:'
          : 'Copia este enlace directo a la ventana de reseña de Google Maps y pégalo en la app <strong>NFC Tools</strong>:'}
      </p>
      <button type="button" class="btn-copiar-nfc" id="btnCopiarReviewLink">
        <span>📋 Copiar link para NFC Tools</span>
      </button>
      ${!esOSM ? `
      <div style="margin-top: 8px;">
        <button type="button" class="btn-secondary-copy" id="btnCopiarPlaceId">
          Copiar Place ID (${lugar.placeId.slice(0, 10)}...)
        </button>
      </div>` : ''}
    </div>

    <!-- Aviso Verídico de Google -->
    <div class="info-disclaimer">
      ℹ️ <strong>Transparencia:</strong> Por políticas de privacidad oficiales de Google Maps, el nombre y correo personal del creador de la ficha no son públicos. Solo se muestran los canales de contacto comerciales verificados.
    </div>

    <!-- Información de Contacto Real -->
    <div style="margin: 14px 0;">
      ${lugar.telefono ? `
        <div class="detail-row">
          <span class="detail-row-icon">📞</span>
          <a href="tel:${escapeHtml(lugar.telefonoIntl || lugar.telefono)}" class="detail-link">${escapeHtml(lugar.telefono)}</a>
        </div>
      ` : '<div class="detail-row"><span class="detail-row-icon">📞</span><span style="color:var(--text-dim);">Sin teléfono registrado</span></div>'}

      ${lugar.web ? `
        <div class="detail-row">
          <span class="detail-row-icon">🌐</span>
          <a href="${escapeHtml(lugar.web)}" target="_blank" rel="noopener noreferrer" class="detail-link">${escapeHtml(lugar.web)}</a>
        </div>
      ` : '<div class="detail-row"><span class="detail-row-icon">🌐</span><span style="color:var(--text-dim);">Sin sitio web oficial</span></div>'}

      <div class="detail-row">
        <span class="detail-row-icon">📍</span>
        <span style="font-size: 0.88rem; color: var(--text-muted);">${escapeHtml(lugar.direccion)}</span>
      </div>
    </div>

    <!-- Botones de Acción -->
    <div class="sheet-actions-grid">
      <button type="button" class="btn-action-sheet highlight" id="btnComoLlegarSheet">
        <span>🚇 ¿Cómo llegar?</span>
      </button>

      <button type="button" class="btn-action-sheet" id="btnToggleRutaSheet">
        <span>${enRuta ? '❌ Quitar de ruta' : '➕ Agregar a ruta'}</span>
      </button>
    </div>

    <div style="margin-top: 10px;">
      <a href="${escapeHtml(lugar.mapsUrl)}" target="_blank" rel="noopener noreferrer" class="btn-action-sheet" style="text-decoration:none;">
        <span>🗺️ Abrir ficha en Google Maps</span>
      </a>
    </div>

    <div id="transitStepsContainer" style="display: none;"></div>
  `;

  // Listener para copiar link
  document.getElementById('btnCopiarReviewLink')?.addEventListener('click', () => {
    copiarAlPortapapeles(revLink, '¡Link de reseña copiado! Listo para pegar en NFC Tools');
  });

  document.getElementById('btnCopiarPlaceId')?.addEventListener('click', () => {
    copiarAlPortapapeles(lugar.placeId, 'Place ID copiado');
  });

  // Listener agregar a ruta
  document.getElementById('btnToggleRutaSheet')?.addEventListener('click', () => {
    toggleLugarEnRuta(lugar);
    cerrarDetalleLugar();
  });

  // Listener ¿Cómo llegar?
  document.getElementById('btnComoLlegarSheet')?.addEventListener('click', () => {
    desplegarComoLlegar(lugar);
  });

  overlay.classList.add('open');
}

function cerrarDetalleLugar() {
  const overlay = document.getElementById('sheetOverlay');
  if (overlay) overlay.classList.remove('open');
  estado.lugarActivo = null;
}

/* ───────────────────────────── Cómo Llegar (Routes API) ───────────────────────────── */

async function desplegarComoLlegar(lugar) {
  const cont = document.getElementById('transitStepsContainer');
  if (!cont) return;

  if (!estado.ubicacion) {
    alert('Necesitamos tu ubicación GPS actual para trazar cómo llegar.');
    return;
  }

  cont.style.display = 'block';
  cont.innerHTML = `
    <div class="transit-steps-box" style="text-align: center; padding: 20px;">
      <p style="font-weight: 700; color: var(--accent-blue);">Calculando transporte con Google Routes...</p>
    </div>
  `;

  try {
    const res = await obtenerRuta({
      origen: estado.ubicacion,
      destino: { placeId: lugar.placeId, lat: lugar.lat, lng: lugar.lng },
      modo: 'TRANSIT'
    });

    const urlMapsDirecto = urlComoLlegar(estado.ubicacion, lugar, 'transit');

    if (!res.pasos || res.pasos.length === 0) {
      cont.innerHTML = `
        <div class="transit-steps-box">
          <p style="color: var(--accent-amber); font-weight: 600;">${res.avisos?.[0] || 'No se encontró combinación de transporte directo.'}</p>
          <a href="${urlMapsDirecto}" target="_blank" rel="noopener noreferrer" class="btn-action-sheet" style="margin-top: 10px; text-decoration: none;">
            <span>Ver ruta a pie / auto en Maps</span>
          </a>
        </div>
      `;
      return;
    }

    const duracion = duracionTexto(res.duracionSeg);
    const distancia = distanciaTexto(res.distanciaM);

    let pasosHtml = '';
    for (const p of res.pasos) {
      let icon = '🚶';
      let header = p.instruccion || 'Camina';

      if (p.tipo === 'TRANSIT' && p.transporte) {
        const t = p.transporte;
        icon = t.vehiculo === 'SUBWAY' ? '🚇' : t.vehiculo === 'BUS' ? '🚌' : '🚊';
        header = `
          <div>
            <span class="transit-line-chip" style="background-color: ${t.color}; color: ${t.colorTexto};">
              ${escapeHtml(t.lineaCorta || t.linea)}
            </span>
            <strong>${escapeHtml(t.linea)}</strong> (${t.paradas} paradas)
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            Desde: <strong>${escapeHtml(t.desde)}</strong> → Hacia: <strong>${escapeHtml(t.hasta)}</strong>
          </div>
        `;
      }

      pasosHtml += `
        <div class="transit-step-item">
          <div class="transit-icon-badge" style="background-color: rgba(255,255,255,0.06);">${icon}</div>
          <div style="flex: 1; font-size: 0.88rem;">
            ${header}
            <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 2px;">
              ${duracionTexto(p.duracionSeg)} · ${distanciaTexto(p.distanciaM)}
            </div>
          </div>
        </div>
      `;
    }

    cont.innerHTML = `
      <div class="transit-steps-box">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-weight: 800; color: #FFFFFF; font-size: 1.05rem;">⏱️ ${duracion}</span>
          <span style="font-size: 0.85rem; color: var(--accent-blue);">${distancia}</span>
        </div>
        ${pasosHtml}
        <a href="${urlMapsDirecto}" target="_blank" rel="noopener noreferrer" class="btn-action-sheet" style="margin-top: 12px; text-decoration: none;">
          <span>📲 Iniciar Navegación en Google Maps</span>
        </a>
      </div>
    `;
  } catch (err) {
    console.error('Error obteniendo trayecto:', err);
    cont.innerHTML = `
      <div class="transit-steps-box" style="color: #EF4444;">
        <p>No se pudo calcular el trayecto: ${err.message}</p>
      </div>
    `;
  }
}

/* ───────────────────────────── Armado y Gestión de Ruta ───────────────────────────── */

function toggleLugarEnRuta(lugar) {
  const index = estado.paradasRuta.findIndex((p) => p.placeId === lugar.placeId);
  if (index >= 0) {
    estado.paradasRuta.splice(index, 1);
    mostrarToast('Eliminado de la ruta');
  } else {
    estado.paradasRuta.push(lugar);
    mostrarToast('Agregado a tu ruta');
  }
  guardarRutaPersistida();
}

function actualizarBadgeRuta() {
  const badge = document.getElementById('badgeRutaCount');
  if (badge) {
    badge.textContent = estado.paradasRuta.length;
    badge.style.display = estado.paradasRuta.length > 0 ? 'inline-block' : 'none';
  }
}

function renderizarVistaRuta() {
  const cont = document.getElementById('rutaParadasContainer');
  if (!cont) return;

  if (estado.paradasRuta.length === 0) {
    cont.innerHTML = `
      <div style="text-align: center; padding: 60px 16px; color: var(--text-dim);">
        <p style="font-size: 2.5rem; margin-bottom: 12px;">🗺️</p>
        <p style="font-weight: 700; font-size: 1.1rem; color: var(--text-muted);">Tu ruta de hoy está vacía</p>
        <p style="font-size: 0.88rem; margin-top: 6px;">
          Busca negocios y agrégalos con el botón "➕ Agregar a ruta" para ordenarlos automáticamente por cercanía.
        </p>
      </div>
    `;
    const btnMaps = document.getElementById('btnAbrirRutaCompletaMaps');
    if (btnMaps) btnMaps.style.display = 'none';
    return;
  }

  // Ordenar óptimamente con vecino más cercano y 2-opt
  const rutaOrdenada = ordenarRuta(estado.ubicacion, estado.paradasRuta);
  estado.paradasRuta = rutaOrdenada;
  guardarRutaPersistida();

  cont.innerHTML = '';

  rutaOrdenada.forEach((l, i) => {
    const card = document.createElement('div');
    card.className = 'route-stop-card';

    const visita = estado.bitacoraVisitas[l.placeId];
    let estadoVisitaBadge = '';
    if (visita) {
      if (visita.estado === 'vendido') estadoVisitaBadge = '<span style="color:#10B981;font-weight:700;">🎉 ¡Vendido!</span>';
      else if (visita.estado === 'interesado') estadoVisitaBadge = '<span style="color:#F59E0B;font-weight:700;">🤔 Interesado</span>';
      else if (visita.estado === 'no') estadoVisitaBadge = '<span style="color:#EF4444;font-weight:700;">❌ No le interesó</span>';
    }

    card.innerHTML = `
      <div class="route-stop-number">${i + 1}</div>
      <div style="flex: 1;">
        <h4 style="font-size: 1rem; font-weight: 700; color: #FFFFFF;">${escapeHtml(l.nombre)}</h4>
        <p style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(l.giro)} · ${l.direccionCorta || l.direccion}</p>
        <div style="font-size: 0.78rem; margin-top: 4px;">${estadoVisitaBadge}</div>

        <div class="route-actions-row">
          <button type="button" class="btn-action-sheet" style="min-height:36px;font-size:0.75rem;" data-ver="${l.placeId}">
            Ver ficha
          </button>
          <button type="button" class="btn-action-sheet" style="min-height:36px;font-size:0.75rem;" data-resultado="${l.placeId}">
            Registrar visita
          </button>
        </div>
      </div>
    `;

    card.querySelector(`[data-ver="${l.placeId}"]`)?.addEventListener('click', () => abrirDetalleLugar(l));
    card.querySelector(`[data-resultado="${l.placeId}"]`)?.addEventListener('click', () => registrarVisita(l));

    cont.appendChild(card);
  });

  // Configurar botón para abrir ruta completa en Google Maps
  const btnMaps = document.getElementById('btnAbrirRutaCompletaMaps');
  if (btnMaps) {
    btnMaps.style.display = 'flex';
    btnMaps.onclick = () => {
      const urls = urlsRutaCompleta(estado.ubicacion, estado.paradasRuta, 'walking');
      if (urls.length > 0) {
        window.open(urls[0], '_blank');
      }
    };
  }

  // Botón para limpiar ruta
  const btnLimpiar = document.getElementById('btnLimpiarRuta');
  if (btnLimpiar) {
    btnLimpiar.onclick = () => {
      if (confirm('¿Deseas vaciar la ruta de hoy?')) {
        estado.paradasRuta = [];
        guardarRutaPersistida();
        renderizarVistaRuta();
      }
    };
  }
}

function registrarVisita(lugar) {
  const resp = prompt(
    `Registrar resultado de visita en "${lugar.nombre}":\n\n1 = Vendido 🎉\n2 = Interesado (volver) 🤔\n3 = No le interesó ❌\n0 = Borrar estado`,
    '1'
  );
  if (resp === null) return;

  const hoy = new Date().toISOString();
  if (resp === '1') estado.bitacoraVisitas[lugar.placeId] = { estado: 'vendido', fecha: hoy };
  else if (resp === '2') estado.bitacoraVisitas[lugar.placeId] = { estado: 'interesado', fecha: hoy };
  else if (resp === '3') estado.bitacoraVisitas[lugar.placeId] = { estado: 'no', fecha: hoy };
  else if (resp === '0') delete estado.bitacoraVisitas[lugar.placeId];

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
    // Fallback clásico
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
  }, 2800);
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
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW no registrado:', err);
    });
  }
}
