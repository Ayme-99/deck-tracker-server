'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

// En el monorepo los esquemas están en `contrato/` (dos niveles arriba). Al
// exportar el módulo a otro repo (scripts/exportar.js) viajan en `./contrato`.
const CARPETA_CONTRATO = [
  path.join(__dirname, '..', '..', 'contrato'),
  path.join(__dirname, 'contrato'),
].find((c) => fs.existsSync(path.join(c, 'partida.v4.schema.json')))
  ?? path.join(__dirname, '..', '..', 'contrato');

// Versiones del registro que entiende este servidor (contrato/README.md). Las
// antiguas se siguen aceptando: hay clientes que aún las envían.
const VERSIONES_SOPORTADAS = [1, 2, 3, 4];

// Compila el esquema de cada versión. Devuelve (registro) → lista de errores
// del esquema de la versión que declara el registro (vacía si es válido).
// `carpeta` permite llevar los esquemas a otro sitio al montar el módulo.
function crearValidador(carpeta = CARPETA_CONTRATO) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validadores = new Map(
    VERSIONES_SOPORTADAS.map((v) => [
      v,
      ajv.compile(JSON.parse(fs.readFileSync(path.join(carpeta, `partida.v${v}.schema.json`), 'utf8'))),
    ]),
  );
  return (registro) => {
    const validar = validadores.get(registro.version);
    if (!validar) return [{ ruta: '/version', mensaje: 'versión no soportada' }];
    if (validar(registro)) return [];
    return (validar.errors || []).slice(0, 10).map((e) => ({
      ruta: e.instancePath || '/',
      mensaje: e.message,
    }));
  };
}

module.exports = { crearValidador, VERSIONES_SOPORTADAS };
