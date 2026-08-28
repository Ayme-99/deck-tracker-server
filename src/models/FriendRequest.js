const mongoose = require('mongoose');

// Una sola relacion por par de usuarios, en cualquier direccion.
// - pending: 'requester' ha pedido amistad a 'recipient', pendiente de respuesta
// - accepted: amistad activa
// - rejected: 'recipient' rechazo la solicitud (permite volver a pedir, reutilizando el doc)
// - blocked: uno de los dos ha bloqueado al otro; 'blockedBy' indica quien
const friendRequestSchema = new mongoose.Schema({
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'blocked'],
    default: 'pending'
  },
  blockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  respondedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('FriendRequest', friendRequestSchema);