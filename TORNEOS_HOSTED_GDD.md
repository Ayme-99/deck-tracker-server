# Torneos — Modo Hosted (GDD)

Documento de diseño para el modo **hosted** de Torneos: la app aloja el torneo completo (jugadores, emparejamientos, clasificación), a diferencia del modo `tracked` (ya implementado), donde solo se registra el propio historial dentro de un torneo externo.

**Estado:** diseño cerrado para v1, pendiente de desarrollo. Ver issues `#11` (padre, deck-tracker-server), `#19-#25` (backend), `#44-#48` (frontend).

**Objetivo de esta v1:** cubrir el caso de uso real — gestionar un torneo de tienda/liga local desde el propio dispositivo del organizador, sin depender de terceros ni de conexión multi-usuario en tiempo real.

---

## 1. Alcance de la v1

- Un único usuario administra el torneo (sin roles ni torneos públicos — ver v2)
- Datos de todos los jugadores (incluido el propio organizador, si participa) viven dentro del mismo torneo
- El organizador puede **exportar** el torneo completo a JSON y otro usuario puede **importarlo**, señalando qué jugador de la lista es él mismo
- 5 estructuras: `swiss`, `elimination`, `swiss_elimination`, `groups_elimination`, `league`

---

## 2. Modelo de datos

### `TournamentPlayer` (ya creado, issue #19 — pendiente ampliar)

Campos ya existentes: `tournamentId`, `name`, `deckArchetype`, `dropped`.

Campos a añadir para v1:

```js
points: { type: Number, default: 0 },      // 3 victoria / 1 empate / 0 derrota
wins: { type: Number, default: 0 },
losses: { type: Number, default: 0 },
draws: { type: Number, default: 0 },
prizeDifferential: { type: Number, default: 0 }, // suma(premios propios) - suma(premios rival), 1er desempate
opponentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TournamentPlayer' }], // rivales ya enfrentados, para swiss
byeReceived: { type: Boolean, default: false }, // si ya recibio un bye, para no repetir
isOrganizer: { type: Boolean, default: false }  // si este jugador es el propio usuario dueño del torneo
```

Un jugador puede inscribirse con **varios mazos** — esto significa que `deckArchetype` no basta como identificador único; se permite duplicar `name` con distinto `deckArchetype`, o bien un mismo jugador aparece como dos `TournamentPlayer` distintos (uno por mazo). **Decisión: cada inscripción (jugador + mazo) es un `TournamentPlayer` independiente.** Si la misma persona juega con dos mazos, son dos entradas distintas en la tabla — más simple de emparejar y puntuar, aunque signifique que "Juan con mazo A" y "Juan con mazo B" son entidades separadas de cara al torneo.

### `TournamentMatch` (ya creado, issue #20 — pendiente ampliar)

Campos ya existentes: `tournamentId`, `phase`, `round`, `player1Id`, `player2Id`, `winnerId`, `status`, `notes`.

Campos a añadir para v1:

```js
player1Prizes: { type: Number, min: 0, max: 6 },
player2Prizes: { type: Number, min: 0, max: 6 },
isDraw: { type: Boolean, default: false },
// Solo relevante en eliminatoria a ida y vuelta (ver seccion 4.2)
leg: { type: String, enum: ['single', 'first_leg', 'second_leg', 'sudden_death'], default: 'single' },
tiedMatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentMatch', default: null } // enlaza ida<->vuelta (y muerte subita si aplica)
```

---

## 3. Sistema de puntos

- **Victoria = 3 puntos, Empate = 1 punto, Derrota = 0 puntos** (swiss y liga)
- Registro paralelo: **W-L-D** (victorias-derrotas-empates) + puntos totales, mostrado siempre junto (ej. "4-1-0 · 12 pts")
- En eliminatoria directa no hay puntos, solo avance/eliminación

---

## 4. Emparejamientos (pairing) por estructura

### 4.1 Swiss

- **Ronda 1:** 100% aleatorio
- **Rondas siguientes:** empareja jugadores con el mismo número de puntos (o el bucket más cercano posible), evitando repetir un rival ya enfrentado (usa `opponentIds`)
- Si un bucket de puntos tiene un número impar de jugadores, uno baja al bucket inferior para completar
- Si el total de jugadores activos (no `dropped`) es impar, uno recibe **bye** (victoria automática, 3 puntos, sin partida jugada). Se prioriza al jugador de **menor puntuación que aún no haya recibido bye** (`byeReceived: false`)
- **Nº de rondas:** por defecto `ceil(log2(nº_jugadores))` (8→3, 16→4, 32→5...), calculado al indicar cuántos jugadores habrá; **editable manualmente** por el organizador

### 4.2 Eliminación directa

