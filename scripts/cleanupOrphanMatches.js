// Borramos las pártidas huérfanas que quedaron tras eliminar mazos, para no dejar stats huérfanas (issue #31)
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Deck = require('../src/models/Deck');
const Match = require('../src/models/Match');

async function run() {
  await connectDB();

  const deckIds = await Deck.distinct('_id');
  console.log(`Mazos existentes: ${deckIds.length}`);

  const orphans = await Match.countDocuments({ deckId: { $nin: deckIds } });
  console.log(`Partidas huérfanas encontradas: ${orphans}`);

  if (orphans > 0) {
    const result = await Match.deleteMany({ deckId: { $nin: deckIds } });
    console.log(`Eliminadas: ${result.deletedCount}`);
  }

  await mongoose.disconnect();
  console.log('Listo');
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});