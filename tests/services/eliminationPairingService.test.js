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
    [16, 'round_of_16'],
    [32, 'round_of_32'],
    [64, 'round_of_64']
  ])('bracketPhaseForSize(%i) === %s', (size, expected) => {
    expect(bracketPhaseForSize(size)).toBe(expected);
  });

  test('bracketPhaseForSize rechaza mas de 64', () => {
    expect(() => bracketPhaseForSize(128)).toThrow();
  });

  test('nextPhase avanza correctamente y devuelve null tras final', () => {
    expect(nextPhase('quarterfinal')).toBe('semifinal');
    expect(nextPhase('round_of_32')).toBe('round_of_16');
    expect(nextPhase('final')).toBeNull();
  });

  test('previousPhase retrocede correctamente y devuelve null antes de round_of_64', () => {
    expect(previousPhase('quarterfinal')).toBe('round_of_16');
    expect(previousPhase('round_of_16')).toBe('round_of_32');
    expect(previousPhase('round_of_64')).toBeNull();
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

  test('generateBracket seeded con 32 jugadores arranca en round_of_32', () => {
    const seeds = Array.from({ length: 32 }, (_, i) => `s${i + 1}`);
    const { phase, pairings } = generateBracket(seeds, { seeded: true });
    expect(phase).toBe('round_of_32');
    expect(pairings).toHaveLength(16);
    expect(pairings[0]).toEqual({ player1Id: 's1', player2Id: 's32' });
  });

  test('generateBracket seeded con 64 jugadores arranca en round_of_64', () => {
    const seeds = Array.from({ length: 64 }, (_, i) => `s${i + 1}`);
    const { phase, pairings } = generateBracket(seeds, { seeded: true });
    expect(phase).toBe('round_of_64');
    expect(pairings).toHaveLength(32);
    expect(pairings[0]).toEqual({ player1Id: 's1', player2Id: 's64' });
  });

  test('generateBracket rechaza mas de 64 jugadores', () => {
    const seeds = Array.from({ length: 128 }, (_, i) => `s${i + 1}`);
    expect(() => generateBracket(seeds, { seeded: true })).toThrow();
  });
});
