import test from 'node:test';
import assert from 'node:assert/strict';
import { GIROS, obtenerGiroPorClave, clasificarGiro, esCentroComercialTipo } from '../functions/_lib/giros.js';
import { verificarAutenticacion } from '../functions/_lib/auth.js';
import { normalizarLugarGoogle } from '../functions/_lib/google.js';

test('giros.js contiene los giros requeridos y mapeos a Google Places Table A', () => {
  const claves = GIROS.map((g) => g.clave);
  assert.ok(claves.includes('restaurantes'));
  assert.ok(claves.includes('cafeterias'));
  assert.ok(claves.includes('barberias'));
  assert.ok(claves.includes('esteticas'));
  assert.ok(claves.includes('comida_rapida'));
  assert.ok(claves.includes('consultorios'));

  const barber = obtenerGiroPorClave('barberias');
  assert.ok(barber.googleTypes.includes('barber_shop'));

  assert.equal(clasificarGiro(['hair_salon']).clave, 'esteticas');
  assert.equal(esCentroComercialTipo(['shopping_mall']), true);
  assert.equal(esCentroComercialTipo(['cafe']), false);
});

test('auth.js valida correctamente el código de acceso con x-codigo', () => {
  const env = { ACCESS_CODE: 'secreto-vendedor-123' };

  // Código correcto
  const reqValido = new Request('http://localhost/api/buscar', {
    headers: { 'x-codigo': 'secreto-vendedor-123' }
  });
  assert.equal(verificarAutenticacion(reqValido, env), true);

  // Código incorrecto
  const reqInvalido = new Request('http://localhost/api/buscar', {
    headers: { 'x-codigo': 'otro-codigo' }
  });
  assert.equal(verificarAutenticacion(reqInvalido, env), false);

  // Sin código
  const reqSinCodigo = new Request('http://localhost/api/buscar');
  assert.equal(verificarAutenticacion(reqSinCodigo, env), false);

  // Sin ACCESS_CODE configurado en env (modo desarrollo libre)
  assert.equal(verificarAutenticacion(reqSinCodigo, {}), true);
});

test('google.js normalizarLugarGoogle mapea correctamente datos y genera link de reseña', () => {
  const rawPlace = {
    id: 'ChIJTest123',
    displayName: { text: 'Tacos Don Chuy' },
    types: ['mexican_restaurant', 'restaurant'],
    primaryTypeDisplayName: { text: 'Restaurante mexicano' },
    formattedAddress: 'Av. Insurgentes Sur 456, Roma Sur, CDMX',
    shortFormattedAddress: 'Av. Insurgentes Sur 456',
    location: { latitude: 19.412, longitude: -99.165 },
    rating: 4.2,
    userRatingCount: 15,
    businessStatus: 'OPERATIONAL',
    currentOpeningHours: { openNow: true },
    nationalPhoneNumber: '55 9876 5432',
    websiteUri: 'https://donchuy.com',
    containingPlaces: [
      { id: 'PlazaSur', displayName: { text: 'Plaza Insurgentes' }, types: ['shopping_mall'] }
    ]
  };

  const normalizado = normalizarLugarGoogle(rawPlace);
  assert.equal(normalizado.placeId, 'ChIJTest123');
  assert.equal(normalizado.nombre, 'Tacos Don Chuy');
  assert.equal(normalizado.giroClave, 'restaurantes');
  assert.equal(normalizado.calificacion, 4.2);
  assert.equal(normalizado.resenas, 15);
  assert.equal(normalizado.abiertoAhora, true);
  assert.equal(
    normalizado.linkResena,
    'https://search.google.com/local/writereview?placeid=ChIJTest123'
  );
  assert.equal(normalizado.contenidoEn.length, 1);
  assert.equal(normalizado.contenidoEn[0].esCentroComercial, true);
});

