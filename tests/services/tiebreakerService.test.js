const { matchWinPercentage, calculateOMW, MIN_MATCH_WIN_PERCENTAGE } = require('../../src/services/tiebreakerService');

describe('tiebreakerService', () => {
  describe('matchWinPercentage', () => {
    test('100% de victorias', () => {
      expect(matchWinPercentage({ wins: 2, losses: 0, draws: 0 })).toBe(1);
    });

    test('aplica el suelo del 33% cuando el resultado real es peor', () => {
      const pct = matchWinPercentage({ wins: 0, losses: 3, draws: 0 });
      expect(pct).toBeCloseTo(MIN_MATCH_WIN_PERCENTAGE, 5);
    });

    test('sin partidas jugadas cuenta como el suelo del 33%', () => {
      const pct = matchWinPercentage({ wins: 0, losses: 0, draws: 0 });
      expect(pct).toBeCloseTo(MIN_MATCH_WIN_PERCENTAGE, 5);
    });
  });

  describe('calculateOMW', () => {
    test('calcula la media del match-win% de los rivales', () => {
      const players = [
        { id: 'A', wins: 1, losses: 1, draws: 0, opponentIds: ['B', 'C'] },
        { id: 'B', wins: 3, losses: 0, draws: 0, opponentIds: ['A', 'x', 'y'] },
        { id: 'C', wins: 0, losses: 3, draws: 0, opponentIds: ['A', 'x', 'y'] }
      ];
      const omw = calculateOMW(players);
      const expected = (1 + MIN_MATCH_WIN_PERCENTAGE) / 2;
      expect(omw.get('A')).toBeCloseTo(expected, 5);
    });

    test('jugador sin rivales tiene OMW 0', () => {
      const players = [{ id: 'X', wins: 0, losses: 0, draws: 0, opponentIds: [] }];
      expect(calculateOMW(players).get('X')).toBe(0);
    });

    test('un rival inexistente (borrado) se ignora sin romper el calculo', () => {
      const players = [
        { id: 'A', wins: 1, losses: 0, draws: 0, opponentIds: ['B', 'borrado123'] },
        { id: 'B', wins: 2, losses: 0, draws: 0, opponentIds: ['A'] }
      ];
      expect(calculateOMW(players).get('A')).toBe(1);
    });
  });
});
