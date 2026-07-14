const { generateRoundRobinSchedule } = require('../../src/services/roundRobinService');

function checkAllPlayEachOther(playerIds, rounds) {
  const seen = new Map(playerIds.map((id) => [id, new Set()]));
  const byeCounts = new Map(playerIds.map((id) => [id, 0]));

  for (const round of rounds) {
    const playedThisRound = new Set();
    for (const p of round) {
      if (p.player2Id === null) {
        byeCounts.set(p.player1Id, byeCounts.get(p.player1Id) + 1);
        playedThisRound.add(p.player1Id);
        continue;
      }
      seen.get(p.player1Id).add(p.player2Id);
      seen.get(p.player2Id).add(p.player1Id);
      playedThisRound.add(p.player1Id);
      playedThisRound.add(p.player2Id);
    }
    expect(playedThisRound.size).toBe(playerIds.length);
  }

  for (const id of playerIds) {
    for (const other of playerIds.filter((x) => x !== id)) {
      expect(seen.get(id).has(other)).toBe(true);
    }
  }

  return byeCounts;
}

describe('roundRobinService', () => {
  test('4 jugadores (par): 3 rondas, todos contra todos, sin byes', () => {
    const players = ['A', 'B', 'C', 'D'];
    const rounds = generateRoundRobinSchedule(players);
    expect(rounds).toHaveLength(3);
    const byeCounts = checkAllPlayEachOther(players, rounds);
    expect([...byeCounts.values()].every((c) => c === 0)).toBe(true);
  });

  test('5 jugadores (impar): 5 rondas, todos contra todos, cada uno con exactamente 1 bye', () => {
    const players = ['A', 'B', 'C', 'D', 'E'];
    const rounds = generateRoundRobinSchedule(players);
    expect(rounds).toHaveLength(5);
    const byeCounts = checkAllPlayEachOther(players, rounds);
    expect([...byeCounts.values()].every((c) => c === 1)).toBe(true);
  });

  test('menos de 2 jugadores devuelve calendario vacio', () => {
    expect(generateRoundRobinSchedule(['solo'])).toEqual([]);
  });
});
