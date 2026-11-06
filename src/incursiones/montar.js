'use strict';

// Monta el módulo de Incursiones (T-08, repo TCG-Raid-Battles) en este
// servidor: mismas cuentas (modelo User), mismo JWT (`protect`) y misma base
// de MongoDB. Este archivo es de Deck Tracker; el resto de src/incursiones/
// se regenera desde el repo de Incursiones (ver ORIGEN.md).
const mongoose = require('mongoose');
const protect = require('../middleware/authMiddleware');
const User = require('../models/User');
const { crearRouter, crearRepoMongo, crearRepoMemoria } = require('./index');

// El módulo pide el repositorio al crear el router, pero la conexión de
// Mongoose se abre después de arrancar. Este repositorio espera a la
// conexión en la primera petición y entonces crea los índices (una vez).
function repoPerezoso(conexion) {
  let listo = null;
  const real = () => {
    if (!listo) {
      listo = (async () => {
        await conexion.asPromise();
        const repo = crearRepoMongo(conexion.db);
        await repo.asegurarIndices();
        return repo;
      })();
      // Si falla (la base no responde), la siguiente petición lo reintenta.
      listo.catch(() => { listo = null; });
    }
    return listo;
  };
  const metodos = Object.keys(crearRepoMemoria());
  return Object.fromEntries(
    metodos.map((m) => [m, async (...args) => (await real())[m](...args)]),
  );
}

// Ids de cuenta que no existen. Un id que no es un ObjectId tampoco existe.
async function cuentasQueFaltan(ids) {
  const validos = ids.filter((id) => mongoose.isValidObjectId(id));
  const hay = new Set(
    (await User.find({ _id: { $in: validos } }).select('_id').lean()).map((u) => String(u._id)),
  );
  return ids.filter((id) => !hay.has(id));
}

// Las opciones solo se cambian en los tests.
function montarIncursiones({
  repo = repoPerezoso(mongoose.connection),
  autenticar = protect,
  existenCuentas = cuentasQueFaltan,
} = {}) {
  return crearRouter({
    repo,
    autenticar,
    usuarioDe: (req) => (req.userId ? String(req.userId) : undefined),
    existenCuentas,
  });
}

module.exports = montarIncursiones;
