// Invitar a un amigo a un torneo hosted propio (issue #95): enviar,
// listar, aceptar y rechazar invitaciones. Reutiliza la relacion de
// amistad de server#92 y crea el TournamentPlayer vinculado (linkedUserId
// + role, server#94) al aceptar.

const Tournament = require('../models/Tournament');
const TournamentInvite = require('../models/TournamentInvite');
const TournamentPlayer = require('../models/TournamentPlayer');
const FriendRequest = require('../models/FriendRequest');
const Deck = require('../models/Deck');
const User = require('../models/User');

async function areFriends(userA, userB) {
  const relation = await FriendRequest.findOne({
    status: 'accepted',
    $or: [
      { requester: userA, recipient: userB },
      { requester: userB, recipient: userA }
    ]
  });
  return !!relation;
}

// Envia una invitacion a un amigo para unirse a un torneo hosted propio.
exports.sendInvite = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { userId, role } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId es requerido' });
    if (role && !['admin', 'guest'].includes(role)) {
      return res.status(400).json({ error: 'role debe ser "admin" o "guest"' });
    }
    if (userId === req.userId) {
      return res.status(400).json({ error: 'No puedes invitarte a ti mismo' });
    }

    // Solo se puede invitar a amigos (reutiliza la relacion de server#92)
    if (!(await areFriends(req.userId, userId))) {
      return res.status(403).json({ error: 'Solo puedes invitar a amigos' });
    }

    const existing = await TournamentInvite.findOne({
      tournamentId: tournament._id,
      inviteeUserId: userId,
      status: 'pending'
    });
    if (existing) {
      return res.status(400).json({ error: 'Ya existe una invitacion pendiente para este usuario en este torneo' });
    }

    const invite = await TournamentInvite.create({
      tournamentId: tournament._id,
      inviterUserId: req.userId,
      inviteeUserId: userId,
      role: role || 'guest'
    });

    res.status(201).json(invite);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Lista las invitaciones pendientes recibidas por el usuario autenticado.
exports.listMyInvites = async (req, res) => {
  try {
    const invites = await TournamentInvite.find({ inviteeUserId: req.userId, status: 'pending' })
      .populate('tournamentId', 'name date structure');
    res.json(invites);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Acepta una invitacion: crea el TournamentPlayer vinculado, con el mazo
// propio (del invitado) que este elija.
exports.acceptInvite = async (req, res) => {
  try {
    const invite = await TournamentInvite.findOne({ _id: req.params.id, inviteeUserId: req.userId, status: 'pending' });
    if (!invite) return res.status(404).json({ error: 'Invitación no encontrada' });

    const { deckId, name } = req.body;
    if (!deckId) return res.status(400).json({ error: 'deckId es requerido' });

    const deck = await Deck.findOne({ _id: deckId, userId: req.userId });
    if (!deck) return res.status(404).json({ error: 'Mazo no encontrado' });

    const user = await User.findById(req.userId);

    const player = await TournamentPlayer.create({
      tournamentId: invite.tournamentId,
      name: name || user.username,
      deckArchetype: deck.name,
      linkedUserId: req.userId,
      role: invite.role,
      deckId: deck._id
    });

    invite.status = 'accepted';
    invite.respondedAt = new Date();
    await invite.save();

    res.json({ invite, player });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Rechaza una invitacion.
exports.rejectInvite = async (req, res) => {
  try {
    const invite = await TournamentInvite.findOne({ _id: req.params.id, inviteeUserId: req.userId, status: 'pending' });
    if (!invite) return res.status(404).json({ error: 'Invitación no encontrada' });

    invite.status = 'rejected';
    invite.respondedAt = new Date();
    await invite.save();

    res.json(invite);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
