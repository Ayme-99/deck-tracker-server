jest.mock('../../src/models/User');

const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const authController = require('../../src/controllers/authController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const originalSecret = process.env.JWT_SECRET;
const originalExpiresIn = process.env.JWT_EXPIRES_IN;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
});

afterAll(() => {
  process.env.JWT_SECRET = originalSecret;
  process.env.JWT_EXPIRES_IN = originalExpiresIn;
});

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.JWT_EXPIRES_IN;
});

describe('authController.login', () => {
  test('el token generado incluye una caducidad (exp) de 30 dias por defecto', async () => {
    const user = {
      _id: 'user123',
      username: 'ayme',
      comparePassword: jest.fn().mockResolvedValue(true)
    };
    User.findOne.mockResolvedValue(user);

    const req = { body: { username: 'ayme', password: 'secret' } };
    const res = mockRes();

    await authController.login(req, res);

    const { token } = res.json.mock.calls[0][0];
    const decoded = jwt.verify(token, 'test-secret');

    expect(decoded.exp).toBeDefined();
    // 30 dias en segundos, con margen de 60s por el tiempo de ejecucion del test
    const expectedExp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    expect(decoded.exp).toBeGreaterThan(expectedExp - 60);
    expect(decoded.exp).toBeLessThan(expectedExp + 60);
  });

  test('respeta JWT_EXPIRES_IN si esta configurada', async () => {
    process.env.JWT_EXPIRES_IN = '1h';
    const user = {
      _id: 'user123',
      username: 'ayme',
      comparePassword: jest.fn().mockResolvedValue(true)
    };
    User.findOne.mockResolvedValue(user);

    const req = { body: { username: 'ayme', password: 'secret' } };
    const res = mockRes();

    await authController.login(req, res);

    const { token } = res.json.mock.calls[0][0];
    const decoded = jwt.verify(token, 'test-secret');
    const expectedExp = Math.floor(Date.now() / 1000) + 60 * 60;

    expect(decoded.exp).toBeGreaterThan(expectedExp - 10);
    expect(decoded.exp).toBeLessThan(expectedExp + 10);
  });
});
