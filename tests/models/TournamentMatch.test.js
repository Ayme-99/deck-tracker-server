const mongoose = require('mongoose');
const TournamentMatch = require('../../src/models/TournamentMatch');

describe('Modelo TournamentMatch', () => {
  const tId = new mongoose.Types.ObjectId();
  const p1 = new mongoose.Types.ObjectId();
  const p2 = new mongoose.Types.ObjectId();

  test('valida un match normal con premios', async () => {
    const match = new TournamentMatch({
      tournamentId: tId, phase: 'swiss', round: 1,
      player1Id: p1, player2Id: p2, winnerId: p1,
      player1Prizes: 6, player2Prizes: 3
    });
    await expect(match.validate()).resolves.toBeUndefined();
  });

  test('rechaza winnerId que no coincide con ninguno de los dos jugadores', async () => {
    const match = new TournamentMatch({
      tournamentId: tId, phase: 'swiss', round: 1,
      player1Id: p1, player2Id: p2, winnerId: new mongoose.Types.ObjectId()
    });
    await expect(match.validate()).rejects.toThrow(/winnerId/i);
  });

  test('rechaza player1Id igual a player2Id', async () => {
    const match = new TournamentMatch({ tournamentId: tId, phase: 'swiss', player1Id: p1, player2Id: p1 });
    await expect(match.validate()).rejects.toThrow(/mismo jugador/i);
  });

  test('permite un bye (player2Id null)', async () => {
    const match = new TournamentMatch({ tournamentId: tId, phase: 'swiss', round: 1, player1Id: p1 });
    await expect(match.validate()).resolves.toBeUndefined();
  });

  test('acepta un empate (isDraw true, sin winnerId)', async () => {
    const match = new TournamentMatch({
      tournamentId: tId, phase: 'swiss', round: 1, player1Id: p1, player2Id: p2, isDraw: true
    });
    await expect(match.validate()).resolves.toBeUndefined();
  });

  test('rechaza isDraw:true junto con winnerId', async () => {
    const match = new TournamentMatch({
      tournamentId: tId, phase: 'swiss', round: 1, player1Id: p1, player2Id: p2, isDraw: true, winnerId: p1
    });
    await expect(match.validate()).rejects.toThrow(/empate/i);
  });

  test('permite ida y vuelta enlazadas via tiedMatchId', async () => {
    const firstLeg = new TournamentMatch({ tournamentId: tId, phase: 'quarterfinal', player1Id: p1, player2Id: p2, leg: 'first_leg' });
    await firstLeg.validate();
    const secondLeg = new TournamentMatch({
      tournamentId: tId, phase: 'quarterfinal', player1Id: p2, player2Id: p1, leg: 'second_leg', tiedMatchId: firstLeg._id
    });
    await expect(secondLeg.validate()).resolves.toBeUndefined();
  });

  test('acepta leg sudden_death', async () => {
    const match = new TournamentMatch({
      tournamentId: tId, phase: 'quarterfinal', player1Id: p1, player2Id: p2, leg: 'sudden_death', winnerId: p2
    });
    await expect(match.validate()).resolves.toBeUndefined();
  });

  test('rechaza un leg fuera del enum', async () => {
    const match = new TournamentMatch({ tournamentId: tId, phase: 'swiss', player1Id: p1, player2Id: p2, leg: 'penalties' });
    await expect(match.validate()).rejects.toThrow();
  });
});
