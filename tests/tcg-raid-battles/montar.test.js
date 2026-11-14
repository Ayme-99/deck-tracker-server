const express = require('express');
const jwt = require('jsonwebtoken');
const montarIncursiones = require('../../src/modules/tcg-raid-battles/montar');
const { crearRepoMemoria } = require('../../src/modules/tcg-raid-battles');
const ejemplo = require('./partida-v2.json');
const ejemploV3 = require('./partida-v3.json');
const ejemploV4 = require('./partida-v4.json');
const ejemploV5 = require('./partida-v5.json');
const ejemploV8 = require('./partida-v8.json');

// El mismo JWT que usa el resto del servidor (middleware `protect`).
const SECRETO = 'secreto-de-prueba';
const token = (userId) => jwt.sign({ userId }, SECRETO);

let servidor;
let base;
const secretoOriginal = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRETO;
  const app = express();
  app.use('/api/incursiones', express.json({ limit: '1mb' }));
  app.use(express.json());
  app.use(
    '/api/incursiones',
    montarIncursiones({
      repo: crearRepoMemoria(),
      existenCuentas: async () => [],
    }),
  );
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}/api/incursiones`;
});

afterAll(async () => {
  process.env.JWT_SECRET = secretoOriginal;
  await new Promise((ok) => servidor.close(ok));
});

const llamar = async (metodo, ruta, { usuario, cuerpo } = {}) => {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(usuario ? { authorization: `Bearer ${token(usuario)}` } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { estado: r.status, json: await r.json() };
};

// La partida de ejemplo, con la cuenta de Ana cambiada por la del usuario.
const partidaDe = (usuario) => ({ ...structuredClone(ejemplo), cuentas: [usuario, ejemplo.cuentas[1]] });

describe('Incursiones montado en Deck Tracker', () => {
  test('sin token responde 401 con el error de Deck Tracker', async () => {
    const r = await llamar('GET', '/me/puntos');
    expect(r.estado).toBe(401);
    expect(r.json.error).toMatch(/token/);
  });

  test('guarda una partida con la cuenta del JWT y suma sus puntos', async () => {
    const usuario = '64b000000000000000000001';
    const guardada = await llamar('POST', '/partidas', { usuario, cuerpo: partidaDe(usuario) });
    expect(guardada.estado).toBe(201);
    expect(guardada.json.tusPuntos).toBeGreaterThan(0);

    const puntos = await llamar('GET', '/me/puntos', { usuario });
    expect(puntos.estado).toBe(200);
    expect(puntos.json.partidas).toBe(1);
    expect(puntos.json.puntos).toBe(guardada.json.tusPuntos);
  });

  test('guarda una partida v3 con un aliado por categoría (D-13)', async () => {
    const usuario = '64b000000000000000000002';
    const partida = { ...structuredClone(ejemploV3), cuentas: [usuario, ...ejemploV3.cuentas.slice(1)] };
    const guardada = await llamar('POST', '/partidas', { usuario, cuerpo: partida });
    expect(guardada.estado).toBe(201);

    const detalle = await llamar('GET', `/partidas/${partida.partidaId}`, { usuario });
    expect(detalle.json.registro.version).toBe(3);
    const aliado = detalle.json.registro.eventos.find((e) => e.tipo === 'aliadoInvocado');
    expect(aliado.categoria).toBe('danio');
  });

  test('rechaza un aliado v3 sin categoría', async () => {
    const usuario = '64b000000000000000000003';
    const partida = {
      ...structuredClone(ejemploV3),
      partidaId: 'v3-sin-categoria',
      cuentas: [usuario, ...ejemploV3.cuentas.slice(1)],
    };
    delete partida.eventos.find((e) => e.tipo === 'aliadoInvocado').categoria;
    const r = await llamar('POST', '/partidas', { usuario, cuerpo: partida });
    expect(r.estado).toBe(400);
    expect(r.json.error).toBe('estructura_invalida');
  });

  test('guarda una partida v4 con un aliado tanque', async () => {
    const usuario = '64b000000000000000000004';
    const partida = { ...structuredClone(ejemploV4), cuentas: [usuario, ...ejemploV4.cuentas.slice(1)] };
    const guardada = await llamar('POST', '/partidas', { usuario, cuerpo: partida });
    expect(guardada.estado).toBe(201);
    const detalle = await llamar('GET', `/partidas/${partida.partidaId}`, { usuario });
    expect(detalle.json.registro.version).toBe(4);
    expect(detalle.json.registro.eventos.find((e) => e.tipo === 'aliadoInvocado').categoria).toBe('tanque');
  });

  test('rechaza en v4 la categoría barrera, que ya no existe', async () => {
    const usuario = '64b000000000000000000005';
    const partida = {
      ...structuredClone(ejemploV4),
      partidaId: 'v4-con-barrera',
      cuentas: [usuario, ...ejemploV4.cuentas.slice(1)],
    };
    partida.eventos.find((e) => e.tipo === 'aliadoInvocado').categoria = 'barrera';
    const r = await llamar('POST', '/partidas', { usuario, cuerpo: partida });
    expect(r.estado).toBe(400);
  });

  test('guarda una partida v5 con un efecto en un ataque del jefe', async () => {
    const usuario = '64b000000000000000000006';
    const partida = { ...structuredClone(ejemploV5), cuentas: [usuario, ...ejemploV5.cuentas.slice(1)] };
    const guardada = await llamar('POST', '/partidas', { usuario, cuerpo: partida });
    expect(guardada.estado).toBe(201);
    const detalle = await llamar('GET', `/partidas/${partida.partidaId}`, { usuario });
    expect(detalle.json.registro.version).toBe(5);
    expect(detalle.json.registro.eventos.find((e) => e.tipo === 'ataqueJefe').efecto.tipo).toBe('sinRetirada');
  });

  test('rechaza en v5 un efecto de ataque desconocido', async () => {
    const usuario = '64b000000000000000000007';
    const partida = {
      ...structuredClone(ejemploV5),
      partidaId: 'v5-efecto-malo',
      cuentas: [usuario, ...ejemploV5.cuentas.slice(1)],
    };
    partida.eventos.find((e) => e.tipo === 'ataqueJefe').efecto = { tipo: 'bailar' };
    const r = await llamar('POST', '/partidas', { usuario, cuerpo: partida });
    expect(r.estado).toBe(400);
  });

  test('guarda una partida v8 (daño por efectos)', async () => {
    const usuario = '64b000000000000000000008';
    const partida = {
      ...structuredClone(ejemploV8),
      partidaId: 'ejemplo-v8-victoria',
      cuentas: [usuario, ...ejemploV8.cuentas.slice(1)],
    };
    const guardada = await llamar('POST', '/partidas', { usuario, cuerpo: partida });
    expect(guardada.estado).toBe(201);
    const detalle = await llamar('GET', `/partidas/${partida.partidaId}`, { usuario });
    expect(detalle.json.registro.version).toBe(8);
  });

  test('rechaza en v8 un danoDeEfecto sin objetivo o con dos', async () => {
    const usuario = '64b000000000000000000009';
    for (const [id, extra] of [['v8-sin-objetivo', {}], ['v8-dos-objetivos', { jugador: 0, slot: 1 }]]) {
      const partida = {
        ...structuredClone(ejemploV8),
        partidaId: id,
        cuentas: [usuario, ...ejemploV8.cuentas.slice(1)],
      };
      partida.eventos.splice(3, 0, { tipo: 'danoDeEfecto', puntos: 10, ...extra });
      const r = await llamar('POST', '/partidas', { usuario, cuerpo: partida });
      expect(r.estado).toBe(400);
    }
  });

  test('una cuenta que no juega la partida recibe 403', async () => {
    const r = await llamar('POST', '/partidas', {
      usuario: '64b0000000000000000000ff',
      cuerpo: { ...partidaDe('64b000000000000000000001'), partidaId: 'otra-partida' },
    });
    expect(r.estado).toBe(403);
    expect(r.json.error).toBe('no_participas');
  });
});
