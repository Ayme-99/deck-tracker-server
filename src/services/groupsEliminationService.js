// Logica pura de la estructura 'groups_elimination' (issue #43): reparto
// en grupos y calculo de la entrada a la fase eliminatoria (byes + ronda
// previa reducida cuando el nº de clasificados no es potencia de 2).
//
// Ver TORNEOS_HOSTED_GDD.md seccion 4.3.

const { bracketPhaseForSize, previousPhase, seededPairings } = require('./eliminationPairingService');

/**
 * Reparte jugadores en grupos de tamaño lo mas parecido posible a
 * `groupSize`. Si no divide exacto, algunos grupos tienen un jugador menos.
 * Distribucion tipo round-robin (no secuencial) para que sea mas neutral
 * si `playerIds` viene en algun orden con significado (ej. inscripcion).
 *
 * @param {string[]} playerIds
 * @param {number} groupSize - tamaño deseado por grupo
 * @returns {string[][]} array de grupos (cada uno, array de IDs)
 */
function assignGroups(playerIds, groupSize) {
  if (groupSize < 2) throw new Error('El tamaño de grupo debe ser al menos 2');
  const numGroups = Math.ceil(playerIds.length / groupSize);
  const groups = Array.from({ length: numGroups }, () => []);

  playerIds.forEach((id, index) => {
    groups[index % numGroups].push(id);
  });

  return groups;
}

/**
 * Calcula como entran los clasificados a la fase eliminatoria.
 *
 * @param {string[]} classifiedIds - ya ordenados de mejor a peor seed
 *   (ej. por standing combinado de todos los grupos)
 * @returns {{
 *   targetPhase: string,
 *   byeIds: string[],
 *   preliminary: null | { phase: string, pairings: Array<{player1Id, player2Id}> }
 * }}
 */
function calculateEliminationEntry(classifiedIds) {
  const n = classifiedIds.length;
  if (n < 2) throw new Error('Hacen falta al menos 2 clasificados');

  // Mayor potencia de 2 que no supere n, entre las soportadas (2,4,8,16,32,64)
  const supportedSizes = [64, 32, 16, 8, 4, 2];
  const targetSize = supportedSizes.find((size) => size <= n);
  if (!targetSize) throw new Error('Nº de clasificados no soportado en esta version (maximo 64+63=127)');

  const targetPhase = bracketPhaseForSize(targetSize);
  const extra = n - targetSize;

  if (extra === 0) {
    return { targetPhase, byeIds: classifiedIds, preliminary: null };
  }

  const prelimCount = extra * 2;
  if (prelimCount > n) {
    throw new Error('Nº de clasificados no soportado en esta version (demasiados para la ronda previa)');
  }

  const byeIds = classifiedIds.slice(0, n - prelimCount); // mejores seeds
  const prelimIds = classifiedIds.slice(n - prelimCount); // peores seeds, juegan la previa
  const prelimPhase = previousPhase(targetPhase);
  if (!prelimPhase) {
    throw new Error('No hay fase superior disponible para la ronda previa (maximo soportado: round_of_64)');
  }

  return {
    targetPhase,
    byeIds,
    preliminary: { phase: prelimPhase, pairings: seededPairings(prelimIds) }
  };
}

module.exports = { assignGroups, calculateEliminationEntry };