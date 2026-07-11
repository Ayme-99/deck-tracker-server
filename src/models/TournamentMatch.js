const mongoose = require('mongoose');

// NOTA: Este modelo es parte del modo 'hosted' (issue #11), que esta fuera
// de alcance del sprint actual (issue #20). Se deja creado y listo, pero
// SIN endpoints/rutas todavia — se conectara cuando se desarrolle 'hosted'
// en serio, despues de Japon.
//
// A diferencia de Match (que es siempre "yo vs rival"), TournamentMatch
// representa un enfrentamiento entre dos TournamentPlayer cualquiera,
// ninguno de los cuales tiene por que ser el usuario propietario del torneo.

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
  }
}, { timestamps: true });

// winnerId, si viene informado, debe ser uno de los dos jugadores del match
//
// Recordatorio del bug de #18: bajo Mongoose 9.x, los hooks pre('validate')
// deben ser funciones normales que lanzan el error directamente (throw),
// NUNCA el estilo callback function(next) { ... next(err) } — ese estilo
// no funciona y la validacion no llegaria a aplicarse.
tournamentMatchSchema.pre('validate', function() {
  if (this.winnerId && !this.winnerId.equals(this.player1Id) && !this.winnerId.equals(this.player2Id)) {
    throw new Error('winnerId debe coincidir con player1Id o player2Id');
  }
  if (this.player2Id && this.player1Id.equals(this.player2Id)) {
    throw new Error('player1Id y player2Id no pueden ser el mismo jugador');
  }
});

module.exports = mongoose.model('TournamentMatch', tournamentMatchSchema);