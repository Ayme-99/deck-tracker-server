const mongoose = require('mongoose');
const TournamentPlayer = require('../../src/models/TournamentPlayer');

describe('Modelo TournamentPlayer', () => {
  const tId = new mongoose.Types.ObjectId();

  test('valida un jugador completo con todos los campos nuevos', async () => {
    const player = new TournamentPlayer({
      tournamentId: tId,
      name: 'Erik',
      deckArchetype: 'Charizard ex',
      points: 6,
      wins: 2,
      losses: 0,
      draws: 0,
      prizeDifferential: 8,
      isOrganizer: true,
      deckId: new mongoose.Types.ObjectId()
    });
    await expect(player.validate()).resolves.toBeUndefined();
  });

  test('aplica los valores por defecto esperados', async () => {
    const player = new TournamentPlayer({ tournamentId: tId, name: 'Rival' });
    await player.validate();
    expect(player.points).toBe(0);
    expect(player.wins).toBe(0);
    expect(player.losses).toBe(0);
    expect(player.draws).toBe(0);
    expect(player.prizeDifferential).toBe(0);
    expect(player.dropped).toBe(false);
    expect(player.byeReceived).toBe(false);
    expect(player.isOrganizer).toBe(false);
    expect(player.deckId).toBeNull();
    expect(player.groupName).toBeNull();
    expect(player.opponentIds).toEqual([]);
  });

  test('rechaza un jugador sin name', async () => {
    const player = new TournamentPlayer({ tournamentId: tId });
    await expect(player.validate()).rejects.toThrow(/name/i);
  });

  test('acepta un array de opponentIds', async () => {
    const rivalId = new mongoose.Types.ObjectId();
    const player = new TournamentPlayer({ tournamentId: tId, name: 'Con rival', opponentIds: [rivalId] });
    await player.validate();
    expect(player.opponentIds).toHaveLength(1);
  });

  // El hook pre('validate') que exige deckId cuando isOrganizer es true vive
  // en un hook async, que validateSync() no dispara (ver bug de #18) -- se
  // usa validate() para estos dos casos.
  test('rechaza isOrganizer:true sin deckId', async () => {
    const player = new TournamentPlayer({ tournamentId: tId, name: 'Ayme', isOrganizer: true });
    await expect(player.validate()).rejects.toThrow(/deckId/i);
  });

  test('acepta isOrganizer:true con deckId', async () => {
    const player = new TournamentPlayer({
      tournamentId: tId, name: 'Ayme', isOrganizer: true, deckId: new mongoose.Types.ObjectId()
    });
    await expect(player.validate()).resolves.toBeUndefined();
  });

  // Issue #94: linkedUserId/role (vincular a la cuenta de un amigo)
  describe('linkedUserId / role', () => {
    test('por defecto son null', async () => {
      const player = new TournamentPlayer({ tournamentId: tId, name: 'Sin vincular' });
      await player.validate();
      expect(player.linkedUserId).toBeNull();
      expect(player.role).toBeNull();
    });

    test('rechaza linkedUserId sin deckId', async () => {
      const player = new TournamentPlayer({
        tournamentId: tId, name: 'Amigo', linkedUserId: new mongoose.Types.ObjectId(), role: 'admin'
      });
      await expect(player.validate()).rejects.toThrow(/deckId/i);
    });

    test('acepta linkedUserId con deckId y role admin', async () => {
      const player = new TournamentPlayer({
        tournamentId: tId,
        name: 'Amigo admin',
        linkedUserId: new mongoose.Types.ObjectId(),
        role: 'admin',
        deckId: new mongoose.Types.ObjectId()
      });
      await expect(player.validate()).resolves.toBeUndefined();
    });

    test('acepta linkedUserId con deckId y role guest', async () => {
      const player = new TournamentPlayer({
        tournamentId: tId,
        name: 'Amigo invitado',
        linkedUserId: new mongoose.Types.ObjectId(),
        role: 'guest',
        deckId: new mongoose.Types.ObjectId()
      });
      await expect(player.validate()).resolves.toBeUndefined();
    });

    test('rechaza un role que no sea admin ni guest', async () => {
      const player = new TournamentPlayer({
        tournamentId: tId,
        name: 'Rol invalido',
        linkedUserId: new mongoose.Types.ObjectId(),
        role: 'owner',
        deckId: new mongoose.Types.ObjectId()
      });
      await expect(player.validate()).rejects.toThrow();
    });
  });
});
