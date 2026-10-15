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
