const { generateSwissPairings, defaultSwissRounds, pickByeCandidate } = require('../../src/services/swissPairingService');

function mkPlayer(id, points, opponentIds = [], byeReceived = false) {
  return { id, points, opponentIds, byeReceived };
}

describe('swissPairingService', () => {
  test('4 jugadores en ronda 1 genera 2 pairings sin bye', () => {
    const players = ['A', 'B', 'C', 'D'].map((id) => mkPlayer(id, 0));
    const { pairings } = generateSwissPairings(players);
    expect(pairings).toHaveLength(2);
    expect(pairings.every((p) => p.player2Id !== null)).toBe(true);
  });

  test('nÂº impar de jugadores genera exactamente un bye', () => {
    const players = ['A', 'B', 'C', 'D', 'E'].map((id) => mkPlayer(id, 0));
    const { pairings } = generateSwissPairings(players);
    const byes = pairings.filter((p) => p.player2Id === null);
    expect(byes).toHaveLength(1);
  });

  test('evita emparejar rivales ya enfrentados cuando hay alternativa', () => {
    const players = [
      mkPlayer('A', 3, ['B']),
      mkPlayer('B', 3, ['A']),
      mkPlayer('C', 3, []),
      mkPlayer('D', 3, [])
    ];
    const { pairings } = generateSwissPairings(players);
    const aVsB = pairings.some(
      (p) => (p.player1Id === 'A' && p.player2Id === 'B') || (p.player1Id === 'B' && p.player2Id === 'A')
    );
    expect(aVsB).toBe(false);
  });

  test('bucket de puntos impar baja un jugador al bucket inferior sin generar bye', () => {
    const players = [
      mkPlayer('A', 6), mkPlayer('B', 6), mkPlayer('C', 6),
      mkPlayer('D', 3), mkPlayer('E', 3), mkPlayer('F', 3)
    ];
    const { pairings } = generateSwissPairings(players);
    expect(pairings).toHaveLength(3);
    expect(pairings.every((p) => p.player2Id !== null)).toBe(true);
  });

  test.each([
    [8, 3],
    [16, 4],
    [32, 5]
  ])('defaultSwissRounds(%i) === %i', (numPlayers, expected) => {
    expect(defaultSwissRounds(numPlayers)).toBe(expected);
  });

  test('pickByeCandidate prioriza al de menor puntuacion sin bye previo', () => {
    const players = [mkPlayer('A', 6, [], true), mkPlayer('B', 3, [], false), mkPlayer('C', 3, [], true)];
    const candidate = pickByeCandidate(players);
    expect(candidate.id).toBe('B');
  });
});
