jest.mock('../../src/models/Tournament');
jest.mock('../../src/models/TournamentPlayer');
jest.mock('../../src/models/TournamentMatch');
jest.mock('../../src/models/Match');

const Tournament = require('../../src/models/Tournament');
const TournamentPlayer = require('../../src/models/TournamentPlayer');
const TournamentMatch = require('../../src/models/TournamentMatch');
const Match = require('../../src/models/Match');
// Este archivo cubre handlers de varios controllers distintos tras la
// division del monolito "rounds" (issue #78, continuacion de la Fase 3
// del refactor #115/#76): swiss, eliminacion, grupos/liga, resultados y
// transfer. Se fusionan en un unico objeto `controller` para no tener que
// renombrar cada `controller.xxx` de los tests.
const swissController = require('../../src/controllers/tournament/tournamentSwissController');
const eliminationController = require('../../src/controllers/tournament/tournamentEliminationController');
const groupsLeagueController = require('../../src/controllers/tournament/tournamentGroupsLeagueController');
const resultsController = require('../../src/controllers/tournament/tournamentResultsController');
const transferController = require('../../src/controllers/tournament/tournamentTransferController');
const controller = {
  ...swissController,
  ...eliminationController,
  ...groupsLeagueController,
  ...resultsController,
  ...transferController
};

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const USER_ID = 'user1';

afterEach(() => {
  jest.clearAllMocks();
});

