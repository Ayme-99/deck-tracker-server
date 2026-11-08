'use strict';
const { TOPE_VICTORIA, REPARTO, puntosTotales, repartir, bonoEstados } = require('./puntos');

// Aplicaciones de estados que cuentan para cada asiento (D-12): las que dejan
// al jefe con un estado que no tenía. El veneno es permanente; la quemadura se
// quita cuando la moneda sale cara. Sale solo del registro de eventos.
function aplicacionesContables(eventos, jugadores) {
  const cuenta = new Array(jugadores).fill(0);
  let envenenado = false;
  let quemado = false;
  for (const e of eventos) {
    if (e.tipo === 'aplicarEstadoJefe') {
      if (e.estado === 'veneno' && !envenenado) {
        envenenado = true;
        if (e.jugador < jugadores) cuenta[e.jugador] += 1;
      } else if (e.estado === 'quemadura' && !quemado) {
        quemado = true;
        if (e.jugador < jugadores) cuenta[e.jugador] += 1;
      }
    } else if (e.tipo === 'finTurnoJefe' && quemado && e.monedaQuemadura === true) {
      quemado = false;
    }
  }
  return cuenta;
}

// Comprueba que el resumen de una partida cuadra con su registro y con las
// reglas de puntos. No reproduce la partida (eso es del motor Dart): solo
// detecta resúmenes incoherentes. Devuelve la lista de motivos (vacía si
// todo cuadra).
function comprobarCoherencia(registro) {
  const motivos = [];
  const { resumen, cuentas, eventos } = registro;

  if (!resumen) {
    return ['falta el resumen: solo se guardan partidas terminadas'];
  }
  if (!cuentas) {
    return ['faltan las cuentas: hace falta saber a qué cuenta abonar cada puesto'];
  }

  const config = eventos.find((e) => e.tipo === 'configurarJugadores');
  const jefe = eventos.find((e) => e.tipo === 'elegirJefe');
  if (!config) return ['el registro no tiene el evento configurarJugadores'];
  if (!jefe) return ['el registro no tiene el evento elegirJefe'];

  const n = config.jugadores.length;
  if (cuentas.length !== n) {
    motivos.push(`cuentas tiene ${cuentas.length} elementos y la partida ${n} jugadores`);
  }
  const ids = cuentas.filter((c) => c !== null);
  if (new Set(ids).size !== ids.length) {
    motivos.push('una misma cuenta aparece en más de un asiento');
  }
  if (resumen.jugadores.length !== n) {
    motivos.push(`el resumen tiene ${resumen.jugadores.length} jugadores y la partida ${n}`);
    return motivos; // el resto de comprobaciones no tiene sentido
  }

  if (resumen.nivel !== jefe.nivel) motivos.push('el nivel del resumen no es el del jefe elegido');
  if ((resumen.jefeId ?? null) !== (jefe.jefeId ?? null)) {
    motivos.push('el jefeId del resumen no es el del jefe elegido');
  }

  // Resultado y daño.
  const abandono = eventos.some((e) => e.tipo === 'abandonar');
  if (abandono && resumen.resultado !== 'derrota') {
    motivos.push('una partida con abandono es una derrota');
  }
  if (resumen.danoTotal > jefe.hp) motivos.push('danoTotal supera el HP del jefe');
  if (resumen.resultado === 'victoria' && resumen.danoTotal !== jefe.hp) {
    motivos.push('una victoria deja al jefe a 0 HP: danoTotal debe ser igual a su HP');
  }
  if (resumen.resultado === 'derrota' && resumen.danoTotal >= jefe.hp) {
    motivos.push('una derrota no puede dejar al jefe a 0 HP');
  }

  // Puntos del equipo.
  const Y = TOPE_VICTORIA[resumen.nivel] / jefe.hp;
  if (Math.abs(resumen.coeficienteY - Y) > 1e-9 * Math.max(1, Y)) {
    motivos.push('coeficienteY no es tope del nivel ÷ HP del jefe');
  }
  const total = puntosTotales({
    nivel: resumen.nivel,
    hpJefe: jefe.hp,
    danoTotal: resumen.danoTotal,
    resultado: resumen.resultado,
  });
  if (resumen.puntosTotal !== total) {
    motivos.push(`puntosTotal debería ser ${total}, no ${resumen.puntosTotal}`);
  }

  // Reparto por puesto, asientos y abonos.
  const porcentajes = REPARTO[n];
  const partes = repartir(resumen.puntosTotal, n);
  const asientos = new Set();
  const contables = aplicacionesContables(eventos, n);
  resumen.jugadores.forEach((j, i) => {
    if (j.puesto !== i + 1) motivos.push(`jugadores[${i}]: el puesto debe ser ${i + 1}`);
    if (j.asiento >= n || asientos.has(j.asiento)) {
      motivos.push(`jugadores[${i}]: asiento ${j.asiento} repetido o fuera de la mesa`);
      return;
    }
    asientos.add(j.asiento);
    if (j.nombre !== config.jugadores[j.asiento].nombre) {
      motivos.push(`jugadores[${i}]: el nombre no es el del asiento ${j.asiento}`);
    }
    if (j.porcentaje !== porcentajes[i]) {
      motivos.push(`jugadores[${i}]: el porcentaje del puesto ${i + 1} es ${porcentajes[i]}`);
    }
    if (j.puntos !== partes[i]) {
      motivos.push(`jugadores[${i}]: los puntos deberían ser ${partes[i]}, no ${j.puntos}`);
    }
    // Versión 2: estados del jefe (D-12). En la 1 no existen y el bono es 0.
    const aplicadas = j.estadosAplicados ?? 0;
    const bono = j.bonoEstados ?? 0;
    if (aplicadas !== contables[j.asiento]) {
      motivos.push(
        `jugadores[${i}]: estadosAplicados debería ser ${contables[j.asiento]}, no ${aplicadas}`,
      );
    }
    const bonoEsperado = bonoEstados({
      nivel: resumen.nivel,
      aplicaciones: contables[j.asiento],
      resultado: resumen.resultado,
    });
    if (bono !== bonoEsperado) {
      motivos.push(`jugadores[${i}]: bonoEstados debería ser ${bonoEsperado}, no ${bono}`);
    }
    if (cuentas.length === n) {
      const cobra = cuentas[j.asiento] !== null;
      if (j.abonado !== cobra) {
        motivos.push(`jugadores[${i}]: abonado debe ser ${cobra} según las cuentas`);
      }
    }
  });
  return motivos;
}

// Lo que se abona a cada cuenta: la parte de los puestos con cuenta.
function abonos(registro) {
  const salida = [];
  for (const j of registro.resumen.jugadores) {
    const cuentaId = registro.cuentas[j.asiento];
    salida.push({
      asiento: j.asiento,
      cuentaId,
      nombre: j.nombre,
      dano: j.dano,
      pokemonPerdidos: j.pokemonPerdidos,
      puesto: j.puesto,
      porcentaje: j.porcentaje,
      puntos: j.puntos,
      estadosAplicados: j.estadosAplicados ?? 0,
      bonoEstados: j.bonoEstados ?? 0,
      abonado: cuentaId !== null && j.abonado,
    });
  }
  return salida;
}

module.exports = { comprobarCoherencia, abonos };
