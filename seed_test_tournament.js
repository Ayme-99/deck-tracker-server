// Script de prueba: crea un torneo swiss_elimination con 12 jugadores,
// cierra la fase (topCut 12), registra resultados de la ronda previa,
// resuelve la entrada a cuartos, y muestra el estado final de
// hosted-matches. Todo en una sola ejecucion, contra produccion.
//
// Uso: node seed_test_tournament.js
// Requiere Node 18+ (usa fetch nativo).

const BASE_URL = 'https://deck-tracker-server.onrender.com/api';
const USERNAME = 'pruebas';
const PASSWORD = '123456';
const NUM_PLAYERS = 12;

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function run() {
  console.log('1. Login...');
  const { token } = await api('POST', '/auth/login', null, { username: USERNAME, password: PASSWORD });
  console.log('   OK\n');

  console.log('2. Creando torneo...');
  const tournament = await api('POST', '/tournaments', token, {
    name: `Prueba script ${Date.now()}`,
    mode: 'hosted',
    structure: 'swiss_elimination',
    date: new Date().toISOString()
  });
  const tournamentId = tournament._id;
  console.log(`   OK - tournamentId: ${tournamentId}\n`);

  console.log(`3. Creando ${NUM_PLAYERS} jugadores...`);
  const players = [];
  for (let i = 1; i <= NUM_PLAYERS; i++) {
    const player = await api('POST', `/tournaments/${tournamentId}/players`, token, { name: `P${i}` });
    players.push(player);
  }
  console.log(`   OK - ${players.length} jugadores creados\n`);

  console.log('4. Cerrando fase (topCut 12)...');
  const closeResult = await api('POST', `/tournaments/${tournamentId}/close-phase`, token, { topCut: NUM_PLAYERS });
  console.log(`   targetPhase: ${closeResult.targetPhase}`);
  console.log(`   preliminaryPhase: ${closeResult.preliminaryPhase}`);
  console.log(`   Partidas de ronda previa creadas: ${closeResult.matches.length}\n`);

  if (closeResult.preliminaryPhase) {
    console.log('5. Registrando resultados de la ronda previa...');
    for (const match of closeResult.matches) {
      await api('PUT', `/tournaments/${tournamentId}/hosted-matches/${match._id}/result`, token, {
        player1Prizes: 6,
        player2Prizes: 2,
        winnerId: match.player1Id
      });
    }
    console.log(`   OK - ${closeResult.matches.length} resultados registrados\n`);

    console.log('6. Resolviendo entrada a la fase destino...');
    const resolveResult = await api('POST', `/tournaments/${tournamentId}/resolve-preliminary-entry`, token, {});
    console.log(`   phase: ${resolveResult.phase}`);
    console.log(`   Partidas creadas: ${resolveResult.matches.length}\n`);
  }

  console.log('7. Estado final (hosted-matches)...\n');
  const allMatches = await api('GET', `/tournaments/${tournamentId}/hosted-matches`, token);

  const byPhase = {};
  for (const m of allMatches) {
    byPhase[m.phase] = byPhase[m.phase] || [];
    byPhase[m.phase].push(m);
  }
  for (const [phase, matches] of Object.entries(byPhase)) {
    console.log(`--- ${phase} (${matches.length} partidas) ---`);
    for (const m of matches) {
      console.log(`  ${m._id}: ${m.player1Id} vs ${m.player2Id || 'BYE'} (status: ${m.status}, tiedMatchId: ${m.tiedMatchId || '-'})`);
    }
  }

  console.log('\n=== JSON completo (por si quieres pegarlo) ===');
  console.log(JSON.stringify(allMatches, null, 2));

  console.log(`\ntournamentId para seguir probando manualmente: ${tournamentId}`);
}

run().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});