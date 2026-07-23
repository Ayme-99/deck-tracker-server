jest.mock('../../src/services/tcgdexService');

const { searchCards } = require('../../src/services/tcgdexService');
const cardCatalogController = require('../../src/controllers/cardCatalogController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('cardCatalogController.search', () => {
  test('devuelve [] sin llamar al servicio si q tiene menos de 2 caracteres', async () => {
    const req = { query: { q: 'a' } };
    const res = mockRes();

    await cardCatalogController.search(req, res);

    expect(searchCards).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([]);
  });

  test('devuelve [] sin llamar al servicio si no viene q', async () => {
    const req = { query: {} };
    const res = mockRes();

    await cardCatalogController.search(req, res);

    expect(searchCards).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([]);
  });

  test('devuelve los resultados del servicio', async () => {
    searchCards.mockResolvedValue([{ cardId: 'swsh4-25', name: 'Pikachu VMAX' }]);
    const req = { query: { q: 'Pikachu' } };
    const res = mockRes();

    await cardCatalogController.search(req, res);

    expect(searchCards).toHaveBeenCalledWith('Pikachu');
    expect(res.json).toHaveBeenCalledWith([{ cardId: 'swsh4-25', name: 'Pikachu VMAX' }]);
  });

  test('500 si el servicio lanza error', async () => {
    searchCards.mockRejectedValue(new Error('fallo de red'));
    const req = { query: { q: 'Pikachu' } };
    const res = mockRes();

    await cardCatalogController.search(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'fallo de red' });
  });
});
