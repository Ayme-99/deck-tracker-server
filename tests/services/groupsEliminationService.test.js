const { assignGroups, calculateEliminationEntry } = require('../../src/services/groupsEliminationService');

describe('groupsEliminationService', () => {
  describe('assignGroups', () => {
    test('reparte 10 jugadores en grupos de 4 en 3 grupos (4,3,3)', () => {
      const players = Array.from({ length: 10 }, (_, i) => 'p' + i);
      const groups = assignGroups(players, 4);
      expect(groups).toHaveLength(3);
      expect(groups.reduce((sum, g) => sum + g.length, 0)).toBe(10);
      expect(groups.map((g) => g.length).sort()).toEqual([3, 3, 4]);
    });

    test('rechaza un tamaÃ±o de grupo menor que 2', () => {
      expect(() => assignGroups(['a', 'b'], 1)).toThrow();
    });
  });

  describe('calculateEliminationEntry', () => {
    // Ejemplo exacto del GDD: 10 clasificados -> target=quarterfinal,
    // 6 byes (mejores seeds) + 4 en ronda previa reducida (round_of_16)
    test('10 clasificados: 6 byes a cuartos + 4 en ronda previa', () => {
      const classified = Array.from({ length: 10 }, (_, i) => 'seed' + (i + 1));
      const result = calculateEliminationEntry(classified);

      expect(result.targetPhase).toBe('quarterfinal');
      expect(result.byeIds).toEqual(['seed1', 'seed2', 'seed3', 'seed4', 'seed5', 'seed6']);
      expect(result.preliminary.phase).toBe('round_of_16');
      expect(result.preliminary.pairings).toHaveLength(2);

      const prelimIds = result.preliminary.pairings.flatMap((p) => [p.player1Id, p.player2Id]).sort();
      expect(prelimIds).toEqual(['seed10', 'seed7', 'seed8', 'seed9'].sort());
    });

    test('nÂº de clasificados ya potencia de 2: sin ronda previa', () => {
      const classified = Array.from({ length: 8 }, (_, i) => 's' + i);
      const result = calculateEliminationEntry(classified);
      expect(result.preliminary).toBeNull();
      expect(result.byeIds).toHaveLength(8);
    });

    test('rechaza mas clasificados de los soportados', () => {
      const classified = Array.from({ length: 40 }, (_, i) => 'x' + i);
      expect(() => calculateEliminationEntry(classified)).toThrow();
    });

    test('rechaza menos de 2 clasificados', () => {
      expect(() => calculateEliminationEntry(['solo1'])).toThrow();
    });
  });
});
