const POKEAPI_BASE = 'https://pokeapi.co/api/v2';

let speciesCache = null; // array de nombres, cacheado en memoria tras la primera peticion
let speciesCacheTimestamp = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

async function getAllSpeciesNames() {
  const isCacheValid = speciesCache && (Date.now() - speciesCacheTimestamp < CACHE_TTL_MS);
  if (isCacheValid) return speciesCache;

  const response = await fetch(`${POKEAPI_BASE}/pokemon-species?limit=2000`);
  if (!response.ok) throw new Error('No se pudo obtener la lista de especies de PokeAPI');

  const data = await response.json();
  speciesCache = data.results.map((s) => s.name); // ej. ['bulbasaur', 'ivysaur', ...]
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