'use strict';
// Reglas de puntos de D-10 (docs/D-10-sistema-de-puntos.md), iguales a las del
// motor (engine/lib/src/puntos.dart). Se usan para comprobar que el resumen que
// envía la app cuadra; el servidor no ejecuta las reglas del juego.

const TOPE_VICTORIA = { 1: 3000, 2: 6000, 3: 9000, 4: 15000 };
const COSTE_DESBLOQUEO = { 1: 10000, 2: 20000, 3: 30000, 4: 40000 };
const REPARTO = { 1: [100], 2: [55, 45], 3: [40, 33, 27], 4: [27, 25, 25, 23] };

// Puntos del equipo. Enteros, igual que el motor, para no depender de decimales.
function puntosTotales({ nivel, hpJefe, danoTotal, resultado }) {
  const tope = TOPE_VICTORIA[nivel];
  if (resultado === 'victoria') {
    return Math.floor((2 * danoTotal * tope + hpJefe) / (2 * hpJefe));
  }
  return Math.floor((danoTotal * tope + 2 * hpJefe) / (4 * hpJefe)) + 1;
}

// Parte de cada puesto: floor(total × %) y el resto del redondeo al puesto 1.
function repartir(total, jugadores) {
  const partes = REPARTO[jugadores].map((p) => Math.floor((total * p) / 100));
  partes[0] += total - partes.reduce((a, b) => a + b, 0);
  return partes;
}

// Bono de estados de un jugador (D-12): tope del nivel ÷ 100 × min(n, 3) en
// victoria y una cuarta parte (mitades hacia arriba) en derrota. Va fuera del
// total del equipo.
const TOPE_APLICACIONES_BONO = 3;
function bonoEstados({ nivel, aplicaciones, resultado }) {
  const completo = (TOPE_VICTORIA[nivel] / 100) * Math.min(aplicaciones, TOPE_APLICACIONES_BONO);
  return resultado === 'victoria' ? completo : Math.floor((completo + 2) / 4);
}

module.exports = { bonoEstados, TOPE_VICTORIA, COSTE_DESBLOQUEO, REPARTO, puntosTotales, repartir };
