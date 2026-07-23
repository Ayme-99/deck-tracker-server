jest.mock('../../src/models/Tournament');
jest.mock('../../src/models/Match');

const Tournament = require('../../src/models/Tournament');
const Match = require('../../src/models/Match');
const tournamentController = require('../../src/controllers/tournament/tournamentCrudController');

// Helper para simular req/res de Express sin levantar un servidor real
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const USER_ID = 'user123';

afterEach(() => {
  jest.clearAllMocks();
});

describe('tournamentController.getTournaments', () => {
  test('devuelve data + pagination', async () => {
    Tournament.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ name: 'Torneo 1' }])
    });
    Tournament.countDocuments.mockResolvedValue(1);

    const req = { query: {}, userId: USER_ID };
    const res = mockRes();
    await tournamentController.getTournaments(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ name: 'Torneo 1' }],
      pagination: expect.objectContaining({ total: 1 })
    }));
  });
});

describe('tournamentController.getTournamentById', () => {
  test('404 si el torneo no existe', async () => {
    Tournament.findOne.mockResolvedValue(null);
    const req = { params: { id: 'abc' }, userId: USER_ID };
    const res = mockRes();

    await tournamentController.getTournamentById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Torneo no encontrado' });
  });

  test('devuelve el torneo junto a sus matches', async () => {
    const tournamentDoc = {
      toObject: () => ({ _id: 'abc', name: 'Torneo test' })
    };
    Tournament.findOne.mockResolvedValue(tournamentDoc);
    Match.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ result: 'win' }]) });

    const req = { params: { id: 'abc' }, userId: USER_ID };
    const res = mockRes();
    await tournamentController.getTournamentById(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Torneo test',
      matches: [{ result: 'win' }]
    }));
  });
});

describe('tournamentController.createTournament', () => {
  test('crea el torneo con el userId del request', async () => {
    const saveMock = jest.fn().mockResolvedValue();
    Tournament.mockImplementation(function (data) {
      Object.assign(this, data);
      this.save = saveMock;
    });

    const req = { body: { name: 'Nuevo torneo', mode: 'tracked' }, userId: USER_ID };
    const res = mockRes();
    await tournamentController.createTournament(req, res);

    expect(Tournament).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
    expect(saveMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('400 si falla la validacion del modelo', async () => {
    Tournament.mockImplementation(function () {
      this.save = jest.fn().mockRejectedValue(new Error('El campo structure es obligatorio en torneos de modo "tracked"'));
    });

    const req = { body: { name: 'Incompleto', mode: 'tracked' }, userId: USER_ID };
    const res = mockRes();
    await tournamentController.createTournament(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('tournamentController.deleteTournament', () => {
  test('404 si el torneo no existe', async () => {
    Tournament.findOneAndDelete.mockResolvedValue(null);
    const req = { params: { id: 'abc' }, userId: USER_ID };
    const res = mockRes();

    await tournamentController.deleteTournament(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('desvincula los matches en vez de borrarlos', async () => {
    Tournament.findOneAndDelete.mockResolvedValue({ _id: 'abc' });
    Match.updateMany.mockResolvedValue({ modifiedCount: 3 });

    const req = { params: { id: 'abc' }, userId: USER_ID };
    const res = mockRes();
    await tournamentController.deleteTournament(req, res);

    expect(Match.updateMany).toHaveBeenCalledWith(
      { tournamentId: 'abc', userId: USER_ID },
      { $set: { tournamentId: null, phase: null, round: null } }
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ unlinkedMatches: 3 }));
  });
});

describe('tournamentController.addStandingSnapshot', () => {
  test('404 si el torneo no existe', async () => {
    Tournament.findOne.mockResolvedValue(null);
    const req = { params: { id: 'abc' }, body: {}, userId: USER_ID };
    const res = mockRes();

    await tournamentController.addStandingSnapshot(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400 si el torneo no es de tipo league', async () => {
    Tournament.findOne.mockResolvedValue({ structure: 'swiss' });
    const req = { params: { id: 'abc' }, body: { points: 9, position: 2 }, userId: USER_ID };
    const res = mockRes();

    await tournamentController.addStandingSnapshot(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringMatching(/league/i)
    }));
  });

  test('añade el snapshot cuando el torneo es de tipo league', async () => {
    const tournamentDoc = {
      structure: 'league',
      standingSnapshots: { push: jest.fn() },
      save: jest.fn().mockResolvedValue()
    };
    Tournament.findOne.mockResolvedValue(tournamentDoc);

    const req = { params: { id: 'abc' }, body: { points: 9, position: 2, notes: 'Jornada 3' }, userId: USER_ID };
    const res = mockRes();
    await tournamentController.addStandingSnapshot(req, res);

    expect(tournamentDoc.standingSnapshots.push).toHaveBeenCalledWith({
      points: 9,
      position: 2,
      notes: 'Jornada 3'
    });
    expect(tournamentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('tournamentController.getTournamentSummary', () => {
  const VALID_ID = '507f1f77bcf86cd799439011';

  test('404 si el torneo no existe', async () => {
    Tournament.findOne.mockResolvedValue(null);
    const req = { params: { id: VALID_ID }, userId: USER_ID };
    const res = mockRes();

    await tournamentController.getTournamentSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('calcula overall a partir del desglose por fase', async () => {
    Tournament.findOne.mockResolvedValue({ _id: VALID_ID });
    Match.aggregate.mockResolvedValue([
      { phase: 'swiss', totalMatches: 3, wins: 2, losses: 1, ties: 0, winRate: 66.7 },
      { phase: 'quarterfinal', totalMatches: 1, wins: 1, losses: 0, ties: 0, winRate: 100 }
    ]);

    const req = { params: { id: VALID_ID }, userId: USER_ID };
    const res = mockRes();
    await tournamentController.getTournamentSummary(req, res);

    expect(res.json).toHaveBeenCalledWith({
      overall: {
        totalMatches: 4,
        wins: 3,
        losses: 1,
        ties: 0,
        winRate: 75
      },
      byPhase: expect.any(Array)
    });
  });

  test('overall con winRate 0 cuando no hay partidas', async () => {
    Tournament.findOne.mockResolvedValue({ _id: VALID_ID });
    Match.aggregate.mockResolvedValue([]);

    const req = { params: { id: VALID_ID }, userId: USER_ID };
    const res = mockRes();
    await tournamentController.getTournamentSummary(req, res);

    expect(res.json).toHaveBeenCalledWith({
      overall: { totalMatches: 0, wins: 0, losses: 0, ties: 0, winRate: 0 },
      byPhase: []
    });
  });
});