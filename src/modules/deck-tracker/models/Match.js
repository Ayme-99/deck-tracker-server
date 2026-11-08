const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  deckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deck',
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  opponentDeck: {
    type: String,
    required: true
  },
  userPrizes: {
    type: Number,
    required: true,
    min: 0,
    max: 6
  },
  opponentPrizes: {
    type: Number,
    required: true,
    min: 0,
    max: 6
  },
  endReason: {
    type: String,
    enum: ['normal', 'concession', 'no_pokemon', 'time', 'deck_out'],
    default: 'normal'
  },
  result: {
    type: String,
    enum: ['win', 'loss', 'tie']
  },
  format: {
    type: String,
    default: 'Standard'
  },
  notes: {
    type: String
  },
  playedAt: {
    type: Date,
    default: Date.now
  },
  // Referencia opcional al torneo (modo 'tracked') al que pertenece esta
  // partida. Si es null, la partida es "suelta" y no forma parte de ningun
  // torneo, tal y como funcionaba hasta ahora.
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    default: null
  },
  // Fase dentro del torneo (solo tiene sentido si viene tournamentId).
  // 'league_round' cubre el caso de liga; en ese modo los puntos/posicion
  // no se calculan aqui, van aparte en Tournament.standingSnapshots.
  phase: {
    type: String,
    enum: ['group_stage', 'swiss', 'round_of_16', 'quarterfinal', 'semifinal', 'final', 'league_round', null],
    default: null
  },
  // Numero de ronda dentro de la fase (ej. ronda 3 de swiss, jornada 5 de
  // liga). No aplica en fases de eliminatoria directa (round_of_16,
  // quarterfinal...), donde la propia fase ya identifica la partida.
  round: {
    type: Number,
    default: null
  }
});

// Si se informa phase o round, tournamentId debe venir tambien: no tiene
// sentido asignar una fase/ronda a una partida que no pertenece a ningun
// torneo.
//
// NOTA: mismo fix que en Tournament.js - bajo Mongoose 9.x el estilo
// callback (function(next)) no funciona en pre('validate'). Descubierto
// al escribir los tests del modelo (issue #18).
matchSchema.pre('validate', function() {
  if ((this.phase || (this.round !== null && this.round !== undefined)) && !this.tournamentId) {
    throw new Error('phase y round solo tienen sentido si la partida pertenece a un torneo (tournamentId)');
  }
});

// Calcula el resultado automáticamente antes de guardar
matchSchema.pre('save', function() {
  if (this.endReason === 'normal') {
    // Unico caso donde el marcador de premios determina el resultado por si solo
    if (this.userPrizes > this.opponentPrizes) {
      this.result = 'win';
    } else if (this.userPrizes < this.opponentPrizes) {
      this.result = 'loss';
    } else {
      this.result = 'tie';
    }
  } else if (!this.result) {
    // Cualquier otro motivo (rendicion, sin pokemon, tiempo, deck-out) puede
    // desconectar el resultado real del marcador de premios, asi que hace
    // falta que venga indicado explicitamente
    throw new Error('Con un motivo de fin distinto de "normal", debes indicar el resultado manualmente (win/loss/tie)');
  }
  // Si this.result ya viene informado, se respeta tal cual
});

module.exports = mongoose.model('Match', matchSchema);