'use strict';
const express = require('express');
const { crearValidador, VERSIONES_SOPORTADAS } = require('./esquema');

// [1, 2, 3] → «1, 2 y 3»
function listaDeVersiones(versiones) {
  if (versiones.length < 2) return versiones.join('');
  return `${versiones.slice(0, -1).join(', ')} y ${versiones[versiones.length - 1]}`;
}
const { comprobarCoherencia, abonos } = require('./coherencia');
const { COSTE_DESBLOQUEO } = require('./puntos');

const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 50;

function error(res, estado, codigo, mensaje, extra = {}) {
  return res.status(estado).json({ error: codigo, mensaje, ...extra });
}

// JSON con las claves ordenadas, para comparar dos registros sin que importe
// el orden en que llegaron.
function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

const codificarCursor = (fila) =>
  Buffer.from(JSON.stringify({ g: fila.guardadaEn, p: fila.partidaId })).toString('base64url');

function decodificarCursor(texto) {
  try {
    const { g, p } = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8'));
    if (typeof g === 'string' && typeof p === 'string') return { guardadaEn: g, partidaId: p };
  } catch {
    /* cae al null */
  }
  return null;
}

function resumenDeFila(f) {
  return {
    partidaId: f.partidaId,
    creadaEn: f.creadaEn ?? null,
    guardadaEn: f.guardadaEn,
    jefeId: f.jefeId ?? null,
    jefeNombre: f.jefeNombre,
    nivel: f.nivel,
    resultado: f.resultado,
    puntosTotal: f.puntosTotal,
    miAsiento: f.asiento,
    miPuesto: f.puesto,
    misPuntos: f.puntos,
    bonoEstados: f.bonoEstados ?? 0,
    abonado: f.abonado,
  };
}

/**
 * Router de /api/incursiones/*.
 *
 * @param {object} o
 * @param {object} o.repo        repoMemoria o repoMongo
 * @param {Function} o.autenticar middleware del host; deja el usuario en la petición
 * @param {Function} [o.usuarioDe] (req) → id de cuenta (por defecto req.usuarioId)
 * @param {Function} [o.existenCuentas] async (ids) → ids que no existen
 * @param {Function} [o.validar]  (registro) → errores del esquema
 * @param {Function} [o.ahora]    () → Date, para los tests
 */
