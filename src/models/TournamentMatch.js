const mongoose = require('mongoose');

// Modelo del modo 'hosted' (issue #11). Representa un enfrentamiento entre
// dos TournamentPlayer (mazos inscritos), ninguno de los cuales tiene por
// que ser el usuario propietario del torneo -- a diferencia de Match, que
// siempre es "yo vs rival".
//
// Ver TORNEOS_HOSTED_GDD.md seccion 2.

const tournamentMatchSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true
  },
  phase: {
    type: String,
    enum: ['group_stage', 'swiss', 'round_of_16', 'quarterfinal', 'semifinal', 'final', 'league_round'],
    required: true
  },
  // Numero de ronda dentro de la fase (igual criterio que en Match: no
  // aplica en fases de eliminatoria directa, donde la fase ya identifica
  // el enfrentamiento)
  round: {
    type: Number,
    default: null
  },
  player1Id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TournamentPlayer',
    required: true
  },
  player2Id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TournamentPlayer',
    default: null // null = "bye" (pasa de ronda sin rival, en swiss con nº impar de jugadores)
  },
  // Jugador ganador. null puede significar empate O que el match todavia
  // no se ha jugado — se distingue por el campo status.
  winnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TournamentPlayer',
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending'
  },
  notes: {
    type: String
  },

  // --- Premios y resultado (para standings/tiebreakers) ---
  player1Prizes: {
    type: Number,
    min: 0,
    max: 6
  },
  player2Prizes: {
    type: Number,
    min: 0,
    max: 6
  },
  isDraw: {
    type: Boolean,
    default: false
  },

  // --- Solo relevante en eliminatoria a ida y vuelta ---
  // single: partido unico. first_leg/second_leg: ida y vuelta.
  // sudden_death: partido de desempate si el agregado de ida+vuelta empata
  // (regla oficial de Pokemon TCG).
  leg: {
    type: String,
    enum: ['single', 'first_leg', 'second_leg', 'sudden_death'],
    default: 'single'
  },
  // Enlaza ida <-> vuelta <-> muerte subita entre si (mismo par de jugadores,
  // misma ronda de bracket)
  tiedMatchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TournamentMatch',
    default: null
  }
}, { timestamps: true });

// winnerId, si viene informado, debe ser uno de los dos jugadores del match.
// player1Id y player2Id no pueden ser el mismo. Si isDraw es true, winnerId
// debe quedar vacio (un empate no tiene ganador).
//
// Recordatorio del bug de #18: bajo Mongoose 9.x, los hooks pre('validate')
// deben ser funciones normales que lanzan el error directamente (throw),
// NUNCA el estilo callback function(next) { ... next(err) }.
tournamentMatchSchema.pre('validate', function() {
  if (this.winnerId && !this.winnerId.equals(this.player1Id) && !this.winnerId.equals(this.player2Id)) {
    throw new Error('winnerId debe coincidir con player1Id o player2Id');
  }
  if (this.player2Id && this.player1Id.equals(this.player2Id)) {
    throw new Error('player1Id y player2Id no pueden ser el mismo jugador');
  }
  if (this.isDraw && this.winnerId) {
    throw new Error('Un match marcado como empate (isDraw) no puede tener winnerId');
  }
});

module.exports = mongoose.model('TournamentMatch', tournamentMatchSchema);