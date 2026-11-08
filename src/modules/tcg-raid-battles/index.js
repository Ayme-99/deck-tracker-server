'use strict';
const { crearRouter } = require('./router');
const { crearRepoMemoria } = require('./repoMemoria');
const { crearRepoMongo } = require('./repoMongo');
const { crearValidador } = require('./esquema');

module.exports = { crearRouter, crearRepoMemoria, crearRepoMongo, crearValidador };