describe('generateSwissRound', () => {
  test('genera pairings y resuelve el bye automaticamente (3 jugadores)', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    TournamentPlayer.find.mockResolvedValue([
      { _id: 'p1', points: 0, opponentIds: [], byeReceived: false, dropped: false },
      { _id: 'p2', points: 0, opponentIds: [], byeReceived: false, dropped: false },
      { _id: 'p3', points: 0, opponentIds: [], byeReceived: false, dropped: false }
    ]);
    TournamentMatch.find.mockResolvedValue([]); // sin rondas swiss previas
    TournamentMatch.create.mockImplementation(async (data) => ({ ...data, _id: 'm' + Math.random() }));
    TournamentPlayer.findByIdAndUpdate.mockResolvedValue({});

    const req = { params: { id: 'tid1' }, userId: USER_ID };
    const res = mockRes();
    await controller.generateSwissRound(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const { matches, round } = res.json.mock.calls[0][0];
    expect(round).toBe(1);
    expect(matches).toHaveLength(2); // 1 pairing + 1 bye

    const byeMatch = matches.find((m) => m.player2Id === null);
    expect(byeMatch.status).toBe('completed');
    expect(byeMatch.winnerId).toBe(byeMatch.player1Id);

    const byeUpdateCall = TournamentPlayer.findByIdAndUpdate.mock.calls.find(
      (call) => call[1].byeReceived === true
    );
    expect(byeUpdateCall[1]).toMatchObject({ byeReceived: true, $inc: { points: 3, wins: 1 } });
  });

  test('404 si el torneo no existe', async () => {
    Tournament.findOne.mockResolvedValue(null);
    const req = { params: { id: 'x' }, userId: USER_ID };
    const res = mockRes();
    await controller.generateSwissRound(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400 si hay menos de 2 jugadores activos', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    TournamentPlayer.find.mockResolvedValue([{ _id: 'p1' }]);
    const req = { params: { id: 'tid1' }, userId: USER_ID };
    const res = mockRes();
    await controller.generateSwissRound(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('registerMatchResult', () => {
  test('actualiza puntuacion y genera Match real para el jugador organizador', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    const tMatch = { _id: 'm1', player1Id: 'p1', player2Id: 'p2', phase: 'swiss', round: 2, save: jest.fn() };
    TournamentMatch.findOne.mockResolvedValue(tMatch);

    const player1 = {
      _id: 'p1', isOrganizer: true, deckId: 'deck123', deckArchetype: 'A',
      wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, save: jest.fn()
    };
    const player2 = {
      _id: 'p2', isOrganizer: false, deckId: null, name: 'Rival', deckArchetype: 'Charizard ex',
      wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, save: jest.fn()
    };
    TournamentPlayer.findById.mockImplementation(async (id) => (id === 'p1' ? player1 : player2));
    Match.create.mockResolvedValue({});

    const req = {
      params: { id: 'tid1', matchId: 'm1' },
      userId: USER_ID,
      body: { player1Prizes: 6, player2Prizes: 2, winnerId: 'p1', isDraw: false }
    };
    const res = mockRes();
    await controller.registerMatchResult(req, res);

    expect(player1.wins).toBe(1);
    expect(player1.points).toBe(3);
    expect(player1.prizeDifferential).toBe(4);
    expect(player2.losses).toBe(1);
    expect(player2.prizeDifferential).toBe(-4);

    // Solo se crea un Match real (el del organizador), no el del rival normal
    expect(Match.create).toHaveBeenCalledTimes(1);
    expect(Match.create).toHaveBeenCalledWith(
      expect.objectContaining({ deckId: 'deck123', opponentDeck: 'Charizard ex', userPrizes: 6, opponentPrizes: 2, phase: 'swiss', round: 2 })
    );
  });

  test('un empate no genera ganador ni actualiza wins/losses', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    const tMatch = { _id: 'm1', player1Id: 'p1', player2Id: 'p2', phase: 'league_round', round: 1, save: jest.fn() };
    TournamentMatch.findOne.mockResolvedValue(tMatch);

    const player1 = { _id: 'p1', isOrganizer: false, wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, save: jest.fn() };
    const player2 = { _id: 'p2', isOrganizer: false, wins: 0, losses: 0, draws: 0, points: 0, prizeDifferential: 0, save: jest.fn() };
    TournamentPlayer.findById.mockImplementation(async (id) => (id === 'p1' ? player1 : player2));

    const req = {
      params: { id: 'tid1', matchId: 'm1' },
      userId: USER_ID,
      body: { player1Prizes: 3, player2Prizes: 3, isDraw: true }
    };
    const res = mockRes();
    await controller.registerMatchResult(req, res);

    expect(player1.draws).toBe(1);
    expect(player2.draws).toBe(1);
    expect(player1.points).toBe(1);
    expect(player2.points).toBe(1);
    expect(tMatch.winnerId).toBeNull();
    expect(Match.create).not.toHaveBeenCalled();
  });
});

describe('getHostedStandings', () => {
  test('en groups_elimination, ignora las victorias de la eliminatoria y usa solo group_stage', async () => {
    // Issue #205: p1.wins/points estan "contaminados" con una victoria de
    // la eliminatoria (fase posterior a los grupos) ademas de la de grupos.
    // La clasificacion de grupos debe reflejar solo el group_stage.
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID, structure: 'groups_elimination' });
    const players = [
      {
        _id: 'p1', name: 'A', deckArchetype: 'Charizard ex', groupName: 'Grupo 1', dropped: false,
        wins: 2, losses: 0, draws: 0, points: 6, prizeDifferential: 10, opponentIds: ['p2', 'p3']
      },
      {
        _id: 'p2', name: 'B', deckArchetype: 'Gardevoir ex', groupName: 'Grupo 1', dropped: false,
        wins: 0, losses: 1, draws: 0, points: 0, prizeDifferential: -5, opponentIds: ['p1']
      }
    ];
    TournamentPlayer.find.mockResolvedValue(players);

    TournamentMatch.find.mockResolvedValue([
      // Partida de grupos: p1 gana 6-1 (esta si cuenta)
      { player1Id: 'p1', player2Id: 'p2', winnerId: 'p1', isDraw: false, player1Prizes: 6, player2Prizes: 1 }
    ]);

    const req = { params: { id: 'tid1' }, userId: USER_ID };
    const res = mockRes();
    await controller.getHostedStandings(req, res);

    expect(TournamentMatch.find).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentId: 'tid1', phase: 'group_stage', status: 'completed' })
    );

    const { standings } = res.json.mock.calls[0][0];
    const a = standings.find((s) => s.playerId === 'p1');
    // Sin el fix, esto seria wins: 2, points: 6 (arrastrando la victoria de la eliminatoria)
    expect(a.wins).toBe(1);
    expect(a.points).toBe(3);
    expect(a.prizeDifferential).toBe(5);
  });

  test('en swiss (sin grupos), usa los contadores acumulados del jugador tal cual', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID, structure: 'swiss' });
    TournamentPlayer.find.mockResolvedValue([
      { _id: 'p1', name: 'A', dropped: false, wins: 3, losses: 1, draws: 0, points: 9, prizeDifferential: 8, opponentIds: [] }
    ]);

    const req = { params: { id: 'tid1' }, userId: USER_ID };
    const res = mockRes();
    await controller.getHostedStandings(req, res);

    expect(TournamentMatch.find).not.toHaveBeenCalled();
    const { standings } = res.json.mock.calls[0][0];
    expect(standings[0]).toMatchObject({ wins: 3, losses: 1, points: 9, prizeDifferential: 8 });
  });
});

