const {
  bracketPhaseForSize,
  nextPhase,
  previousPhase,
  seededPairings,
  generateBracket
} = require('../../src/services/eliminationPairingService');

describe('eliminationPairingService', () => {
  test.each([
    [2, 'final'],
    [4, 'semifinal'],
    [8, 'quarterfinal'],
    [16, 'round_of_16']
  ])('bracketPhaseForSize(%i) === %s', (size, expected) => {
    expect(bracketPhaseForSize(size)).toBe(expected);
  });

  test('bracketPhaseForSize rechaza mas de 16', () => {
    expect(() => bracketPhaseForSize(32)).toThrow();
  });

  test('nextPhase avanza correctamente y devuelve null tras final', () => {
    expect(nextPhase('quarterfinal')).toBe('semifinal');
    expect(nextPhase('final')).toBeNull();
  });

  test('previousPhase retrocede correctamente y devuelve null antes de round_of_16', () => {
    expect(previousPhase('quarterfinal')).toBe('round_of_16');
    expect(previousPhase('round_of_16')).toBeNull();
  });

  test('seededPairings empareja mejor contra peor (seeding estandar)', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    const pairings = seededPairings(seeds);
    expect(pairings).toEqual([
      { player1Id: 's1', player2Id: 's8' },
      { player1Id: 's2', player2Id: 's7' },
      { player1Id: 's3', player2Id: 's6' },
      { player1Id: 's4', player2Id: 's5' }
    ]);
  });

  test('generateBracket rechaza un nÂº de jugadores que no es potencia de 2', () => {
    expect(() => generateBracket(['a', 'b', 'c'])).toThrow();
  });

  test('generateBracket seeded devuelve la fase y pairings correctos', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    const { phase, pairings } = generateBracket(seeds, { seeded: true });
    expect(phase).toBe('quarterfinal');
    expect(pairings).toHaveLength(4);
  });

  test('generateBracket aleatorio incluye a todos los jugadores exactamente una vez', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    const { pairings } = generateBracket(seeds, { seeded: false });
    const allIds = pairings.flatMap((p) => [p.player1Id, p.player2Id]).sort();
    expect(allIds).toEqual([...seeds].sort());
  });
});
