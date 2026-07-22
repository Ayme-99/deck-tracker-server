jest.mock('../../src/models/Match');
jest.mock('../../src/models/Deck');

const Match = require('../../src/models/Match');
const Deck = require('../../src/models/Deck');
const matchController = require('../../src/controllers/matchController');

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

describe('matchController.createMatch', () => {
  test('toca el updatedAt del mazo tras registrar la partida (issue #98)', async () => {
    const saveMock = jest.fn().mockResolvedValue();
    Match.mockImplementation(function (data) {
      Object.assign(this, data);
      this.save = saveMock;
    });
    Deck.findOneAndUpdate.mockResolvedValue({});

    const req = {
      body: { deckId: 'deck1', opponentDeck: 'Rival', userPrizes: 6, opponentPrizes: 2 },
      userId: USER_ID,
    };
    const res = mockRes();

    await matchController.createMatch(req, res);

    expect(saveMock).toHaveBeenCalled();
    expect(Deck.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'deck1', userId: USER_ID },
      { updatedAt: expect.any(Date) }
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('devuelve 400 si falla el guardado de la partida', async () => {
    const saveMock = jest.fn().mockRejectedValue(new Error('validacion fallida'));
    Match.mockImplementation(function (data) {
      Object.assign(this, data);
      this.save = saveMock;
    });

    const req = { body: { deckId: 'deck1' }, userId: USER_ID };
    const res = mockRes();

    await matchController.createMatch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(Deck.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
