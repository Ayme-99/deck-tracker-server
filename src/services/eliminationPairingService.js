// Logica pura de generacion de bracket de eliminatoria directa (issue #42).
// Sin llamadas a base de datos: recibe una lista de IDs de jugadores
// (ya en el orden que se quiera: aleatorio o por seeding) y devuelve los
// emparejamientos del bracket, junto con la fase inicial correspondiente.
//
// Ver TORNEOS_HOSTED_GDD.md seccion 4.2.

const PHASE_ORDER = ['round_of_64', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final'];

/**
 * Determina la fase inicial del bracket segun el nº de jugadores.
 * Soporta potencias de 2 hasta 64 (issue #92).
 */
function bracketPhaseForSize(numPlayers) {
  if (numPlayers <= 2) return 'final';
  if (numPlayers <= 4) return 'semifinal';
  if (numPlayers <= 8) return 'quarterfinal';
  if (numPlayers <= 16) return 'round_of_16';
  if (numPlayers <= 32) return 'round_of_32';
  if (numPlayers <= 64) return 'round_of_64';
  throw new Error('Bracket de mas de 64 jugadores no soportado en esta version');
}

/** Fase siguiente en el bracket, o null si 'final' ya es la ultima. */
function nextPhase(phase) {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx === -1 || idx === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

/** Baraja aleatoriamente un array (Fisher-Yates), sin mutar el original. */
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Empareja el mejor con el peor, el segundo mejor con el penultimo, etc.
 * (seeding estandar de bracket). `orderedIds` debe venir ya ordenado de
 * mejor a peor (ej. por standing de la fase swiss previa).
 */
function seededPairings(orderedIds) {
  const pairings = [];
  const n = orderedIds.length;
  for (let i = 0; i < n / 2; i++) {
    pairings.push({ player1Id: orderedIds[i], player2Id: orderedIds[n - 1 - i] });
  }
  return pairings;
}

/**
 * Genera el bracket inicial: si seeded=true, usa seeding estandar sobre el
 * orden recibido (se espera ya ordenado por standing); si no, aleatorio.
 * El nº de jugadores debe ser potencia de 2 (los byes de fases previas,
 * ver seccion 4.3 del GDD, se resuelven antes de llegar aqui).
 */
function generateBracket(playerIds, { seeded = false } = {}) {
  if (playerIds.length < 2) {
    throw new Error('Hacen falta al menos 2 jugadores para generar un bracket');
  }
  if ((playerIds.length & (playerIds.length - 1)) !== 0) {
    throw new Error('El nº de jugadores debe ser potencia de 2 (2, 4, 8, 16)');
  }

  const ordered = seeded ? playerIds : shuffle(playerIds);
  const phase = bracketPhaseForSize(playerIds.length);
  const pairings = seededPairings(ordered);

  return { phase, pairings };
}

/** Fase inmediatamente superior (bracket mas grande), o null si 'round_of_64' ya es la mas grande soportada. */
function previousPhase(phase) {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx <= 0) return null;
  return PHASE_ORDER[idx - 1];
}

module.exports = { bracketPhaseForSize, nextPhase, previousPhase, seededPairings, generateBracket, shuffle };