function crearRouter({
  repo,
  autenticar,
  usuarioDe = (req) => req.usuarioId,
  existenCuentas = async () => [],
  validar = crearValidador(),
  ahora = () => new Date(),
}) {
  if (!repo || typeof autenticar !== 'function') {
    throw new Error('crearRouter necesita repo y autenticar');
  }
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));
  router.use(autenticar);
  router.use((req, res, next) => {
    const id = usuarioDe(req);
    if (typeof id !== 'string' || id === '') {
      return error(res, 401, 'no_autenticado', 'hace falta iniciar sesión');
    }
    req.cuentaId = id;
    return next();
  });

  const asincrono = (fn) => (req, res, next) => fn(req, res).catch(next);

  // Guarda una partida terminada. Idempotente por partidaId.
  router.post('/partidas', asincrono(async (req, res) => {
    const registro = req.body;
    if (!registro || typeof registro !== 'object' || Array.isArray(registro)) {
      return error(res, 400, 'estructura_invalida', 'el cuerpo debe ser un registro de partida');
    }
    if (!VERSIONES_SOPORTADAS.includes(registro.version)) {
      return error(res, 400, 'version_no_soportada',
        `este servidor entiende las versiones ${listaDeVersiones(VERSIONES_SOPORTADAS)} del registro`,
        { version: registro.version ?? null });
    }
    const errores = validar(registro);
    if (errores.length > 0) {
      return error(res, 400, 'estructura_invalida', 'el registro no cumple el esquema', { errores });
    }
    if (!registro.cuentas || !registro.cuentas.includes(req.cuentaId)) {
      return error(res, 403, 'no_participas', 'tu cuenta no figura en las cuentas de la partida');
    }
    const motivos = comprobarCoherencia(registro);
    if (motivos.length > 0) {
      return error(res, 422, 'resumen_incoherente', 'el resumen no cuadra con la partida', { motivos });
    }
    const ids = registro.cuentas.filter((c) => c !== null);
    const faltan = await existenCuentas(ids);
    if (faltan.length > 0) {
      return error(res, 422, 'cuenta_desconocida', 'hay cuentas que no existen', { cuentas: faltan });
    }

    const guardadaEn = ahora().toISOString();
    const jefe = registro.eventos.find((e) => e.tipo === 'elegirJefe');
    const comun = {
      partidaId: registro.partidaId,
      guardadaEn,
      creadaEn: registro.creadaEn ?? null,
      jefeId: registro.resumen.jefeId ?? null,
      jefeNombre: jefe.nombre,
      nivel: registro.resumen.nivel,
      resultado: registro.resumen.resultado,
      puntosTotal: registro.resumen.puntosTotal,
    };
    const filas = abonos(registro).map((a) => ({ ...comun, ...a }));
    const { creada, partida } = await repo.guardarPartida({
      partida: { ...comun, guardadaPor: req.cuentaId, registro },
      jugadores: filas,
    });

    if (!creada && canonico(partida.registro) !== canonico(registro)) {
      return error(res, 409, 'partida_distinta', 'ya existe otra partida con ese partidaId');
    }
    const mia = filas.find((f) => f.cuentaId === req.cuentaId);
    return res.status(creada ? 201 : 200).json({
      partidaId: partida.partidaId,
      guardadaEn: partida.guardadaEn,
      duplicada: !creada,
      tusPuntos: mia.abonado ? mia.puntos + mia.bonoEstados : 0,
    });
  }));

  // Historial del usuario, de la más reciente a la más antigua.
  router.get('/partidas', asincrono(async (req, res) => {
    let limite = LIMITE_POR_DEFECTO;
    if (req.query.limite !== undefined) {
      limite = Number(req.query.limite);
      if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
        return error(res, 400, 'parametro_invalido', `limite debe ser un entero de 1 a ${LIMITE_MAXIMO}`);
      }
    }
    let antes = null;
    if (req.query.despues !== undefined) {
      antes = decodificarCursor(String(req.query.despues));
      if (!antes) return error(res, 400, 'parametro_invalido', 'despues no es un cursor válido');
    }
    // Se pide una fila de más para saber si hay página siguiente.
    const filas = await repo.listar(req.cuentaId, { limite: limite + 1, antes });
    const pagina = filas.slice(0, limite);
    return res.json({
      partidas: pagina.map(resumenDeFila),
      siguiente: filas.length > limite ? codificarCursor(pagina[pagina.length - 1]) : null,
    });
  }));

  // Una partida con su registro completo; solo para quien jugó en ella.
  router.get('/partidas/:id', asincrono(async (req, res) => {
    const partida = await repo.obtenerPartida(req.params.id);
    if (!partida || !partida.registro.cuentas.includes(req.cuentaId)) {
      return error(res, 404, 'no_encontrada', 'no existe esa partida');
    }
    return res.json({
      partidaId: partida.partidaId,
      guardadaEn: partida.guardadaEn,
      registro: partida.registro,
    });
  }));

  // Puntos acumulados y a qué jefes da acceso (los puntos no se gastan).
  router.get('/me/puntos', asincrono(async (req, res) => {
    const { puntos, partidas } = await repo.puntosDe(req.cuentaId);
    return res.json({
      puntos,
      partidas,
      niveles: Object.entries(COSTE_DESBLOQUEO).map(([nivel, coste]) => ({
        nivel: Number(nivel),
        coste,
        alcanzado: puntos >= coste,
        faltan: Math.max(0, coste - puntos),
      })),
    });
  }));

  // Errores del propio router (JSON mal formado, cuerpo demasiado grande).
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return error(res, 400, 'json_invalido', 'el cuerpo no es un JSON válido');
    }
    if (err.type === 'entity.too.large') {
      return error(res, 413, 'cuerpo_demasiado_grande', 'el registro supera 1 MB');
    }
    return next(err);
  });

  return router;
}

module.exports = { crearRouter, canonico };
