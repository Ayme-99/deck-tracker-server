const express = require('express');
const router = express.Router();
const crudController = require('../controllers/tournament/tournamentCrudController');
const playerController = require('../controllers/tournament/tournamentPlayerController');
const swissController = require('../controllers/tournament/tournamentSwissController');
const eliminationController = require('../controllers/tournament/tournamentEliminationController');
const groupsLeagueController = require('../controllers/tournament/tournamentGroupsLeagueController');
const resultsController = require('../controllers/tournament/tournamentResultsController');
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
router.post('/:id/swiss-round', swissController.generateSwissRound);
router.get('/:id/hosted-standings', resultsController.getHostedStandings);
router.get('/:id/hosted-matches', resultsController.getHostedMatches);
router.post('/:id/advance-bracket', eliminationController.advanceBracketRound);
router.post('/:id/resolve-preliminary-entry', eliminationController.resolvePreliminaryEntry);
router.post('/:id/players', playerController.createPlayer);
router.get('/:id/players', playerController.getPlayers);
router.put('/:id/players/:playerId', playerController.updatePlayer);
router.delete('/:id/players/:playerId', playerController.deletePlayer);
router.put('/:id/hosted-matches/:matchId/result', resultsController.registerMatchResult);
router.post('/:id/elimination-bracket', eliminationController.generateEliminationBracket);
router.post('/:id/assign-groups', groupsLeagueController.assignPlayerGroups);
router.post('/:id/group-stage-rounds', groupsLeagueController.generateGroupStageRounds);
router.post('/:id/groups-elimination-entry', groupsLeagueController.generateGroupsEliminationEntry);
router.post('/:id/league-rounds', groupsLeagueController.generateLeagueRounds);
router.post('/:id/close-phase', eliminationController.closePhaseToElimination);
router.get('/:id/export', transferController.exportTournament);
router.post('/import', transferController.importTournament);

module.exports = router;
