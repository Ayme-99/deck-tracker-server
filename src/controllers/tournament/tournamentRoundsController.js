// Generacion de rondas/bracket y registro de resultados de un torneo hosted
// (issue #115: extraido de tournamentController.js).

const Tournament = require('../../models/Tournament');
const Match = require('../../models/Match');
const TournamentPlayer = require('../../models/TournamentPlayer');
const TournamentMatch = require('../../models/TournamentMatch');
const { generateSwissPairings } = require('../../services/swissPairingService');
const { generateBracket, nextPhase, seededPairings } = require('../../services/eliminationPairingService');
const { assignGroups, calculateEliminationEntry } = require('../../services/groupsEliminationService');
const { calculateOMW } = require('../../services/tiebreakerService');
const { generateRoundRobinSchedule } = require('../../services/roundRobinService');
const { createEliminationEntryMatches, createRealMatch } = require('../../services/bracketEntryService');

// --- Modo hosted (issue #21) ---

// Genera la siguiente ronda swiss: empareja jugadores activos (no dropped)
// segun puntos, evitando repetir rivales, y crea los TournamentMatch
// correspondientes. Actualiza opponentIds/byeReceived de los jugadores.
exports.generateSwissRound = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const activePlayers = await TournamentPlayer.find({
      tournamentId: tournament._id,
      dropped: false
    });

    if (activePlayers.length < 2) {
      return res.status(400).json({ error: 'Hacen falta al menos 2 jugadores activos para emparejar una ronda' });
    }

    // Adapta los documentos de Mongoose al formato plano que espera el
    // servicio de pairing (logica pura, sin dependencia de Mongoose)
    const playersForPairing = activePlayers.map((p) => ({
      id: p._id.toString(),
      points: p.points,
      opponentIds: p.opponentIds.map((id) => id.toString()),
      byeReceived: p.byeReceived
    }));

    const { pairings } = generateSwissPairings(playersForPairing);

    // Siguiente numero de ronda para la fase swiss de este torneo
    const existingSwissMatches = await TournamentMatch.find({ tournamentId: tournament._id, phase: 'swiss' });
    const nextRound = existingSwissMatches.length > 0
      ? Math.max(...existingSwissMatches.map((m) => m.round || 0)) + 1
      : 1;

    const createdMatches = [];
    for (const pairing of pairings) {
      const match = await TournamentMatch.create({
        tournamentId: tournament._id,
        phase: 'swiss',
        round: nextRound,
        player1Id: pairing.player1Id,
        player2Id: pairing.player2Id,
        // Un bye se resuelve automaticamente como victoria del jugador 1,
        // sin necesidad de que el organizador registre resultado
        status: pairing.player2Id === null ? 'completed' : 'pending',
        winnerId: pairing.player2Id === null ? pairing.player1Id : null
      });
      createdMatches.push(match);

      // Actualiza opponentIds (evitar repetir rival) y byeReceived
      if (pairing.player2Id) {
        await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, { $addToSet: { opponentIds: pairing.player2Id } });
        await TournamentPlayer.findByIdAndUpdate(pairing.player2Id, { $addToSet: { opponentIds: pairing.player1Id } });
      } else {
        await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, {
          byeReceived: true,
          $inc: { points: 3, wins: 1 }
        });
      }
    }

    res.status(201).json({ round: nextRound, matches: createdMatches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Clasificacion del torneo hosted. Orden: points desc, prizeDifferential
// desc (1er criterio), omwPercentage desc (2º criterio, issue #45).
// Jugadores empatados en los 3 criterios comparten posicion.
exports.getHostedStandings = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id });

    const omwMap = calculateOMW(players.map((p) => ({
      id: p._id.toString(),
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      opponentIds: p.opponentIds.map((id) => id.toString())
    })));

    const sorted = [...players].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.prizeDifferential !== a.prizeDifferential) return b.prizeDifferential - a.prizeDifferential;
      return omwMap.get(b._id.toString()) - omwMap.get(a._id.toString());
    });

    let last = null;
    let lastPosition = 0;

    const standings = sorted.map((p, index) => {
      const omwPercentage = omwMap.get(p._id.toString());
      const tiedWithPrevious = last
        && p.points === last.points
        && p.prizeDifferential === last.prizeDifferential
        && omwPercentage === last.omwPercentage;
      const position = tiedWithPrevious ? lastPosition : index + 1;
      last = { points: p.points, prizeDifferential: p.prizeDifferential, omwPercentage };
      lastPosition = position;

      return {
        position,
        playerId: p._id,
        name: p.name,
        deckArchetype: p.deckArchetype,
        points: p.points,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        prizeDifferential: p.prizeDifferential,
        omwPercentage: Math.round(omwPercentage * 1000) / 10, // 0-100, 1 decimal
        dropped: p.dropped
      };
    });

    res.json({ standings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Resultados (hosted) ---

// Registra el resultado de un TournamentMatch: actualiza el match, los
// puntos/W-L-D/prizeDifferential de ambos jugadores, y si alguno de los
// dos es el organizador (isOrganizer), genera automaticamente un Match
// normal vinculado a su deckId real para que cuente en sus stats.
exports.registerMatchResult = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const tMatch = await TournamentMatch.findOne({ _id: req.params.matchId, tournamentId: tournament._id });
    if (!tMatch) return res.status(404).json({ error: 'Partida no encontrada' });

    const { player1Prizes, player2Prizes, winnerId, isDraw } = req.body;

    tMatch.player1Prizes = player1Prizes;
    tMatch.player2Prizes = player2Prizes;
    tMatch.isDraw = !!isDraw;
    tMatch.winnerId = isDraw ? null : winnerId;
    tMatch.status = 'completed';
    await tMatch.save();

    const player1 = await TournamentPlayer.findById(tMatch.player1Id);
    const player2 = await TournamentPlayer.findById(tMatch.player2Id);

    const diff1 = (player1Prizes || 0) - (player2Prizes || 0);
    const diff2 = -diff1;

    if (isDraw) {
      player1.draws += 1;
      player2.draws += 1;
      player1.points += 1;
      player2.points += 1;
    } else if (String(winnerId) === String(player1._id)) {
      player1.wins += 1;
      player1.points += 3;
      player2.losses += 1;
    } else {
      player2.wins += 1;
      player2.points += 3;
      player1.losses += 1;
    }
    player1.prizeDifferential += diff1;
    player2.prizeDifferential += diff2;
    await player1.save();
    await player2.save();

    // Si alguno de los dos es el organizador, genera un Match real
    // (modelo de tracked) vinculado a su deckId, para que cuente en sus
    // stats/rachas/matchups sin tener que registrarlo dos veces a mano
    const createMatchIfOrganizer = async (self, opponent, ownPrizes, opponentPrizes) => {
      if (!self.isOrganizer || !self.deckId) return;
      await Match.create({
        deckId: self.deckId,
        userId: req.userId,
        opponentDeck: opponent.deckArchetype || opponent.name,
        userPrizes: ownPrizes,
        opponentPrizes: opponentPrizes,
        endReason: 'normal',
        tournamentId: tournament._id,
        phase: tMatch.phase,
        round: tMatch.round
      });
    };
    await createMatchIfOrganizer(player1, player2, player1Prizes, player2Prizes);
    await createMatchIfOrganizer(player2, player1, player2Prizes, player1Prizes);

    res.json({ match: tMatch, player1, player2 });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Genera el bracket inicial de eliminatoria directa (issue #42).
// body: { playerIds: [...], seeded: bool } -- playerIds ya debe venir en el
// orden deseado (por standing si seeded=true, o cualquier orden si false,
// ya que el shuffle se aplica internamente).
// Respeta tournament.eliminationFormat (single_match / two_legs): a doble
// partido crea first_leg + second_leg enlazados via tiedMatchId.
exports.generateEliminationBracket = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { playerIds, seeded } = req.body;
    const { phase, pairings } = generateBracket(playerIds, { seeded: !!seeded });

    const createdMatches = [];
    for (const pairing of pairings) {
      if (tournament.eliminationFormat === 'two_legs') {
        const firstLeg = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          player1Id: pairing.player1Id,
          player2Id: pairing.player2Id,
          leg: 'first_leg'
        });
        const secondLeg = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          // vuelta: se invierten local/visitante, pero a efectos de
          // agregado solo importa la suma de premios de cada jugador
          player1Id: pairing.player2Id,
          player2Id: pairing.player1Id,
          leg: 'second_leg',
          tiedMatchId: firstLeg._id
        });
        firstLeg.tiedMatchId = secondLeg._id;
        await firstLeg.save();
        createdMatches.push(firstLeg, secondLeg);
      } else {
        const match = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase,
          player1Id: pairing.player1Id,
          player2Id: pairing.player2Id,
          leg: 'single'
        });
        createdMatches.push(match);
      }
    }

    res.status(201).json({ phase, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Grupos + Eliminacion (issue #43) ---

// Reparte los jugadores del torneo en grupos (body: { groupSize }) y guarda
// el grupo asignado en cada TournamentPlayer.groupName ("Grupo 1", "Grupo 2"...)
exports.assignPlayerGroups = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const playerIds = players.map((p) => p._id.toString());
    const groups = assignGroups(playerIds, req.body.groupSize);

    for (let i = 0; i < groups.length; i++) {
      const groupName = `Grupo ${i + 1}`;
      await TournamentPlayer.updateMany(
        { _id: { $in: groups[i] } },
        { groupName }
      );
    }

    res.json({ groups: groups.map((ids, i) => ({ groupName: `Grupo ${i + 1}`, playerIds: ids })) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Genera el calendario round-robin (todos contra todos) dentro de cada
// grupo ya asignado, creando los TournamentMatch de phase: 'group_stage'
exports.generateGroupStageRounds = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const groupNames = [...new Set(players.map((p) => p.groupName).filter(Boolean))];
    if (groupNames.length === 0) {
      return res.status(400).json({ error: 'Los jugadores no tienen grupo asignado todavia (ver assignPlayerGroups)' });
    }

    const createdMatches = [];
    for (const groupName of groupNames) {
      const groupPlayerIds = players.filter((p) => p.groupName === groupName).map((p) => p._id.toString());
      const schedule = generateRoundRobinSchedule(groupPlayerIds);

      for (let roundIndex = 0; roundIndex < schedule.length; roundIndex++) {
        for (const pairing of schedule[roundIndex]) {
          const match = await TournamentMatch.create({
            tournamentId: tournament._id,
            phase: 'group_stage',
            round: roundIndex + 1,
            player1Id: pairing.player1Id,
            player2Id: pairing.player2Id,
            status: pairing.player2Id === null ? 'completed' : 'pending',
            winnerId: pairing.player2Id === null ? pairing.player1Id : null
          });
          createdMatches.push(match);

          if (pairing.player2Id === null) {
            await TournamentPlayer.findByIdAndUpdate(pairing.player1Id, { $inc: { points: 3, wins: 1 } });
          }
        }
      }
    }

    res.status(201).json({ matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Calcula la entrada a la fase eliminatoria a partir de los clasificados
// (body: { classifiedIds: [...] }, ya ordenados de mejor a peor seed) y
// crea los TournamentMatch: byes directos (completados) + ronda previa
// reducida si el nº de clasificados no es potencia de 2.
exports.generateGroupsEliminationEntry = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { classifiedIds } = req.body;
    const result = await createEliminationEntryMatches(tournament, classifiedIds);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Liga (issue #44) ---

// Genera el calendario round-robin completo de la liga (phase: 'league_round').
// Si tournament.leagueDoubleRound es true, añade una segunda vuelta con
// local/visitante invertidos, continuando la numeracion de rondas.
exports.generateLeagueRounds = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false });
    const playerIds = players.map((p) => p._id.toString());

    const firstLegSchedule = generateRoundRobinSchedule(playerIds);
    let fullSchedule = firstLegSchedule;

    if (tournament.leagueDoubleRound) {
      // Vuelta: mismos enfrentamientos con local/visitante invertidos
      const secondLegSchedule = firstLegSchedule.map((round) =>
        round.map((pairing) => ({
          player1Id: pairing.player2Id,
          player2Id: pairing.player1Id
        }))
      );
      fullSchedule = [...firstLegSchedule, ...secondLegSchedule];
    }

    const createdMatches = [];
    for (let roundIndex = 0; roundIndex < fullSchedule.length; roundIndex++) {
      for (const pairing of fullSchedule[roundIndex]) {
        // Un bye de round-robin (jugador impar) puede quedar como null tras
        // invertir player1/player2 en la vuelta -- se preserva igual que
        // en la ida, marcando victoria automatica sin partida que jugar.
        const match = await TournamentMatch.create({
          tournamentId: tournament._id,
          phase: 'league_round',
          round: roundIndex + 1,
          player1Id: pairing.player1Id || pairing.player2Id,
          player2Id: pairing.player1Id ? pairing.player2Id : null,
          status: (pairing.player1Id && pairing.player2Id) ? 'pending' : 'completed',
          winnerId: (pairing.player1Id && pairing.player2Id) ? null : (pairing.player1Id || pairing.player2Id)
        });
        createdMatches.push(match);

        if (!pairing.player1Id || !pairing.player2Id) {
          const byePlayerId = pairing.player1Id || pairing.player2Id;
          await TournamentPlayer.findByIdAndUpdate(byePlayerId, { $inc: { points: 3, wins: 1 } });
        }
      }
    }

    res.status(201).json({ totalRounds: fullSchedule.length, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// --- Transicion de fase (issue #24) ---

// Determina el ganador de un enfrentamiento del bracket a partir de sus
// partidas: single_match tiene 1 sola TournamentMatch con winnerId directo.
// two_legs puede tener first_leg+second_leg (agregado de premios, ya que
// second_leg invierte player1/player2 respecto a first_leg) y, si el
// agregado empata, una sudden_death que decide de forma definitiva.
// Devuelve null si el enfrentamiento aun no tiene ganador determinable.
// Agrupa las partidas de una fase por enfrentamiento real (single = 1 sola;
// two_legs = first_leg+second_leg[+sudden_death] enlazadas por tiedMatchId).
// Compartida entre advanceBracketRound y resolvePreliminaryEntry.
function groupMatchesByTiedPair(phaseMatches) {
  const grouped = [];
  const seen = new Set();
  for (const m of phaseMatches) {
    if (seen.has(m._id.toString())) continue;
    const group = [m];
    seen.add(m._id.toString());
    if (m.tiedMatchId) {
      const linked = phaseMatches.filter(
        (other) => !seen.has(other._id.toString()) &&
          (other._id.toString() === m.tiedMatchId.toString() || (other.tiedMatchId && other.tiedMatchId.toString() === m._id.toString()))
      );
      for (const l of linked) {
        group.push(l);
        seen.add(l._id.toString());
      }
    }
    grouped.push(group);
  }
  return grouped;
}

function resolveBracketWinner(matchesForThisPair) {
  const single = matchesForThisPair.find((m) => m.leg === 'single');
  if (single) return single.winnerId ? single.winnerId.toString() : null;

  const suddenDeath = matchesForThisPair.find((m) => m.leg === 'sudden_death');
  if (suddenDeath && suddenDeath.winnerId) return suddenDeath.winnerId.toString();

  const firstLeg = matchesForThisPair.find((m) => m.leg === 'first_leg');
  const secondLeg = matchesForThisPair.find((m) => m.leg === 'second_leg');
  if (!firstLeg || !secondLeg || firstLeg.status !== 'completed' || secondLeg.status !== 'completed') {
    return null; // ida/vuelta aun no completas
  }

  const p1 = firstLeg.player1Id.toString();
  const p2 = firstLeg.player2Id.toString();
  // second_leg invierte player1Id/player2Id respecto a first_leg
  const p1Total = (firstLeg.player1Prizes || 0) + (secondLeg.player2Id.toString() === p1 ? (secondLeg.player2Prizes || 0) : (secondLeg.player1Prizes || 0));
  const p2Total = (firstLeg.player2Prizes || 0) + (secondLeg.player1Id.toString() === p2 ? (secondLeg.player1Prizes || 0) : (secondLeg.player2Prizes || 0));

  if (p1Total > p2Total) return p1;
  if (p2Total > p1Total) return p2;
  return null; // agregado empatado y sin muerte subita todavia -- hace falta crearla manualmente
}

// Cierra la fase de swiss o grupos y genera la entrada a la fase eliminatoria.
// body: { topCut } para swiss_elimination, { qualifiersPerGroup } para
// groups_elimination. El orden de seeding sale del standing real (puntos +
// prizeDifferential), no de un orden arbitrario.
exports.closePhaseToElimination = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    if (!['swiss_elimination', 'groups_elimination'].includes(tournament.structure)) {
      return res.status(400).json({ error: 'Esta accion solo aplica a swiss_elimination o groups_elimination' });
    }

    let classifiedIds;

    if (tournament.structure === 'swiss_elimination') {
      const { topCut } = req.body;
      const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false })
        .sort({ points: -1, prizeDifferential: -1 });
      classifiedIds = players.slice(0, topCut).map((p) => p._id.toString());
    } else {
      const { qualifiersPerGroup } = req.body;
      const players = await TournamentPlayer.find({ tournamentId: tournament._id, dropped: false })
        .sort({ points: -1, prizeDifferential: -1 });

      const groupNames = [...new Set(players.map((p) => p.groupName).filter(Boolean))];
      let qualifiers = [];
      for (const groupName of groupNames) {
        const groupPlayers = players.filter((p) => p.groupName === groupName);
        qualifiers.push(...groupPlayers.slice(0, qualifiersPerGroup));
      }
      // Reordena el conjunto combinado de clasificados de todos los grupos
      // por standing real, para que el seeding de la eliminatoria sea justo
      qualifiers.sort((a, b) => b.points - a.points || b.prizeDifferential - a.prizeDifferential);
      classifiedIds = qualifiers.map((p) => p._id.toString());
    }

    const result = await createEliminationEntryMatches(tournament, classifiedIds);

    // Si hizo falta ronda previa, se guarda la lista de clasificados para
    // que resolvePreliminaryEntry pueda leerla despues sin depender de
    // que el frontend la recuerde/reenvie.
    if (result.preliminaryPhase) {
      tournament.pendingEliminationClassifiedIds = classifiedIds;
      await tournament.save();
    }

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Avanza el bracket a la siguiente fase, emparejando los ganadores de la
// fase indicada en el mismo orden en que se jugaron (match 0 vs match 1,
// match 2 vs match 3...) -- a diferencia de generateEliminationBracket
// (issue #42), que solo sirve para la PRIMERA ronda con seeding/aleatorio.
// Si se avanza desde semifinal y tournament.thirdPlacePlayoff es true,
// tambien genera el partido de 3er/4º puesto con los perdedores.
exports.advanceBracketRound = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const { phase } = req.body;
    const phaseMatches = await TournamentMatch.find({ tournamentId: tournament._id, phase });
    if (phaseMatches.length === 0) {
      return res.status(400).json({ error: `No hay partidas en la fase ${phase}` });
    }

    // Agrupa las partidas por enfrentamiento real (single = 1 sola;
    // two_legs = first_leg+second_leg[+sudden_death] enlazadas por tiedMatchId)
    const grouped = groupMatchesByTiedPair(phaseMatches);

    const winners = [];
    for (const group of grouped) {
      const winnerId = resolveBracketWinner(group);
      if (!winnerId) {
        return res.status(400).json({ error: 'Todavia hay enfrentamientos de esta fase sin resolver (incluida posible muerte subita pendiente)' });
      }
      winners.push(winnerId);
    }

    const next = nextPhase(phase);
    if (!next) {
      return res.status(400).json({ error: 'La final no tiene fase siguiente' });
    }

    const createdMatches = [];
    for (let i = 0; i < winners.length; i += 2) {
      const pairing = { player1Id: winners[i], player2Id: winners[i + 1] };
      const created = await createRealMatch(tournament, next, pairing);
      createdMatches.push(...created);
    }

    // 3er/4º puesto: solo al avanzar desde semifinal, con los perdedores
    if (phase === 'semifinal' && tournament.thirdPlacePlayoff) {
      const losers = grouped.map((group, i) => {
        const winnerId = winners[i];
        const anyMatch = group[0];
        const p1 = anyMatch.player1Id.toString();
        const p2 = anyMatch.player2Id ? anyMatch.player2Id.toString() : null;
        return p1 === winnerId ? p2 : p1;
      }).filter(Boolean);

      if (losers.length === 2) {
        const thirdPlaceMatch = await TournamentMatch.create({
          tournamentId: tournament._id, phase: 'final',
          player1Id: losers[0], player2Id: losers[1], leg: 'single', isThirdPlaceMatch: true
        });
        createdMatches.push(thirdPlaceMatch);
      }
    }

    res.status(201).json({ phase: next, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Lista todos los TournamentMatch de un torneo hosted, ordenados por
// fase (segun el orden logico del bracket/fases) y ronda. Necesario para
// que el frontend pueda pintar rondas/bracket (issue #46).
exports.getHostedMatches = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const matches = await TournamentMatch.find({ tournamentId: tournament._id })
      .sort({ phase: 1, round: 1 });

    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Resuelve la entrada de los "byeIds" (jugadores que se saltaron la ronda
// previa) a la fase destino, una vez la ronda previa este completada.
// Combina byeIds + ganadores de la previa, reordenados por seed, y los
// empareja de verdad (seededPairings) creando las partidas reales.
//
// No requiere body: los classifiedIds se leen de
// tournament.pendingEliminationClassifiedIds, guardados por
// closePhaseToElimination cuando hizo falta ronda previa -- asi no depende
// de que el frontend recuerde/reenvie una lista larga de IDs.
exports.resolvePreliminaryEntry = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.userId });
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

    const classifiedIds = tournament.pendingEliminationClassifiedIds.map((id) => id.toString());
    if (classifiedIds.length === 0) {
      return res.status(400).json({ error: 'No hay ninguna entrada a eliminatoria pendiente de resolver' });
    }

    const { targetPhase, byeIds, preliminary } = calculateEliminationEntry(classifiedIds);

    if (!preliminary) {
      return res.status(400).json({ error: 'Este torneo no tenia ronda previa que resolver' });
    }

    const prelimMatches = await TournamentMatch.find({ tournamentId: tournament._id, phase: preliminary.phase });
    if (prelimMatches.length === 0) {
      return res.status(400).json({ error: 'No se encontraron partidas de la ronda previa' });
    }

    const grouped = groupMatchesByTiedPair(prelimMatches);
    const prelimWinners = [];
    for (const group of grouped) {
      const winnerId = resolveBracketWinner(group);
      if (!winnerId) {
        return res.status(400).json({ error: 'Todavia hay partidas de la ronda previa sin resolver (incluida posible muerte subita pendiente)' });
      }
      prelimWinners.push(winnerId);
    }

    // byeIds ya vienen ordenados de mejor a peor seed; los ganadores de la
    // previa se añaden a continuacion (peores seeds que cualquier bye) y
    // se reordena el conjunto combinado con seededPairings.
    const combined = [...byeIds, ...prelimWinners];
    const pairings = seededPairings(combined);

    const createdMatches = [];
    for (const pairing of pairings) {
      const created = await createRealMatch(tournament, targetPhase, pairing);
      createdMatches.push(...created);
    }

    // Limpia el estado temporal, ya resuelto
    tournament.pendingEliminationClassifiedIds = [];
    await tournament.save();

    res.status(201).json({ phase: targetPhase, matches: createdMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
