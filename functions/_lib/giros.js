/**
 * Catálogo oficial de giros objetivo para prospectar clientes de tarjetas NFC.
 * Sin emojis para mantener una estética limpia y ejecutiva.
 */

export const GIROS = Object.freeze([
  {
    clave: 'restaurantes',
    etiqueta: 'Restaurantes',
    googleTypes: [
      'restaurant',
      'mexican_restaurant',
      'pizza_restaurant',
      'sandwich_shop',
      'seafood_restaurant',
      'italian_restaurant',
      'barbecue_restaurant'
    ]
  },
  {
    clave: 'cafeterias',
    etiqueta: 'Cafeterías',
    googleTypes: ['cafe', 'coffee_shop']
  },
  {
    clave: 'barberias',
    etiqueta: 'Barberías',
    googleTypes: ['barber_shop']
  },
  {
    clave: 'esteticas',
    etiqueta: 'Estéticas y salones',
    googleTypes: ['hair_salon', 'beauty_salon', 'nail_salon', 'spa']
  },
  {
    clave: 'comida_rapida',
    etiqueta: 'Taquerías y comida rápida',
    googleTypes: ['fast_food_restaurant', 'taco_restaurant']
  },
  {
    clave: 'consultorios',
    etiqueta: 'Consultorios y clínicas',
    googleTypes: [
      'dentist',
      'dental_clinic',
      'veterinary_care',
      'doctor',
      'medical_clinic',
      'physiotherapist'
    ]
  }
]);

const MAPA_GIROS = new Map(GIROS.map((g) => [g.clave, g]));

export function obtenerGiroPorClave(clave) {
  return MAPA_GIROS.get(clave) || null;
}

export function obtenerCatalogoGiros() {
  return GIROS.map(({ clave, etiqueta }) => ({ clave, etiqueta }));
}

/**
 * Identifica a qué giro de nuestro catálogo pertenece un lugar a partir de sus tipos de Google.
 * @param {string[]} types
 * @returns {{clave: string, etiqueta: string}}
 */
export function clasificarGiro(types = []) {
  if (!Array.isArray(types)) return { clave: 'servicios', etiqueta: 'Servicio' };

  for (const g of GIROS) {
    if (g.googleTypes.some((t) => types.includes(t))) {
      return { clave: g.clave, etiqueta: g.etiqueta };
    }
  }
  return { clave: 'servicios', etiqueta: 'Servicio' };
}

/**
 * Determina si una lista de tipos corresponde a un centro comercial grande.
 * @param {string[]} types
 * @returns {boolean}
 */
export function esCentroComercialTipo(types = []) {
  if (!Array.isArray(types)) return false;
  return types.includes('shopping_mall') || types.includes('department_store');
}
