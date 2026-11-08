'use strict';

// Repositorio en memoria: para los tests y para probar el router sin base de
// datos. Misma interfaz que repoMongo.js (ver test/repo.test.js).
function crearRepoMemoria() {
  const partidas = new Map();
  const filas = new Map(); // `${partidaId}:${asiento}` → fila

  return {
    async guardarPartida({ partida, jugadores }) {
      const existente = partidas.get(partida.partidaId);
      const creada = !existente;
      if (creada) partidas.set(partida.partidaId, structuredClone(partida));
      // Idempotente: reintentar completa las filas que falten sin duplicar.
      for (const fila of jugadores) {
        const clave = `${fila.partidaId}:${fila.asiento}`;
        if (!filas.has(clave)) filas.set(clave, structuredClone(fila));
      }
      return { creada, partida: structuredClone(partidas.get(partida.partidaId)) };
    },

    async obtenerPartida(partidaId) {
      const p = partidas.get(partidaId);
      return p ? structuredClone(p) : null;
    },

    // Filas del jugador, de la más reciente a la más antigua. `antes` es el
    // cursor { guardadaEn, partidaId } de la última fila de la página anterior.
    async listar(cuentaId, { limite, antes }) {
      let propias = [...filas.values()]
        .filter((f) => f.cuentaId === cuentaId)
        .sort((a, b) => b.guardadaEn.localeCompare(a.guardadaEn) || b.partidaId.localeCompare(a.partidaId));
      if (antes) {
        propias = propias.filter(
          (f) =>
            f.guardadaEn < antes.guardadaEn ||
            (f.guardadaEn === antes.guardadaEn && f.partidaId < antes.partidaId),
        );
      }
      return propias.slice(0, limite).map((f) => structuredClone(f));
    },

    // Suma de lo abonado a la cuenta (los puntos no se gastan).
    async puntosDe(cuentaId) {
      let puntos = 0;
      let partidasJugadas = 0;
      for (const f of filas.values()) {
        if (f.cuentaId !== cuentaId) continue;
        partidasJugadas += 1;
        if (f.abonado) puntos += f.puntos + (f.bonoEstados ?? 0);
      }
      return { puntos, partidas: partidasJugadas };
    },
  };
}

module.exports = { crearRepoMemoria };
