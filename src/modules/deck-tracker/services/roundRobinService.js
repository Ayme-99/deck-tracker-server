// Generacion de calendario round-robin (todos contra todos), compartida
// entre grupos (#43) y liga (#44). Algoritmo del circulo: fija un jugador
// y rota el resto, generando n-1 rondas si n es par, o n rondas con un
// bye por ronda si n es impar.

/**
 * @param {string[]} playerIds
 * @returns {Array<Array<{player1Id: string, player2Id: string|null}>>}
 *   Un array de rondas; cada ronda es un array de pairings (player2Id
 *   null = bye esa ronda, solo ocurre si n es impar).
 */
function generateRoundRobinSchedule(playerIds) {
  if (playerIds.length < 2) return [];

  const ids = [...playerIds];
  const hasBye = ids.length % 2 !== 0;
  if (hasBye) ids.push(null); // placeholder de bye

  const n = ids.length;
  const rounds = [];
  const fixed = ids[0];
  let rotating = ids.slice(1);

  for (let round = 0; round < n - 1; round++) {
    const current = [fixed, ...rotating];
    const pairings = [];
    for (let i = 0; i < n / 2; i++) {
      const a = current[i];
      const b = current[n - 1 - i];
      if (a === null || b === null) {
        const real = a === null ? b : a;
        pairings.push({ player1Id: real, player2Id: null });
      } else {
        pairings.push({ player1Id: a, player2Id: b });
      }
    }
    rounds.push(pairings);
    // rota el array (excepto el fijo): mueve el ultimo al principio
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }

  return rounds;
}

module.exports = { generateRoundRobinSchedule };