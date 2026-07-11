const mongoose = require('mongoose');
const Match = require('../../src/models/Match');

// Campos minimos requeridos por el schema de Match ademas de los propios
// de torneo, para que los tests se centren solo en lo que toca al #13/#18.
// Si el schema de Match exige mas campos obligatorios, ajustar este objeto.
const baseMatch = {
  userId: 'user123',
  deckId: new mongoose.Types.ObjectId(),
  opponentDeck: 'Rival test',
  userPrizes: 6,
  opponentPrizes: 3
};

describe('Modelo Match - campos de torneo', () => {
  test('permite crear un match suelto, sin tournamentId/phase/round', () => {
    const match = new Match(baseMatch);
    const error = match.validateSync();
    expect(error).toBeUndefined();
    expect(match.tournamentId).toBeNull();
    expect(match.phase).toBeNull();
    expect(match.round).toBeNull();
  });

  test('permite crear un match asociado a un torneo con phase y round', () => {
    const match = new Match({
      ...baseMatch,
      tournamentId: new mongoose.Types.ObjectId(),
      phase: 'swiss',
      round: 3
    });
    const error = match.validateSync();
    expect(error).toBeUndefined();
  });

  test('rechaza phase sin tournamentId', async () => {
    const match = new Match({ ...baseMatch, phase: 'swiss' });
    // Igual que en Tournament: la validacion cruzada vive en un hook
    // pre('validate'), que validateSync() no dispara. Usamos validate() async.
    await expect(match.validate()).rejects.toThrow(/tournamentId/i);
  });

  test('rechaza round sin tournamentId', async () => {
    const match = new Match({ ...baseMatch, round: 1 });
    await expect(match.validate()).rejects.toThrow(/tournamentId/i);
  });

  test('rechaza una phase fuera del enum permitido', () => {
    const match = new Match({
      ...baseMatch,
      tournamentId: new mongoose.Types.ObjectId(),
      phase: 'fase_inventada'
    });
    const error = match.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.phase).toBeDefined();
  });

  test('permite una fase de eliminatoria directa sin round', () => {
    const match = new Match({
      ...baseMatch,
      tournamentId: new mongoose.Types.ObjectId(),
      phase: 'quarterfinal'
    });
    const error = match.validateSync();
    expect(error).toBeUndefined();
  });
});