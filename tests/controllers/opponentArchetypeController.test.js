jest.mock('../../src/models/OpponentArchetype');
jest.mock('../../src/models/Match');

const OpponentArchetype = require('../../src/models/OpponentArchetype');
const Match = require('../../src/models/Match');
const controller = require('../../src/controllers/opponentArchetypeController');

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

describe('opponentArchetypeController.update', () => {
  test('400 si no viene el nombre', async () => {
    const req = { body: {}, userId: USER_ID };
    const res = mockRes();

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('solo cambia sprites cuando no hay renombrado', async () => {
    OpponentArchetype.findOneAndUpdate.mockResolvedValue({ name: 'Charizard ex', sprite1: 's1' });

    const req = {
      body: { name: 'Charizard ex', sprite1: 's1', sprite2: null },
      userId: USER_ID,
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(Match.updateMany).not.toHaveBeenCalled();
    expect(OpponentArchetype.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: USER_ID, name: 'Charizard ex' },
      { name: 'Charizard ex', sprite1: 's1', sprite2: null },
      { new: true, upsert: true, runValidators: true }
    );
    expect(res.json).toHaveBeenCalled();
  });

  test('propaga el renombrado a las partidas ya registradas (issue #74)', async () => {
    Match.updateMany.mockResolvedValue({ modifiedCount: 3 });
    OpponentArchetype.findOneAndUpdate.mockResolvedValue({ name: 'Charizard ex' });

    const req = {
      body: { name: 'Charizar ex', newName: 'Charizard ex' },
      userId: USER_ID,
    };
    const res = mockRes();

    await controller.update(req, res);

    expect(Match.updateMany).toHaveBeenCalledWith(
      { userId: USER_ID, opponentDeck: 'Charizar ex' },
      { $set: { opponentDeck: 'Charizard ex' } }
    );
    expect(OpponentArchetype.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: USER_ID, name: 'Charizar ex' },
      expect.objectContaining({ name: 'Charizard ex' }),
      expect.anything()
    );
  });
});

describe('opponentArchetypeController.remove', () => {
  test('400 si no viene el nombre', async () => {
    const req = { body: {}, userId: USER_ID };
    const res = mockRes();

    await controller.remove(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('borra el archetype y sus partidas en cascada', async () => {
    OpponentArchetype.findOneAndDelete.mockResolvedValue({ name: 'Lost Box' });
    Match.deleteMany.mockResolvedValue({ deletedCount: 5 });

    const req = { body: { name: 'Lost Box' }, userId: USER_ID };
    const res = mockRes();

    await controller.remove(req, res);

    expect(OpponentArchetype.findOneAndDelete).toHaveBeenCalledWith({ userId: USER_ID, name: 'Lost Box' });
    expect(Match.deleteMany).toHaveBeenCalledWith({ userId: USER_ID, opponentDeck: 'Lost Box' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ deletedMatches: 5 })
    );
  });
});
