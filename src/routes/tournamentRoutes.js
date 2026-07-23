const express = require('express');
const router = express.Router();
const crudController = require('../controllers/tournament/tournamentCrudController');
const playerController = require('../controllers/tournament/tournamentPlayerController');
const roundsController = require('../controllers/tournament/tournamentRoundsController');
const transferController = require('../controllers/tournament/tournamentTransferController');
const protect = require('../middleware/authMiddleware');

router.use(protect); // aplica el middleware a TODAS las rutas de este archivo

router.get('/', crudController.getTournaments);
router.get('/:id', crudController.getTournamentById);
router.post('/', crudController.createTournament);
router.put('/:id', crudController.updateTournament);
router.delete('/:id', crudController.deleteTournament);
router.post('/:id/standing', crudController.addStandingSnapshot);
router.get('/:id/summary', crudController.getTournamentSummary);
router.post('/:id/swiss-round', roundsController.generateSwissRound);
router.get('/:id/hosted-standings', roundsController.getHostedStandings);
router.get('/:id/hosted-matches', roundsController.getHostedMatches);
router.post('/:id/advance-bracket', roundsController.advanceBracketRound);
router.post('/:id/resolve-preliminary-entry', roundsController.resolvePreliminaryEntry);
router.post('/:id/players', playerController.createPlayer);
router.get('/:id/players', playerController.getPlayers);
router.put('/:id/players/:playerId', playerController.updatePlayer);
router.delete('/:id/players/:playerId', playerController.deletePlayer);
router.put('/:id/hosted-matches/:matchId/result', roundsController.registerMatchResult);
router.post('/:id/elimination-bracket', roundsController.generateEliminationBracket);
router.post('/:id/assign-groups', roundsController.assignPlayerGroups);
router.post('/:id/group-stage-rounds', roundsController.generateGroupStageRounds);
router.post('/:id/groups-elimination-entry', roundsController.generateGroupsEliminationEntry);
router.post('/:id/league-rounds', roundsController.generateLeagueRounds);
router.post('/:id/close-phase', roundsController.closePhaseToElimination);
router.get('/:id/export', transferController.exportTournament);
router.post('/import', transferController.importTournament);

module.exports = router;
