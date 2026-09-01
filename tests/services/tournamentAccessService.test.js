jest.mock('../../src/models/Tournament');
jest.mock('../../src/models/TournamentPlayer');

const Tournament = require('../../src/models/Tournament');
const TournamentPlayer = require('../../src/models/TournamentPlayer');
const { findReadableTournament } = require('../../src/services/tournamentAccessService');

const USER_ID = 'user123';
const TOURNAMENT_ID = 'tid1';

afterEach(() => {
  jest.clearAllMocks();
});

describe('tournamentAccessService.findReadableTournament', () => {
  test('devuelve el torneo directamente si el usuario es el dueño', async () => {
    const tournament = { _id: TOURNAMENT_ID, userId: USER_ID };
    Tournament.findOne.mockResolvedValue(tournament);

    const result = await findReadableTournament(TOURNAMENT_ID, USER_ID);

    expect(result).toBe(tournament);
    expect(TournamentPlayer.findOne).not.toHaveBeenCalled();
  });

  test('devuelve el torneo si no es el dueño pero tiene una inscripcion vinculada', async () => {
    Tournament.findOne.mockResolvedValue(null);
    TournamentPlayer.findOne.mockResolvedValue({ linkedUserId: USER_ID });
    const tournament = { _id: TOURNAMENT_ID };
    Tournament.findById.mockResolvedValue(tournament);

    const result = await findReadableTournament(TOURNAMENT_ID, USER_ID);

    expect(TournamentPlayer.findOne).toHaveBeenCalledWith({ tournamentId: TOURNAMENT_ID, linkedUserId: USER_ID });
    expect(result).toBe(tournament);
  });

  test('devuelve null si no es el dueño ni tiene inscripcion vinculada', async () => {
    Tournament.findOne.mockResolvedValue(null);
    TournamentPlayer.findOne.mockResolvedValue(null);

    const result = await findReadableTournament(TOURNAMENT_ID, USER_ID);

    expect(result).toBeNull();
    expect(Tournament.findById).not.toHaveBeenCalled();
  });
});
