const mongoose = require('mongoose');
const Tournament = require('../../src/models/Tournament');

describe('Modelo Tournament', () => {
  const baseTracked = {
    userId: 'user123',
    name: 'Liga local Julio',
    mode: 'tracked',
    structure: 'swiss',
    deckId: new mongoose.Types.ObjectId()
  };

  test('valida correctamente un torneo tracked completo', () => {
    const tournament = new Tournament(baseTracked);
    const error = tournament.validateSync();
    expect(error).toBeUndefined();
  });

  test('rechaza un torneo tracked sin structure', async () => {
    const tournament = new Tournament({ ...baseTracked, structure: undefined });
    // El chequeo de mode==='tracked' vive en un hook pre('validate'), que
    // validateSync() NO ejecuta (solo corre validadores sincronos del
    // schema). Hay que usar validate() (async) para que el hook se dispare.
    await expect(tournament.validate()).rejects.toThrow(/structure/i);
  });

  test('rechaza un torneo tracked sin deckId', async () => {
    const tournament = new Tournament({ ...baseTracked, deckId: undefined });
    await expect(tournament.validate()).rejects.toThrow(/deckId/i);
  });

  test('rechaza un torneo sin mode', () => {
    const tournament = new Tournament({ ...baseTracked, mode: undefined });
    const error = tournament.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.mode).toBeDefined();
  });

  test('rechaza un mode que no sea tracked ni hosted', () => {
    const tournament = new Tournament({ ...baseTracked, mode: 'invalid_mode' });
    const error = tournament.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.mode).toBeDefined();
  });

  test('rechaza una structure fuera del enum permitido', () => {
    const tournament = new Tournament({ ...baseTracked, structure: 'round_robin_invalido' });
    const error = tournament.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.structure).toBeDefined();
  });

  // En modo hosted, structure y deckId todavia no se exigen porque ese
  // modo esta pendiente de desarrollar (ver comentario TODO en el modelo,
  // issue #11). Este test documenta ese comportamiento actual a proposito;
  // si en el futuro se exige algo en hosted, este test debera actualizarse.
  test('un torneo hosted no exige structure ni deckId por ahora', () => {
    const tournament = new Tournament({
      userId: 'user123',
      name: 'Torneo de tienda',
      mode: 'hosted'
    });
    const error = tournament.validateSync();
    expect(error).toBeUndefined();
  });

  test('acepta snapshots de standing dentro de standingSnapshots', () => {
    const tournament = new Tournament({
      ...baseTracked,
      structure: 'league',
      standingSnapshots: [{ points: 9, position: 2, notes: 'Tras jornada 3' }]
    });
    const error = tournament.validateSync();
    expect(error).toBeUndefined();
    expect(tournament.standingSnapshots).toHaveLength(1);
    expect(tournament.standingSnapshots[0].points).toBe(9);
  });

  test('aplica los valores por defecto esperados', () => {
    const tournament = new Tournament(baseTracked);
    expect(tournament.format).toBe('Standard');
    expect(tournament.status).toBe('in_progress');
    expect(tournament.standingSnapshots).toEqual([]);
  });
});