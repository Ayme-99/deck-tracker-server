// Crea partidas de eliminatoria con emparejamientos EXACTOS elegidos a
// mano (incluidos byes concretos), saltandose la logica de seeding
// automatico de la API. Se conecta directamente a MongoDB.
//
// Uso: node crear_bracket_manual.js
// Ejecutar DESDE la carpeta deck-tracker-server (para que encuentre el
// paquete 'mongodb' ya instalado como dependencia de mongoose).

const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb://ayme:pitopipa@ac-ctqtowy-shard-00-00.wxbm7pb.mongodb.net:27017,ac-ctqtowy-shard-00-01.wxbm7pb.mongodb.net:27017,ac-ctqtowy-shard-00-02.wxbm7pb.mongodb.net:27017/?ssl=true&replicaSet=atlas-14gqj3-shard-0&authSource=admin&appName=deck-tracker-cluster';
const TOURNAMENT_ID = '6a5e422ffb4a8fc8777ef0d5'; // Deckliminados
const PHASE = 'round_of_16';

// Cada entrada: partido real { player1, player2 }, o bye: solo { player1 }
const PAIRINGS = [
  { player1: 'Ninetales ex' }, // Bye
  { player1: 'Mew VMax', player2: 'Rotom Toolbox' },
  { player1: 'Dragapult ex de Patata' }, // Bye
  { player1: 'Alakazam' }, // Bye
  { player1: 'Metagross de Máximo' }, // Bye
  { player1: 'Mewtwo ex del Team Rocket' }, // Bye
  { player1: 'Aegislash' }, // Bye
  { player1: 'Dragapult ex de Ayme' }, // Bye
  { player1: 'Zoroark ex de N' }, // Bye
  { player1: 'Mega-Charizard X ex', player2: 'Raging-Bolt de Iono' },
  { player1: 'Calirex VMax' }, // Bye
  { player1: 'Mega-Lucario ex' }, // Bye
  { player1: 'Mega-Gardevoir ex' }, // Bye
  { player1: 'Zapdos ex' }, // Bye
  { player1: 'Uxie / Azelf' }, // Bye
  { player1: 'Mega-Abomasnow ex' }, // Bye
];

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log('Conectado a MongoDB.\n');

  const db = client.db();
  const playersCol = db.collection('tournamentplayers');
  const matchesCol = db.collection('tournamentmatches');

  const tournamentId = new ObjectId(TOURNAMENT_ID);
  const allPlayers = await playersCol.find({ tournamentId }).toArray();
  const byName = new Map(allPlayers.map((p) => [p.name, p]));

  console.log(`Jugadores encontrados en el torneo: ${allPlayers.length}`);
  console.log(`Emparejamientos a crear: ${PAIRINGS.length}\n`);

  // Verificacion previa: comprueba que TODOS los nombres existen antes de
  // crear nada, para no dejar el bracket a medias si hay un typo.
  const missing = new Set();
  for (const pairing of PAIRINGS) {
    if (!byName.has(pairing.player1)) missing.add(pairing.player1);
    if (pairing.player2 && !byName.has(pairing.player2)) missing.add(pairing.player2);
  }
  if (missing.size > 0) {
    console.log('Nombres en la lista de jugadores del torneo:');
    allPlayers.forEach((p) => console.log('  -', p.name));
    throw new Error(`No se encontraron estos jugadores: ${[...missing].join(', ')}`);
  }

  const created = [];
  for (const pairing of PAIRINGS) {
    const p1 = byName.get(pairing.player1);
    const p2 = pairing.player2 ? byName.get(pairing.player2) : null;
    const isBye = !p2;

    const doc = {
      tournamentId,
      phase: PHASE,
      round: null,
      player1Id: p1._id,
      player2Id: p2 ? p2._id : null,
      winnerId: isBye ? p1._id : null,
      status: isBye ? 'completed' : 'pending',
      isDraw: false,
      leg: 'single',
      tiedMatchId: null,
      isThirdPlaceMatch: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0
    };

    const result = await matchesCol.insertOne(doc);
    created.push({ ...doc, _id: result.insertedId });
    console.log(`Creado: ${pairing.player1} vs ${pairing.player2 || 'BYE'} (${result.insertedId})`);
  }

  console.log(`\nTotal partidas creadas: ${created.length}`);

  await client.close();
  console.log('Conexion cerrada.');
}

run().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});