import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ordenarRuta,
  urlComoLlegar,
  urlsRutaCompleta,
  linkResena,
  duracionTexto,
  distanciaTexto
} from '../public/js/ruta.js';

test('linkResena genera la URL canónica para escribir reseñas en Google Maps', () => {
  const url = linkResena('ChIJgUbEo8cfqokR5lP9_WhqJKg');
  assert.equal(url, 'https://search.google.com/local/writereview?placeid=ChIJgUbEo8cfqokR5lP9_WhqJKg');
});

test('duracionTexto y distanciaTexto formatean valores amigables en español', () => {
  assert.equal(duracionTexto(45), '45 s');
  assert.equal(duracionTexto(120), '2 min');
  assert.equal(duracionTexto(3900), '1 h 05 min');
  assert.equal(duracionTexto(-5), 'Sin dato');

  assert.equal(distanciaTexto(450), '450 m');
  assert.equal(distanciaTexto(1250), '1.3 km');
  assert.equal(distanciaTexto(12000), '12 km');
  assert.equal(distanciaTexto(null), 'Sin dato');
});

test('ordenarRuta ordena por cercanía con 2-opt a partir del origen', () => {
  const origen = { lat: 19.4300, lng: -99.1300 };
  const puntos = [
    { id: 'muy-lejos', lat: 19.4500, lng: -99.1300 },
    { id: 'cerca', lat: 19.4310, lng: -99.1300 },
    { id: 'medio', lat: 19.4350, lng: -99.1300 }
  ];

  const orden = ordenarRuta(origen, puntos);
  assert.equal(orden.length, 3);
  assert.equal(orden[0].id, 'cerca');
  assert.equal(orden[1].id, 'medio');
  assert.equal(orden[2].id, 'muy-lejos');
});

test('urlComoLlegar genera URL válida con travelmode', () => {
  const origen = { lat: 19.4326, lng: -99.1332 };
  const destino = { placeId: 'ChIJ123', lat: 19.4352, lng: -99.1412 };

  const urlTransit = urlComoLlegar(origen, destino, 'transit');
  assert.ok(urlTransit.startsWith('https://www.google.com/maps/dir/?api=1'));
  assert.ok(urlTransit.includes('destination=19.4352%2C-99.1412'));
  assert.ok(urlTransit.includes('destination_place_id=ChIJ123'));
  assert.ok(urlTransit.includes('travelmode=transit'));
  assert.ok(urlTransit.includes('origin=19.4326%2C-99.1332'));

  // Origen null (ubicación actual del dispositivo)
  const urlSinOrigen = urlComoLlegar(null, destino, 'walking');
  assert.ok(!urlSinOrigen.includes('origin='));
  assert.ok(urlSinOrigen.includes('travelmode=walking'));
});

test('urlsRutaCompleta maneja fragmentación y modos', () => {
  const origen = { lat: 19.43, lng: -99.13 };
  const lugares = Array.from({ length: 6 }, (_, i) => ({
    placeId: `p-${i}`,
    lat: 19.43 + (i + 1) * 0.001,
    lng: -99.13
  }));

  // En modo transit: Google Maps NO soporta waypoints en transit, por lo que genera 1 URL por tramo
  const urlsTransit = urlsRutaCompleta(origen, lugares, 'transit');
  assert.equal(urlsTransit.length, 6);

  // En modo walking/driving: genera URLs con waypoints (máximo 3 waypoints por URL, es decir 4 tramos por URL)
  // Para 6 lugares: chunk 1 (origen + 3 waypoints + parada 4), chunk 2 (parada 4 + parada 5 + parada 6)
  const urlsWalking = urlsRutaCompleta(origen, lugares, 'walking');
  assert.equal(urlsWalking.length, 2);
  assert.ok(urlsWalking[0].includes('travelmode=walking'));
  assert.ok(urlsWalking[0].includes('waypoints='));
});
