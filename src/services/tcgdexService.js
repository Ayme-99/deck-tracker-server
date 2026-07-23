// Logica de acceso a la API de TCGdex (issue #80): busqueda de cartas
// reales para poder validar/generar el cardId de cada carta de un mazo
// contra un catalogo oficial, en vez de un slug hecho a mano del nombre
// escrito.
//
// NOTA: la idea original era usar pokemontcg.io, pero esa API se ha
// integrado en Scrydex (de pago, sin plan gratuito) -- ver issue #80.
// TCGdex (https://tcgdex.dev) es gratuita, sin API key y sin limites
// publicados, asi que se usa esa en su lugar. Mismo patron que
// pokeapiService.js (fetch nativo, sin dependencias nuevas).

const TCGDEX_BASE = 'https://api.tcgdex.net/v2/en'; // Base URL de la API de TCGdex. TODO: permitir cambiar el idioma (en, es, ja, etc) en la configuracion del usuario, para que busque cartas en el idioma preferido. Por ahora solo se usa 'en' (ingles).

/**
 * Busca cartas reales por nombre (substring, no solo prefijo). Devuelve
 * como mucho 15 resultados, con los datos minimos para elegir la carta
 * correcta en un autocompletado (nombre, numero, imagen) y el cardId real
 * a guardar en el mazo.
 */
async function searchCards(query) {
  const url = `${TCGDEX_BASE}/cards?name=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('No se pudo consultar el catalogo de cartas');

  const data = await response.json();
  return (Array.isArray(data) ? data : []).slice(0, 15).map((c) => ({
    cardId: c.id,
    name: c.name,
    set: null,
    number: c.localId || null,
    // La imagen de TCGdex es una URL base sin extension: hay que
    // añadirle calidad + formato (ver https://tcgdex.dev/assets)
    image: c.image ? `${c.image}/low.webp` : null,
  }));
}

module.exports = { searchCards };
