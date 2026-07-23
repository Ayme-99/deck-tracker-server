const jwt = require('jsonwebtoken');
const protect = require('../../src/middleware/authMiddleware');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const originalSecret = process.env.JWT_SECRET;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
});

afterAll(() => {
  process.env.JWT_SECRET = originalSecret;
});

describe('authMiddleware.protect', () => {
  test('401 si falta el header Authorization', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('deja pasar un token valido y sin caducar, informando req.userId', () => {
    const token = jwt.sign({ userId: 'user123' }, 'test-secret', { expiresIn: '30d' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    protect(req, res, next);

    expect(req.userId).toBe('user123');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('401 con un token ya caducado (issue #82)', () => {
    // expiresIn negativo: jsonwebtoken lo firma ya vencido
    const expiredToken = jwt.sign({ userId: 'user123' }, 'test-secret', { expiresIn: -10 });
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res = mockRes();
    const next = jest.fn();

    protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido o expirado' });
    expect(next).not.toHaveBeenCalled();
  });

  test('401 con un token firmado con otro secreto', () => {
    const token = jwt.sign({ userId: 'user123' }, 'otro-secreto');
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