- Bracket clásico. Emparejamientos generados **aleatoriamente**, o **por seeding según standing** si la estructura es `swiss_elimination` (el mejor clasificado de swiss se empareja contra el peor clasificado que pase el corte, etc.)
- **Opción a elegir al crear el torneo:** partidas a **ida y vuelta** o **partido único** (quien gana pasa, quien pierde queda fuera)
  - A ida y vuelta: se generan 2 `TournamentMatch` enlazados vía `tiedMatchId`, y el ganador se decide por resultado agregado (suma de premios de ambas idas)
  - **Si el agregado también empata:** se juega una **muerte súbita** (partido único de desempate), igual que contempla el reglamento oficial de Pokémon TCG. Se registra como un tercer `TournamentMatch` con `leg: 'sudden_death'`, vinculado a los dos anteriores vía `tiedMatchId`; su resultado es definitivo y decide quién avanza
- **Se pregunta al crear el torneo** si se disputan **3er y 4º puesto** (partido extra entre los perdedores de semifinal)

### 4.3 Grupos + eliminación

- Al crear el torneo: nº de participantes, tamaño de cada grupo, y nº de clasificados por grupo
- Los clasificados pasan a la fase eliminatoria. Si el nº de clasificados no es una potencia de 2, los mejores (por seeding/standing dentro de su grupo) reciben **bye** para saltarse la primera ronda eliminatoria:
  ```
  byes = siguiente_potencia_de_2(nº_clasificados) - nº_clasificados
  ```
  Ejemplo: 10 clasificados → siguiente potencia de 2 = 16 → 6 byes. Los 6 mejores pasan directos a cuartos; los otros 4 juegan una ronda previa reducida entre ellos para completar el cuadro de 8

### 4.4 Liga

- Todos contra todos (round-robin). **Opción a elegir:** solo ida, o ida y vuelta

---

## 5. Desempates (tiebreakers)

Orden de aplicación cuando dos o más jugadores empatan a puntos:

1. **Diferencial de premios** (`prizeDifferential`: suma de premios propios menos premios del rival, acumulado) — igual que la diferencia de goles en fútbol
2. **OMW% (Opponent's Match Win Percentage)**: media del % de victorias de todos los rivales a los que te has enfrentado

**OOMW% (Opponent's Opponent's Match Win Percentage) queda fuera de la v1** — computacionalmente más caro (requiere el OMW% de los rivales de tus rivales, en cascada) y solo relevante en el caso raro de empate a puntos **y** a OMW%. Se añadirá en v2 si en la práctica hace falta.

---

## 6. Transición entre fases

- El organizador determina **al crear el torneo** cuántas rondas tendrá la fase de swiss/grupos y cuántos clasifican (top cut, o clasificados por grupo)
- Tras jugarse esas rondas, el sistema (o el organizador manualmente) **cierra la fase** y genera automáticamente los emparejamientos de la fase eliminatoria según el standing final de esa fase

---

## 7. Exportar / Importar torneos

Para cubrir el caso de "alguien gestiona el torneo y otro participante quiere tener sus propios datos en su cuenta":

- **Exportar:** el organizador genera un JSON con el torneo completo (`Tournament`, todos los `TournamentPlayer`, todos los `TournamentMatch`)
- **Importar:** otro usuario carga ese JSON en su cuenta y **indica qué `TournamentPlayer` de la lista es él mismo** — a partir de ahí, ese jugador queda marcado como `isOrganizer: false` pero vinculado a su propio historial/stats personales, igual que si hubiera trackeado el torneo en modo `tracked`
- Sin autenticación compartida ni backend con roles — cada usuario tiene su propia copia importada, independiente de la del organizador original

---

## 8. Fuera de alcance de la v1 (backlog v2)

- **Torneos públicos con enlace + varios admins**: acceso sin JWT (o token de solo lectura tipo "share link"), roles (creador/admin/espectador). Es un cambio de arquitectura de autenticación/permisos, no solo una feature de torneos — se aborda como proyecto aparte cuando haya necesidad real de co-gestión
- **OOMW%** como segundo criterio de desempate

---

## 9. Próximos pasos de desarrollo

1. Ampliar `TournamentPlayer` y `TournamentMatch` con los campos de la sección 2
2. Implementar lógica de emparejamiento swiss (la más usada, y base conceptual para las demás)
3. Diagrama visual de la ronda previa con byes en `groups_elimination` (pendiente, se hará al empezar a desarrollar esa parte)
4. Endpoints CRUD de jugadores/rondas/resultados (issue #23)
5. Endpoint de generación automática de siguiente ronda (issue #24)
6. Exportar/importar (issue nuevo a crear cuando se desarrolle esta parte)
7. Frontend: pantallas de creación, gestión de jugadores, rondas/emparejamientos, clasificación en vivo (issues #44-#47)