describe('closePhaseToElimination', () => {
  test('swiss_elimination sin ronda previa (extra=0): empareja de verdad, sin byes falsos', async () => {
    const tournamentDoc = { _id: 'tid1', userId: USER_ID, structure: 'swiss_elimination', eliminationFormat: 'single_match', save: jest.fn() };
    Tournament.findOne.mockResolvedValue(tournamentDoc);
    const sortedPlayers = Array.from({ length: 8 }, (_, i) => ({ _id: 'p' + (i + 1), points: 24 - i, prizeDifferential: 10 - i }));
    TournamentPlayer.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(sortedPlayers) });
    TournamentMatch.create.mockImplementation(async (data) => ({ ...data, _id: 'm' + Math.random(), save: jest.fn() }));

    const req = { params: { id: 'tid1' }, userId: USER_ID, body: { topCut: 4 } };
    const res = mockRes();
    await controller.closePhaseToElimination(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.targetPhase).toBe('semifinal');
    expect(body.preliminaryPhase).toBeNull();
    // 2 partidas REALES (seededPairings: p1 vs p4, p2 vs p3), no 4 byes falsos
    expect(body.matches).toHaveLength(2);
    expect(body.matches.every((m) => m.status === undefined || m.status !== 'completed')).toBe(true);
    // No hizo falta guardar nada pendiente (sin ronda previa)
    expect(tournamentDoc.save).not.toHaveBeenCalled();
  });

  test('swiss_elimination con ronda previa (extra>0): guarda classifiedIds pendientes', async () => {
    const tournamentDoc = { _id: 'tid1', userId: USER_ID, structure: 'swiss_elimination', eliminationFormat: 'single_match', save: jest.fn() };
    Tournament.findOne.mockResolvedValue(tournamentDoc);
    const sortedPlayers = Array.from({ length: 10 }, (_, i) => ({ _id: 'seed' + (i + 1), points: 20 - i, prizeDifferential: 10 - i }));
    TournamentPlayer.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(sortedPlayers) });
    TournamentMatch.create.mockImplementation(async (data) => ({ ...data, _id: 'm' + Math.random(), save: jest.fn() }));

    const req = { params: { id: 'tid1' }, userId: USER_ID, body: { topCut: 10 } };
    const res = mockRes();
    await controller.closePhaseToElimination(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.preliminaryPhase).toBe('round_of_16');
    // Solo se crean las 2 partidas de la ronda previa, nada en targetPhase todavia
    expect(body.matches).toHaveLength(2);
    // Se persisten los 10 classifiedIds para resolvePreliminaryEntry
    expect(tournamentDoc.save).toHaveBeenCalled();
    expect(tournamentDoc.pendingEliminationClassifiedIds).toHaveLength(10);
  });

  test('rechaza una estructura que no es swiss_elimination ni groups_elimination', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID, structure: 'league' });
    const req = { params: { id: 'tid1' }, userId: USER_ID, body: {} };
    const res = mockRes();
    await controller.closePhaseToElimination(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('resolvePreliminaryEntry', () => {
  test('lee classifiedIds del torneo (sin body) y genera la fase destino', async () => {
    const classifiedIds = Array.from({ length: 10 }, (_, i) => 'seed' + (i + 1));
    const tournamentDoc = {
      _id: 'tid1', userId: USER_ID, eliminationFormat: 'single_match',
      pendingEliminationClassifiedIds: classifiedIds,
      save: jest.fn()
    };
    Tournament.findOne.mockResolvedValue(tournamentDoc);

    const prelimMatches = [
      { _id: 'pm1', phase: 'round_of_16', player1Id: 'seed7', player2Id: 'seed10', winnerId: 'seed7', leg: 'single', status: 'completed', tiedMatchId: null },
      { _id: 'pm2', phase: 'round_of_16', player1Id: 'seed8', player2Id: 'seed9', winnerId: 'seed9', leg: 'single', status: 'completed', tiedMatchId: null }
    ];
    TournamentMatch.find.mockResolvedValue(prelimMatches);
    TournamentMatch.create.mockImplementation(async (data) => ({ ...data, _id: 'm' + Math.random(), save: jest.fn() }));

    const req = { params: { id: 'tid1' }, userId: USER_ID, body: {} };
    const res = mockRes();
    await controller.resolvePreliminaryEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.phase).toBe('quarterfinal');
    expect(body.matches).toHaveLength(4); // 6 byes + 2 ganadores = 8 -> 4 partidos
    // Se limpia el estado pendiente tras resolver
    expect(tournamentDoc.pendingEliminationClassifiedIds).toEqual([]);
    expect(tournamentDoc.save).toHaveBeenCalled();
  });

  test('400 si no hay nada pendiente que resolver', async () => {
    const tournamentDoc = { _id: 'tid1', userId: USER_ID, pendingEliminationClassifiedIds: [], save: jest.fn() };
    Tournament.findOne.mockResolvedValue(tournamentDoc);

    const req = { params: { id: 'tid1' }, userId: USER_ID, body: {} };
    const res = mockRes();
    await controller.resolvePreliminaryEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('importTournament', () => {
  test('remapea IDs de jugadores, opponentIds, matches y tiedMatchId; vincula al organizador', async () => {
    const exportedData = {
      tournament: { name: 'Liga importada', structure: 'swiss' },
      players: [
        { _id: 'OLD_p1', name: 'Ana', opponentIds: ['OLD_p2'], points: 3, wins: 1, losses: 0, draws: 0, prizeDifferential: 3, byeReceived: false, groupName: null, dropped: false },
        { _id: 'OLD_p2', name: 'Bea', opponentIds: ['OLD_p1'], points: 0, wins: 0, losses: 1, draws: 0, prizeDifferential: -3, byeReceived: false, groupName: null, dropped: false }
      ],
      matches: [
        { _id: 'OLD_m1', phase: 'quarterfinal', player1Id: 'OLD_p1', player2Id: 'OLD_p2', winnerId: 'OLD_p1', status: 'completed', isDraw: false, leg: 'first_leg', tiedMatchId: 'OLD_m2' },
        { _id: 'OLD_m2', phase: 'quarterfinal', player1Id: 'OLD_p2', player2Id: 'OLD_p1', winnerId: null, status: 'pending', isDraw: false, leg: 'second_leg', tiedMatchId: 'OLD_m1' }
      ]
    };

    Tournament.create.mockImplementation(async (data) => ({ ...data, _id: 'NEW_tid' }));
    let playerCounter = 0;
    TournamentPlayer.create.mockImplementation(async (data) => { playerCounter++; return { ...data, _id: 'NEW_p' + playerCounter }; });
    TournamentPlayer.findByIdAndUpdate.mockResolvedValue({});
    let matchCounter = 0;
    TournamentMatch.create.mockImplementation(async (data) => { matchCounter++; return { ...data, _id: 'NEW_m' + matchCounter }; });
    TournamentMatch.findByIdAndUpdate.mockResolvedValue({});

    const req = {
      userId: 'importer',
      body: { data: exportedData, selfPlayerId: 'OLD_p1', selfDeckId: 'myRealDeck' }
    };
    const res = mockRes();
    await controller.importTournament(req, res);

    expect(Tournament.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'hosted', userId: 'importer' }));

    const anaCreateCall = TournamentPlayer.create.mock.calls.find((c) => c[0].name === 'Ana')[0];
    expect(anaCreateCall.isOrganizer).toBe(true);
    expect(anaCreateCall.deckId).toBe('myRealDeck');

    const beaCreateCall = TournamentPlayer.create.mock.calls.find((c) => c[0].name === 'Bea')[0];
    expect(beaCreateCall.isOrganizer).toBe(false);

    // opponentIds remapeados a los nuevos IDs (segunda pasada)
    const opponentUpdateCalls = TournamentPlayer.findByIdAndUpdate.mock.calls;
    expect(opponentUpdateCalls.some((c) => c[1].opponentIds && c[1].opponentIds.length === 1)).toBe(true);

    // tiedMatchId remapeado (segunda pasada)
    const tiedUpdateCalls = TournamentMatch.findByIdAndUpdate.mock.calls;
    expect(tiedUpdateCalls.length).toBeGreaterThan(0);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.playersCreated).toBe(2);
    expect(body.matchesCreated).toBe(2);
  });

  test('400 si se indica selfPlayerId sin selfDeckId', async () => {
    const req = { userId: 'importer', body: { data: { tournament: {}, players: [], matches: [] }, selfPlayerId: 'x' } };
    const res = mockRes();
    await controller.importTournament(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