test('osm.js clasificarGiroOSM y normalizarLugarOSM mapean tags de OpenStreetMap correctamente', async () => {
  const { clasificarGiroOSM, normalizarLugarOSM } = await import('../functions/_lib/osm.js');

  assert.equal(clasificarGiroOSM({ amenity: 'cafe' }).clave, 'cafeterias');
  assert.equal(clasificarGiroOSM({ shop: 'hairdresser' }).clave, 'barberias');
  assert.equal(clasificarGiroOSM({ shop: 'beauty' }).clave, 'esteticas');
  assert.equal(clasificarGiroOSM({ amenity: 'fast_food' }).clave, 'comida_rapida');
  assert.equal(clasificarGiroOSM({ amenity: 'dentist' }).clave, 'consultorios');
  assert.equal(clasificarGiroOSM({ amenity: 'restaurant' }).clave, 'restaurantes');

  const rawOSM = {
    type: 'node',
    id: 987654321,
    lat: 19.4326,
    lon: -99.1332,
    tags: {
      name: 'Barbería Don Pepe',
      shop: 'hairdresser',
      'addr:street': 'Calle Madero',
      'addr:housenumber': '24',
      'addr:suburb': 'Centro',
      'addr:city': 'CDMX',
      phone: '55 1122 3344'
    }
  };

  const norm = normalizarLugarOSM(rawOSM);
  assert.equal(norm.placeId, 'osm:node:987654321');
  assert.equal(norm.nombre, 'Barbería Don Pepe');
  assert.equal(norm.giroClave, 'barberias');
  assert.equal(norm.lat, 19.4326);
  assert.equal(norm.lng, -99.1332);
  assert.equal(norm.direccion, 'Calle Madero #24, Centro, CDMX');
  assert.equal(norm.telefono, '55 1122 3344');
  assert.ok(norm.mapsUrl.includes('google.com/maps/search/'));
  assert.ok(norm.mapsUrl.includes('Barber%C3%ADa%20Don%20Pepe'));
  assert.equal(norm.fuente, 'openstreetmap');
});

test('gmaps-public.js extrae Place ID ChIJ, reseñas reales y link writereview sin emojis', async () => {
  const { parsearItemGoogleMaps, limpiarEmojis } = await import('../functions/_lib/gmaps-public.js');

  assert.equal(limpiarEmojis('Barbería El Catrín 💈✂️'), 'Barbería El Catrín');

  const fakeItem = [];
  fakeItem[2] = ['Av. Reforma 100', 'Juárez', 'CDMX'];
  fakeItem[4] = [null, null, null, null, null, null, null, 4.6, 12];
  fakeItem[7] = ['https://barberiacatrin.mx'];
  fakeItem[9] = [null, null, 19.4326, -99.1332];
  fakeItem[11] = 'Barbería El Catrín 💈';
  fakeItem[13] = ['Barbería'];
  fakeItem[39] = 'Av. Reforma 100, Juárez, CDMX';
  fakeItem[78] = 'ChIJt8FmsX3Z7IUR8HkOVjboSow';
  fakeItem[157] = 'https://lh3.googleusercontent.com/-test/photo/s44-p-k-no-ns-nd/photo.jpg';
  fakeItem[178] = [['55 1234 5678', null, null, '+525512345678']];

  const parsed = parsearItemGoogleMaps(fakeItem, 'barberias');
  assert.equal(parsed.placeId, 'ChIJt8FmsX3Z7IUR8HkOVjboSow');
  assert.equal(parsed.nombre, 'Barbería El Catrín');
  assert.equal(parsed.calificacion, 4.6);
  assert.equal(parsed.resenas, 12);
  assert.equal(
    parsed.fotoUrl,
    'https://lh3.googleusercontent.com/-test/photo/w400-h300-k-no/photo.jpg'
  );
  assert.ok(parsed.traficoResenas);
  assert.equal(parsed.traficoResenas.dias7, 0);
  assert.equal(parsed.traficoResenas.dias30, 0);
  assert.equal(parsed.traficoResenas.estadoFlujo, 'estancado');
  assert.equal(
    parsed.linkResena,
    'https://search.google.com/local/writereview?placeid=ChIJt8FmsX3Z7IUR8HkOVjboSow'
  );
});


