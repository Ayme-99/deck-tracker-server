jest.mock('../../src/models/Tournament');
jest.mock('../../src/models/TournamentInvite');
jest.mock('../../src/models/TournamentPlayer');
jest.mock('../../src/models/FriendRequest');
jest.mock('../../src/models/Deck');
jest.mock('../../src/models/User');

const Tournament = require('../../src/models/Tournament');
const TournamentInvite = require('../../src/models/TournamentInvite');
const TournamentPlayer = require('../../src/models/TournamentPlayer');
const FriendRequest = require('../../src/models/FriendRequest');
const Deck = require('../../src/models/Deck');
const User = require('../../src/models/User');
const controller = require('../../src/controllers/tournamentInviteController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const USER_ID = 'organizer1';
const FRIEND_ID = 'friend1';

afterEach(() => {
  jest.clearAllMocks();
});

describe('tournamentInviteController.sendInvite', () => {
  test('404 si el torneo no existe (o no es del organizador)', async () => {
    Tournament.findOne.mockResolvedValue(null);
    const req = { params: { id: 'tid1' }, body: { userId: FRIEND_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.sendInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400 si no viene userId', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    const req = { params: { id: 'tid1' }, body: {}, userId: USER_ID };
    const res = mockRes();

    await controller.sendInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 si se intenta invitar a si mismo', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    const req = { params: { id: 'tid1' }, body: { userId: USER_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.sendInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('403 si no son amigos', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    FriendRequest.findOne.mockResolvedValue(null);
    const req = { params: { id: 'tid1' }, body: { userId: FRIEND_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.sendInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('400 si ya hay una invitacion pendiente para ese usuario en ese torneo', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    FriendRequest.findOne.mockResolvedValue({ status: 'accepted' });
    TournamentInvite.findOne.mockResolvedValue({ status: 'pending' });
    const req = { params: { id: 'tid1' }, body: { userId: FRIEND_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.sendInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('crea la invitacion si son amigos y no hay una pendiente ya', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    FriendRequest.findOne.mockResolvedValue({ status: 'accepted' });
    TournamentInvite.findOne.mockResolvedValue(null);
    TournamentInvite.create.mockResolvedValue({ _id: 'inv1', role: 'admin' });

    const req = { params: { id: 'tid1' }, body: { userId: FRIEND_ID, role: 'admin' }, userId: USER_ID };
    const res = mockRes();

    await controller.sendInvite(req, res);

    expect(TournamentInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentId: 'tid1', inviterUserId: USER_ID, inviteeUserId: FRIEND_ID, role: 'admin' })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('400 si role no es admin ni guest', async () => {
    Tournament.findOne.mockResolvedValue({ _id: 'tid1', userId: USER_ID });
    const req = { params: { id: 'tid1' }, body: { userId: FRIEND_ID, role: 'owner' }, userId: USER_ID };
    const res = mockRes();

    await controller.sendInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('tournamentInviteController.acceptInvite', () => {
  test('404 si la invitacion no existe o no es del usuario', async () => {
    TournamentInvite.findOne.mockResolvedValue(null);
    const req = { params: { id: 'inv1' }, body: { deckId: 'deck1' }, userId: FRIEND_ID };
    const res = mockRes();

    await controller.acceptInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400 si no viene deckId', async () => {
    TournamentInvite.findOne.mockResolvedValue({ status: 'pending' });
    const req = { params: { id: 'inv1' }, body: {}, userId: FRIEND_ID };
    const res = mockRes();

    await controller.acceptInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 si el mazo no existe o no es del invitado', async () => {
    TournamentInvite.findOne.mockResolvedValue({ status: 'pending', tournamentId: 'tid1', role: 'guest' });
    Deck.findOne.mockResolvedValue(null);
    const req = { params: { id: 'inv1' }, body: { deckId: 'deck1' }, userId: FRIEND_ID };
    const res = mockRes();

    await controller.acceptInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('crea el TournamentPlayer vinculado y marca la invitacion como aceptada', async () => {
    const invite = {
      status: 'pending', tournamentId: 'tid1', role: 'admin', save: jest.fn().mockResolvedValue(true)
    };
    TournamentInvite.findOne.mockResolvedValue(invite);
    Deck.findOne.mockResolvedValue({ _id: 'deck1', name: 'Charizard ex' });
    User.findById.mockResolvedValue({ username: 'Erik' });
    TournamentPlayer.create.mockResolvedValue({ _id: 'player1' });

    const req = { params: { id: 'inv1' }, body: { deckId: 'deck1' }, userId: FRIEND_ID };
    const res = mockRes();

    await controller.acceptInvite(req, res);

    expect(TournamentPlayer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tournamentId: 'tid1',
        name: 'Erik',
        deckArchetype: 'Charizard ex',
        linkedUserId: FRIEND_ID,
        role: 'admin',
        deckId: 'deck1'
      })
    );
    expect(invite.status).toBe('accepted');
    expect(invite.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});

describe('tournamentInviteController.rejectInvite', () => {
  test('404 si la invitacion no existe o no es del usuario', async () => {
    TournamentInvite.findOne.mockResolvedValue(null);
    const req = { params: { id: 'inv1' }, userId: FRIEND_ID };
    const res = mockRes();

    await controller.rejectInvite(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rechaza la invitacion correctamente', async () => {
    const invite = { status: 'pending', save: jest.fn().mockResolvedValue(true) };
    TournamentInvite.findOne.mockResolvedValue(invite);

    const req = { params: { id: 'inv1' }, userId: FRIEND_ID };
    const res = mockRes();

    await controller.rejectInvite(req, res);

    expect(invite.status).toBe('rejected');
    expect(invite.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});
