const mongoose = require('mongoose');

// Invitacion a un amigo para unirse a un torneo hosted propio (issue #95),
// con flujo de aceptacion/rechazo -- no se crea el TournamentPlayer hasta
// que el invitado acepta y elige que mazo propio vincular.
const tournamentInviteSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true
  },
  inviterUserId: {
    type: String,
    required: true
  },
  inviteeUserId: {
    type: String,
    required: true
  },
  // Rol propuesto para la inscripcion resultante (ver TournamentPlayer,
  // issue #94): admin podra registrar sus propias partidas en el futuro,
  // guest deja el registro en manos del organizador.
  role: {
    type: String,
    enum: ['admin', 'guest'],
    default: 'guest'
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  respondedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('TournamentInvite', tournamentInviteSchema);
