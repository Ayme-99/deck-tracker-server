const mongoose = require('mongoose');

// Modelo del modo 'hosted' (issue #11). Representa una inscripcion de un
// mazo (sin cuenta en la app) a un torneo alojado por la app.
//
// La unidad del torneo es el MAZO, no la persona: si un mismo jugador real
// inscribe varios mazos, cada uno es un TournamentPlayer independiente. El
// pairing empareja mazos, no personas -- si el calendario obliga a que dos
// mazos del mismo dueño se enfrenten, la partida se juega igualmente (el
// dueño del otro mazo implicado se sienta a pilotar uno de los dos). Es
// logistica de mesa que resuelve el organizador; el sistema no necesita
// saber que dos inscripciones comparten dueño real.
//
// Ver TORNEOS_HOSTED_GDD.md seccion 2.

const tournamentPlayerSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  // Arquetipo de mazo del jugador, texto libre (igual que OpponentArchetype,
  // pero aqui no hace falta ref porque no se lleva estadistica cruzada
  // entre torneos, solo dentro de este)
  deckArchetype: {
    type: String
  },
  // Si el jugador se retira a mitad de torneo (deja de recibir emparejamientos
  // en las siguientes rondas; su proximo rival recibe bye, no se le anota
  // una derrota adicional)
  dropped: {
    type: Boolean,
    default: false
  },

  // --- Puntuacion (swiss / liga): 3 victoria, 1 empate, 0 derrota ---
  points: {
    type: Number,
    default: 0
  },
  wins: {
    type: Number,
    default: 0
  },
  losses: {
    type: Number,
    default: 0
  },
  draws: {
    type: Number,
    default: 0
  },

  // 1er criterio de desempate: suma(premios propios) - suma(premios rival)
  // a lo largo de todo el torneo, igual que la diferencia de goles en futbol
  prizeDifferential: {
    type: Number,
    default: 0
  },

  // Rivales (otros TournamentPlayer) ya enfrentados, para el pairing swiss
  // (evitar repetir enfrentamiento entre rondas)
  opponentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TournamentPlayer'
  }],

  // Si ya recibio un bye en alguna ronda anterior, para no darle dos byes
  // seguidos mientras haya otros jugadores que aun no hayan recibido uno
  // Grupo asignado (solo relevante en structure 'groups_elimination', issue #43)
  groupName: {
    type: String,
    default: null
  },

  byeReceived: {
    type: Boolean,
    default: false
  },

  // Si esta inscripcion corresponde al propio usuario dueño del torneo
  // (el organizador puede tambien participar como jugador)
  isOrganizer: {
    type: Boolean,
    default: false
  },

  // Solo si isOrganizer es true: referencia al Deck real del organizador.
  // Necesario para poder generar automaticamente un Match normal (modelo
  // de 'tracked') cada vez que se registra un resultado de esta inscripcion,
  // de forma que cuente en las stats/rachas/matchups reales del usuario.
  deckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deck',
    default: null
  }
}, { timestamps: true });

// deckId es obligatorio unicamente cuando isOrganizer es true (el resto de
// jugadores no tienen cuenta ni Deck real en la app).
//
// Recordatorio del bug de #18: bajo Mongoose 9.x, los hooks pre('validate')
// deben ser funciones normales que lanzan el error directamente (throw),
// NUNCA el estilo callback function(next) { ... next(err) }.
tournamentPlayerSchema.pre('validate', function() {
  if (this.isOrganizer && !this.deckId) {
    throw new Error('deckId es obligatorio cuando isOrganizer es true');
  }
});

// Un mismo torneo no puede tener dos jugadores con el mismo nombre exacto.
// NOTA: si la misma persona se inscribe con dos mazos distintos, debe usar
// un nombre distinguible para cada inscripcion (ej. "Ayme (mazo A)"), ya
// que este indice trata cada nombre como una entrada independiente.
tournamentPlayerSchema.index({ tournamentId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('TournamentPlayer', tournamentPlayerSchema);