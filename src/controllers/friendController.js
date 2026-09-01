const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');
const Deck = require('../models/Deck');
const { computeDeckOverview } = require('../services/deckStatsService');

// Busca la relacion existente entre dos usuarios, en cualquier direccion
async function findRelation(userA, userB) {
  return FriendRequest.findOne({
    $or: [
      { requester: userA, recipient: userB },
      { requester: userB, recipient: userA }
    ]
  });
}

// Busca usuarios por username (para poder enviarles una solicitud).
// Solo expone el username, nunca mas datos de la cuenta.
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'El termino de busqueda es requerido' });

    const users = await User.find({
      username: { $regex: q, $options: 'i' },
      _id: { $ne: req.userId }
    })
      .select('username')
      .limit(15);

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Envia una solicitud de amistad a un usuario por username
exports.sendRequest = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'El username es requerido' });

    const recipient = await User.findOne({ username });
    if (!recipient) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (recipient._id.toString() === req.userId) {
      return res.status(400).json({ error: 'No puedes enviarte una solicitud a ti mismo' });
    }

    const existing = await findRelation(req.userId, recipient._id);

    if (existing) {
      if (existing.status === 'blocked') {
        return res.status(400).json({ error: 'No es posible enviar la solicitud' });
      }
      if (existing.status === 'pending') {
        // Issue #97: si la solicitud pendiente ya existente es justo la
        // contraria (el destinatario ya me la habia enviado a mi), se
        // acepta automaticamente en vez de dar error -- es el caso obvio
        // de "los dos querian ser amigos a la vez".
        if (existing.requester.toString() === recipient._id.toString()) {
          existing.status = 'accepted';
          existing.respondedAt = new Date();
          await existing.save();
          return res.json(existing);
        }
        return res.status(400).json({ error: 'Ya existe una solicitud pendiente con este usuario' });
      }
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Ya sois amigos' });
      }
      // rejected: se reutiliza el documento, vuelve a quedar pendiente
      existing.requester = req.userId;
      existing.recipient = recipient._id;
      existing.status = 'pending';
      existing.respondedAt = null;
      await existing.save();
      return res.status(201).json(existing);
    }

    const request = await FriendRequest.create({
      requester: req.userId,
      recipient: recipient._id
    });

    res.status(201).json(request);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Lista solicitudes entrantes o salientes pendientes (?type=incoming|outgoing)
exports.listRequests = async (req, res) => {
  try {
    const { type } = req.query;
    if (!['incoming', 'outgoing'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser "incoming" u "outgoing"' });
    }

    const filter = type === 'incoming'
      ? { recipient: req.userId, status: 'pending' }
      : { requester: req.userId, status: 'pending' };

    const requests = await FriendRequest.find(filter)
      .populate('requester', 'username')
      .populate('recipient', 'username');

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Acepta una solicitud entrante
exports.acceptRequest = async (req, res) => {
  try {
    const request = await FriendRequest.findOne({ _id: req.params.id, recipient: req.userId, status: 'pending' });
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });

    request.status = 'accepted';
    request.respondedAt = new Date();
    await request.save();

    res.json(request);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Rechaza una solicitud entrante
exports.rejectRequest = async (req, res) => {
  try {
    const request = await FriendRequest.findOne({ _id: req.params.id, recipient: req.userId, status: 'pending' });
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });

    request.status = 'rejected';
    request.respondedAt = new Date();
    await request.save();

    res.json(request);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Lista los amigos actuales (relaciones aceptadas)
exports.listFriends = async (req, res) => {
  try {
    const relations = await FriendRequest.find({
      status: 'accepted',
      $or: [{ requester: req.userId }, { recipient: req.userId }]
    })
      .populate('requester', 'username')
      .populate('recipient', 'username');

    const friends = relations.map((r) =>
      r.requester._id.toString() === req.userId ? r.recipient : r.requester
    );

    res.json(friends);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Elimina una amistad ya aceptada
exports.removeFriend = async (req, res) => {
  try {
    const { friendId } = req.params;

    const relation = await FriendRequest.findOneAndDelete({
      status: 'accepted',
      $or: [
        { requester: req.userId, recipient: friendId },
        { requester: friendId, recipient: req.userId }
      ]
    });

    if (!relation) return res.status(404).json({ error: 'No existe amistad con este usuario' });

    res.json({ message: 'Amistad eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Bloquea a un usuario (impide nuevas solicitudes en cualquier direccion)
exports.blockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId === req.userId) return res.status(400).json({ error: 'No puedes bloquearte a ti mismo' });

    let relation = await findRelation(req.userId, userId);

    if (relation) {
      relation.status = 'blocked';
      relation.blockedBy = req.userId;
      relation.respondedAt = new Date();
      await relation.save();
    } else {
      relation = await FriendRequest.create({
        requester: req.userId,
        recipient: userId,
        status: 'blocked',
        blockedBy: req.userId
      });
    }

    res.json(relation);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Lista los mazos de un amigo, con su resumen de stats (issue #93). Solo
// accesible si hay una amistad aceptada -- nunca mazos de un usuario
// cualquiera sin esa relacion.
exports.listFriendDecks = async (req, res) => {
  try {
    const { friendId } = req.params;

    const relation = await findRelation(req.userId, friendId);
    if (!relation || relation.status !== 'accepted') {
      return res.status(403).json({ error: 'Solo puedes consultar los mazos de tus amigos' });
    }

    const decks = await Deck.find({ userId: friendId });
    const decksWithOverview = await Promise.all(
      decks.map(async (deck) => ({
        ...deck.toObject(),
        overview: await computeDeckOverview(deck._id, friendId)
      }))
    );

    res.json(decksWithOverview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Desbloquea a un usuario. Solo quien bloqueo puede deshacerlo.
exports.unblockUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const relation = await FriendRequest.findOne({
      status: 'blocked',
      $or: [
        { requester: req.userId, recipient: userId },
        { requester: userId, recipient: req.userId }
      ]
    });

    if (!relation) return res.status(404).json({ error: 'No hay ningun bloqueo con este usuario' });
    if (relation.blockedBy.toString() !== req.userId) {
      return res.status(403).json({ error: 'Solo quien bloqueo puede desbloquear' });
    }

    await relation.deleteOne();
    res.json({ message: 'Usuario desbloqueado correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};