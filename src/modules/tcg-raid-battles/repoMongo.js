'use strict';

// Repositorio sobre MongoDB (driver nativo; con mongoose vale
// `mongoose.connection.db`). Modelo de datos de D-10 §5:
//   incursiones_partidas          una por partida, con el registro completo
//   incursiones_partida_jugadores una por asiento, con lo que se abona
// Los totales de una cuenta se calculan sumando sus filas, nunca se guardan:
// por eso un reintento no puede sumar dos veces.
const COLECCION_PARTIDAS = 'incursiones_partidas';
const COLECCION_JUGADORES = 'incursiones_partida_jugadores';

function crearRepoMongo(db) {
  const partidas = db.collection(COLECCION_PARTIDAS);
  const jugadores = db.collection(COLECCION_JUGADORES);

  return {
    // Llamar una vez al arrancar.
    async asegurarIndices() {
      await jugadores.createIndex({ partidaId: 1, asiento: 1 }, { unique: true });
      await jugadores.createIndex({ cuentaId: 1, guardadaEn: -1, partidaId: -1 });
    },

    async guardarPartida({ partida, jugadores: filas }) {
      let creada = true;
      try {
        await partidas.insertOne({ _id: partida.partidaId, ...partida });
      } catch (e) {
        if (e && e.code === 11000) creada = false;
        else throw e;
      }
      // Idempotente: si un intento anterior se cortó a medias, completa las
      // filas que falten sin tocar las que ya estaban.
      await jugadores.bulkWrite(
        filas.map((fila) => ({
          updateOne: {
            filter: { partidaId: fila.partidaId, asiento: fila.asiento },
            update: { $setOnInsert: fila },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      const guardada = await partidas.findOne({ _id: partida.partidaId });
      const { _id, ...resto } = guardada;
      return { creada, partida: resto };
    },

    async obtenerPartida(partidaId) {
      const p = await partidas.findOne({ _id: partidaId });
      if (!p) return null;
      const { _id, ...resto } = p;
      return resto;
    },

    async listar(cuentaId, { limite, antes }) {
      const filtro = { cuentaId };
      if (antes) {
        filtro.$or = [
          { guardadaEn: { $lt: antes.guardadaEn } },
          { guardadaEn: antes.guardadaEn, partidaId: { $lt: antes.partidaId } },
        ];
      }
      const docs = await jugadores
        .find(filtro)
        .sort({ guardadaEn: -1, partidaId: -1 })
        .limit(limite)
        .toArray();
      return docs.map(({ _id, ...resto }) => resto);
    },

    async puntosDe(cuentaId) {
      const [r] = await jugadores
        .aggregate([
          { $match: { cuentaId } },
          {
            $group: {
              _id: null,
              puntos: {
                $sum: { $cond: ['$abonado', { $add: ['$puntos', { $ifNull: ['$bonoEstados', 0] }] }, 0] },
              },
              partidas: { $sum: 1 },
            },
          },
        ])
        .toArray();
      return { puntos: r ? r.puntos : 0, partidas: r ? r.partidas : 0 };
    },
  };
}

module.exports = { crearRepoMongo, COLECCION_PARTIDAS, COLECCION_JUGADORES };
