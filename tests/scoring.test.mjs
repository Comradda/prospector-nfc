import test from 'node:test';
import assert from 'node:assert/strict';
import { distanciaMetros, detectarPlazas, puntuar, PESOS_DEFECTO } from '../public/js/scoring.js';

test('distanciaMetros calcula haversine correctamente entre dos puntos', () => {
  // Zócalo CDMX a Bellas Artes (~1.1 km)
  const zocalo = { lat: 19.4326, lng: -99.1332 };
  const bellasArtes = { lat: 19.4352, lng: -99.1412 };
  const d = distanciaMetros(zocalo, bellasArtes);
  assert.ok(d > 800 && d < 1200, `Distancia esperada ~900-1100m, obtenida: ${d}`);

  // Mismo punto debe ser 0
  assert.equal(Math.round(distanciaMetros(zocalo, zocalo)), 0);

  // Coordenadas inválidas devuelven NaN
  assert.ok(Number.isNaN(distanciaMetros(null, zocalo)));
  assert.ok(Number.isNaN(distanciaMetros(zocalo, { lat: 95, lng: 0 })));
});

test('detectarPlazas detecta plaza por containingPlaces (señal oficial de Google)', () => {
  const lugares = [
    {
      placeId: 'negocio-1',
      nombre: 'Tacos 1',
      lat: 19.43, lng: -99.13,
      contenidoEn: [{ placeId: 'plaza-1', nombre: 'Plaza Galeritas' }]
    },
    {
      placeId: 'negocio-2',
      nombre: 'Barber 1',
      lat: 19.4301, lng: -99.1301,
      contenidoEn: [{ placeId: 'plaza-1', nombre: 'Plaza Galeritas' }]
    },
    {
      placeId: 'negocio-3',
      nombre: 'Café 1',
      lat: 19.45, lng: -99.15,
      contenidoEn: []
    }
  ];

  const mapa = detectarPlazas(lugares);
  const p1 = mapa.get('negocio-1');
  const p2 = mapa.get('negocio-2');
  const p3 = mapa.get('negocio-3');

  assert.equal(p1.id, 'plaza-1');
  assert.equal(p1.nombre, 'Plaza Galeritas');
  assert.equal(p1.tamano, 2);
  assert.equal(p1.tipo, 'chica');
  assert.equal(p1, p2, 'Deben compartir el mismo objeto plaza');

  assert.equal(p3.tipo, 'aislado');
});

test('detectarPlazas marca como grande si tiene >= 15 negocios o si es centro comercial', () => {
  // Mall explícito
  const conMall = [
    {
      placeId: 'tienda-1',
      lat: 19.43, lng: -99.13,
      contenidoEn: [{ placeId: 'mall-1', nombre: 'Gran Plaza Mall', esCentroComercial: true }]
    }
  ];
  const mapaMall = detectarPlazas(conMall);
  assert.equal(mapaMall.get('tienda-1').tipo, 'grande');

  // Plaza con 15 locales detectados
  const muchos = Array.from({ length: 15 }, (_, i) => ({
    placeId: `local-${i}`,
    lat: 19.43, lng: -99.13,
    contenidoEn: [{ placeId: 'plaza-enorme', nombre: 'Plaza Enorme' }]
  }));
  const mapaMuchos = detectarPlazas(muchos);
  assert.equal(mapaMuchos.get('local-0').tipo, 'grande');
});

test('detectarPlazas agrupa por proximidad geográfica si no hay containingPlaces', () => {
  // 3 negocios a menos de 45m entre sí (un cluster de plaza chica sin metadata)
  const baseLat = 19.43000;
  const baseLng = -99.13000;
  // ~11 metros por cada 0.0001 de latitud
  const cluster = [
    { placeId: 'c1', lat: baseLat, lng: baseLng },
    { placeId: 'c2', lat: baseLat + 0.0001, lng: baseLng },
    { placeId: 'c3', lat: baseLat + 0.0002, lng: baseLng },
    { placeId: 'aislado', lat: baseLat + 0.01, lng: baseLng } // ~1 km lejos
  ];

  const mapa = detectarPlazas(cluster, { radioCluster: 45, minPlaza: 3 });
  assert.equal(mapa.get('c1').tipo, 'chica');
  assert.equal(mapa.get('c2').tipo, 'chica');
  assert.equal(mapa.get('c3').tipo, 'chica');
  assert.equal(mapa.get('c1').tamano, 3);
  assert.equal(mapa.get('aislado').tipo, 'aislado');
});

test('puntuar prioriza negocios con pocas o cero reseñas sobre los consolidados', () => {
  const origen = { lat: 19.43, lng: -99.13 };
  const lugares = [
    {
      placeId: 'muchas-resenas',
      nombre: 'Restaurante Famoso',
      lat: 19.431, lng: -99.131,
      resenas: 850,
      calificacion: 4.8,
      web: 'https://ejemplo.com',
      telefono: '5512345678'
    },
    {
      placeId: 'cero-resenas',
      nombre: 'Barbería Nueva',
      lat: 19.431, lng: -99.131,
      resenas: 0,
      calificacion: null,
      web: null,
      telefono: '5587654321'
    },
    {
      placeId: 'pocas-resenas',
      nombre: 'Cafetería de Barrio',
      lat: 19.431, lng: -99.131,
      resenas: 6,
      calificacion: 3.8,
      web: null,
      telefono: null
    }
  ];

  const ordenados = puntuar(lugares, origen);

  // El que tiene 0 o pocas reseñas debe quedar primero
  assert.ok(ordenados[0].placeId === 'cero-resenas' || ordenados[0].placeId === 'pocas-resenas');
  assert.equal(ordenados[2].placeId, 'muchas-resenas');
  assert.ok(ordenados[0].puntaje > ordenados[2].puntaje);
  assert.ok(ordenados[0].motivos.some(m => m.includes('reseña')));
});

test('puntuar excluye CLOSED_PERMANENTLY y penaliza CLOSED_TEMPORARILY', () => {
  const origen = { lat: 19.43, lng: -99.13 };
  const lugares = [
    { placeId: 'cerrado-def', estado: 'CLOSED_PERMANENTLY', lat: 19.43, lng: -99.13, resenas: 0 },
    { placeId: 'cerrado-temp', estado: 'CLOSED_TEMPORARILY', lat: 19.43, lng: -99.13, resenas: 0 },
    { placeId: 'operando', estado: 'OPERATIONAL', lat: 19.43, lng: -99.13, resenas: 0 }
  ];

  const res = puntuar(lugares, origen);
  assert.equal(res.find(l => l.placeId === 'cerrado-def'), undefined, 'Debe excluir definitivamente cerrados');

  const temp = res.find(l => l.placeId === 'cerrado-temp');
  const oper = res.find(l => l.placeId === 'operando');
  assert.ok(temp);
  assert.ok(oper);
  assert.ok(temp.puntaje < oper.puntaje, 'Cerrado temporal debe tener mucho menor puntaje');
  assert.ok(temp.motivos.includes('Cerrado temporalmente'));
});
