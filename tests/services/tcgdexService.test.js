const { searchCards } = require('../../src/services/tcgdexService');

describe('tcgdexService.searchCards', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('mapea la respuesta de la API al formato interno', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { id: 'basep-1', localId: '1', name: 'Pikachu', image: 'https://assets.tcgdex.net/en/base/basep/1' }
      ])
    });

    const results = await searchCards('Pikachu');

    expect(results).toEqual([
      {
        cardId: 'basep-1',
        name: 'Pikachu',
        set: 'basep',
        number: '1',
        image: 'https://assets.tcgdex.net/en/base/basep/1/low.webp'
      }
    ]);
  });

  test('desambigua reimpresiones del mismo nombre usando el codigo de set del cardId (issue #135)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { id: 'swsh4-25', localId: '25', name: 'Gardevoir' },
        { id: 'swsh9-86', localId: '86', name: 'Gardevoir' }
      ])
    });

    const results = await searchCards('Gardevoir');

    expect(results.map((r) => r.set)).toEqual(['swsh4', 'swsh9']);
  });

  test('cardId sin guion no rompe el mapeo (set queda null)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{ id: 'idraro', localId: '1', name: 'Pikachu' }])
    });

    const results = await searchCards('Pikachu');

    expect(results[0].set).toBeNull();
  });

  test('devuelve array vacio si la API no tiene datos', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => null });
    const results = await searchCards('cartaquenoexiste');
    expect(results).toEqual([]);
  });

  test('recorta a 15 resultados como maximo', async () => {
    const manyCards = Array.from({ length: 40 }, (_, i) => ({ id: `card-${i}`, localId: `${i}`, name: 'Pikachu' }));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => manyCards });

    const results = await searchCards('Pikachu');

    expect(results).toHaveLength(15);
  });

  test('cartas sin imagen no rompen el mapeo (image queda null)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{ id: 'basep-2', localId: '2', name: 'Pikachu' }])
    });

    const results = await searchCards('Pikachu');

    expect(results[0].image).toBeNull();
  });

  test('lanza error si la respuesta no es ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    await expect(searchCards('Pikachu')).rejects.toThrow('No se pudo consultar el catalogo de cartas');
  });
});
