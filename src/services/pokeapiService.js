const POKEAPI_BASE = 'https://pokeapi.co/api/v2';

let speciesCache = null;
let speciesCacheTimestamp = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

async function getAllSpeciesNames() {
  const isCacheValid = speciesCache && (Date.now() - speciesCacheTimestamp < CACHE_TTL_MS);
  if (isCacheValid) return speciesCache;

  // Primero pedimos el count total (limit=1 es barato, solo para saber cuantos hay)
  const countResponse = await fetch(`${POKEAPI_BASE}/pokemon?limit=1`);
  if (!countResponse.ok) throw new Error('No se pudo obtener el conteo de PokeAPI');
  const { count } = await countResponse.json();

  // Ahora pedimos la lista completa (incluye especies base + formas: megas, regionales, etc.)
  const response = await fetch(`${POKEAPI_BASE}/pokemon?limit=${count}`);
  if (!response.ok) throw new Error('No se pudo obtener la lista de PokeAPI');

  const data = await response.json();
  speciesCache = data.results.map((p) => p.name); // ej. ['bulbasaur', ..., 'dragalge-mega', ...]
  speciesCacheTimestamp = Date.now();

  return speciesCache;
}

async function searchSpecies(query) {
  const allNames = await getAllSpeciesNames();
  const lowerQuery = query.toLowerCase();
  return allNames.filter((name) => name.startsWith(lowerQuery)).slice(0, 15);
}

async function getSpeciesSprite(speciesName) {
  const response = await fetch(`${POKEAPI_BASE}/pokemon/${speciesName}`);
  if (!response.ok) return null;

  const data = await response.json();
  return data.sprites?.other?.['official-artwork']?.front_default || null;
}

module.exports = { searchSpecies, getSpeciesSprite };