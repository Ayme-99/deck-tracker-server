jest.mock('../../src/models/FriendRequest');
jest.mock('../../src/models/User');

const FriendRequest = require('../../src/models/FriendRequest');
const User = require('../../src/models/User');
const controller = require('../../src/controllers/friendController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const USER_ID = 'user123';
const OTHER_ID = 'user456';

afterEach(() => {
  jest.clearAllMocks();
});

describe('friendController.sendRequest', () => {
  test('400 si no viene el username', async () => {
    const req = { body: {}, userId: USER_ID };
    const res = mockRes();

    await controller.sendRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 si el usuario no existe', async () => {
    User.findOne.mockResolvedValue(null);
    const req = { body: { username: 'nadie' }, userId: USER_ID };
    const res = mockRes();

    await controller.sendRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400 si ya existe una solicitud pendiente enviada por mi mismo', async () => {
    User.findOne.mockResolvedValue({ _id: OTHER_ID });
    // requester === USER_ID: la solicitud pendiente ya la envie yo antes
    FriendRequest.findOne.mockResolvedValue({ status: 'pending', requester: USER_ID });

    const req = { body: { username: 'amigo' }, userId: USER_ID };
    const res = mockRes();

    await controller.sendRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('issue #97: acepta automaticamente si la solicitud pendiente es la contraria (cruzada)', async () => {
    User.findOne.mockResolvedValue({ _id: OTHER_ID });
    // requester === OTHER_ID: el destinatario ya me habia enviado la solicitud a mi
    const existing = { status: 'pending', requester: OTHER_ID, save: jest.fn().mockResolvedValue(true) };
    FriendRequest.findOne.mockResolvedValue(existing);

    const req = { body: { username: 'amigo' }, userId: USER_ID };
    const res = mockRes();

    await controller.sendRequest(req, res);

    expect(existing.status).toBe('accepted');
    expect(existing.save).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(existing);
  });

  test('400 si la relacion esta bloqueada', async () => {
    User.findOne.mockResolvedValue({ _id: OTHER_ID });
    FriendRequest.findOne.mockResolvedValue({ status: 'blocked' });

    const req = { body: { username: 'amigo' }, userId: USER_ID };
    const res = mockRes();

    await controller.sendRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('crea la solicitud si no hay relacion previa', async () => {
    User.findOne.mockResolvedValue({ _id: OTHER_ID });
    FriendRequest.findOne.mockResolvedValue(null);
    FriendRequest.create.mockResolvedValue({ requester: USER_ID, recipient: OTHER_ID, status: 'pending' });

    const req = { body: { username: 'amigo' }, userId: USER_ID };
    const res = mockRes();

    await controller.sendRequest(req, res);

    expect(FriendRequest.create).toHaveBeenCalledWith({ requester: USER_ID, recipient: OTHER_ID });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('reutiliza el documento si la relacion previa fue rechazada', async () => {
    User.findOne.mockResolvedValue({ _id: OTHER_ID });
    const existing = { status: 'rejected', save: jest.fn().mockResolvedValue(true) };
    FriendRequest.findOne.mockResolvedValue(existing);

    const req = { body: { username: 'amigo' }, userId: USER_ID };
    const res = mockRes();

    await controller.sendRequest(req, res);

    expect(existing.status).toBe('pending');
    expect(existing.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('friendController.acceptRequest / rejectRequest', () => {
  test('404 si la solicitud no existe o no es del usuario', async () => {
    FriendRequest.findOne.mockResolvedValue(null);
    const req = { params: { id: 'req1' }, userId: USER_ID };
    const res = mockRes();

    await controller.acceptRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('acepta la solicitud correctamente', async () => {
    const request = { status: 'pending', save: jest.fn().mockResolvedValue(true) };
    FriendRequest.findOne.mockResolvedValue(request);

    const req = { params: { id: 'req1' }, userId: USER_ID };
    const res = mockRes();

    await controller.acceptRequest(req, res);

    expect(request.status).toBe('accepted');
    expect(request.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});

describe('friendController.removeFriend', () => {
  test('404 si no existe amistad con ese usuario', async () => {
    FriendRequest.findOneAndDelete.mockResolvedValue(null);
    const req = { params: { friendId: OTHER_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.removeFriend(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('elimina la amistad existente', async () => {
    FriendRequest.findOneAndDelete.mockResolvedValue({ status: 'accepted' });
    const req = { params: { friendId: OTHER_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.removeFriend(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });
});

describe('friendController.blockUser / unblockUser', () => {
  test('400 si intenta bloquearse a si mismo', async () => {
    const req = { params: { userId: USER_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.blockUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('403 si intenta desbloquear sin haber sido quien bloqueo', async () => {
    FriendRequest.findOne.mockResolvedValue({ status: 'blocked', blockedBy: OTHER_ID });
    const req = { params: { userId: OTHER_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.unblockUser(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('desbloquea correctamente cuando el usuario fue quien bloqueo', async () => {
    const relation = { status: 'blocked', blockedBy: USER_ID, deleteOne: jest.fn().mockResolvedValue(true) };
    FriendRequest.findOne.mockResolvedValue(relation);

    const req = { params: { userId: OTHER_ID }, userId: USER_ID };
    const res = mockRes();

    await controller.unblockUser(req, res);

    expect(relation.deleteOne).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});