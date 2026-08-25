# Deck Tracker – Backend

API REST para gestión de mazos de Pokémon TCG, seguimiento de partidas con estadísticas agregadas, y torneos completos: tanto seguimiento del propio historial (**tracked**) como torneos alojados por la app con varios jugadores (**hosted**).

## Stack

- Node.js + Express
- MongoDB Atlas (vía Mongoose)
- JWT para autenticación
- Desplegado en Render

## URL en producción
https://deck-tracker-server.onrender.com/api

## Estructura del proyecto

```
src/
├── app.js
├── config/
│ └── db.js
├── models/
│ ├── Deck.js
│ ├── Match.js
│ ├── OpponentArchetype.js
│ ├── Tournament.js
│ ├── TournamentPlayer.js # modo hosted: inscripcion de jugador (sin cuenta propia)
│ ├── TournamentMatch.js # modo hosted: partida entre dos TournamentPlayer
│ └── User.js
├── controllers/
│ ├── authController.js
│ ├── deckController.js
│ ├── matchController.js
│ ├── opponentArchetypeController.js
│ ├── pokemonController.js
│ ├── statsController.js
│ └── tournamentController.js # tracked + hosted (creacion, jugadores, pairings, standings, export/import)
├── routes/
│ ├── authRoutes.js
│ ├── deckRoutes.js
│ ├── matchRoutes.js
│ ├── opponentArchetypeRoutes.js
│ ├── pokemonRoutes.js
│ ├── statsRoutes.js
│ └── tournamentRoutes.js
├── services/
│ ├── pokeapiService.js
│ ├── swissPairingService.js # logica pura de emparejamiento suizo
│ ├── eliminationPairingService.js # logica pura de bracket (seeding, fases, byes)
│ ├── groupsEliminationService.js # reparto en grupos + entrada a eliminatoria
│ ├── roundRobinService.js # calendario todos-contra-todos (grupos y liga)
│ └── tiebreakerService.js # calculo de OMW%
└── middleware/
├── authMiddleware.js
└── rateLimitMiddleware.js
├── scripts/
│ └── cleanupOrphanMatches.js # one-off: limpieza de partidas huérfanas (issue #31)
├── tests/
├── models/
├── services/
└── controllers/
```

## Variables de entorno

Crea un archivo `.env` en la raíz con:
MONGO_URI=tu_uri_de_mongodb_atlas
PORT=5000
JWT_SECRET=una_cadena_larga_y_aleatoria
JWT_EXPIRES_IN=30d (opcional; caducidad de la sesión, formato de la librería `jsonwebtoken` — por defecto 30d si no se indica)

## Instalación local

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
```
86+ tests cubriendo modelos, servicios de pairing (logica pura) y controladores, tanto de `tracked` como de `hosted`.

## Endpoints

### Auth (`/api/auth`)
| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/register` | Crea usuario, devuelve token | No |
| POST | `/login` | Login, devuelve token | No |
| GET | `/me` | Datos del usuario autenticado | Sí |

### Decks (`/api/decks`) — todas requieren auth
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/?page=&limit=` | Lista mazos del usuario (paginado) |
| GET | `/:id` | Detalle de un mazo |
| POST | `/` | Crea un mazo |
| PUT | `/:id` | Edita un mazo |
| DELETE | `/:id` | Elimina un mazo **y todas sus partidas en cascada**; devuelve `deletedMatches` con el nº de partidas borradas |
| PATCH | `/:id/stats` | (legacy) suma win/loss simple |

### Matches (`/api/matches`) — todas requieren auth
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/?deckId=&tournamentId=&page=&limit=` | Lista partidas (filtrable por mazo y/o torneo, paginado) |
| GET | `/opponent-suggestions?q=` | Autocompletado de rivales ya registrados |
| GET | `/:id` | Detalle de una partida |
| POST | `/` | Registra una partida |
| PUT | `/:id` | Edita una partida (recalcula el resultado) |
| DELETE | `/:id` | Elimina una partida |

Cada partida guarda `userPrizes` / `opponentPrizes` (cartas premio cogidas por cada lado, 0-6). El campo `result` (`win`/`loss`/`tie`) se calcula automáticamente al guardar. `endReason` admite: `normal`, `concession`, `no_pokemon`, `time`, `deck_out`.

Opcionalmente, una partida puede asociarse a un torneo mediante `tournamentId`, `phase` (`group_stage`, `swiss`, `round_of_64`, `round_of_32`, `round_of_16`, `quarterfinal`, `semifinal`, `final`, `league_round`) y `round`. Si se informa `phase` o `round`, `tournamentId` es obligatorio.

### Stats (`/api/stats`) — todas requieren auth
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/deck/:deckId/overview` | Resumen del mazo: win-rate, totales y promedios de premios |
| GET | `/deck/:deckId/matchups` | Win-rate desglosado por mazo rival, dentro de ese mazo |
| GET | `/deck/:deckId/streak` | Racha actual (victorias/derrotas seguidas) |
| GET | `/global/overview` | Resumen combinado de todos los mazos del usuario |
| GET | `/global/ranking?minMatches=&sortBy=` | Ranking de mazos. `minMatches` (por defecto 3) y `sortBy`: `winRate` (por defecto), `totalMatches` o `deckName` |
| GET | `/global/opponents` | Win-rate contra cada arquetipo rival, agregado a lo largo de **todos** los mazos propios (a diferencia de `/deck/:deckId/matchups`, que es dentro de un solo mazo) |

### Pokémon (`/api/pokemon`) — todas requieren auth
Proxy hacia PokeAPI para no exponer llamadas directas desde el cliente.
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/search?q=` | Busca Pokémon por nombre |
| GET | `/sprite/:name` | Devuelve el sprite de un Pokémon |

### Catálogo de cartas (`/api/cards`) — todas requieren auth
Proxy hacia [TCGdex](https://tcgdex.dev) (gratuita, sin API key, issue #80) para no exponer llamadas directas desde el cliente. Se usa para validar/sugerir el `cardId` real de una carta al añadirla a un mazo, en vez de un slug generado a mano. (Nota: la idea original era pokemontcg.io, pero esa API se integró en Scrydex, de pago sin plan gratuito.)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/search?q=` | Busca cartas reales por nombre (hasta 15 resultados: cardId, nombre, set, número, imagen) |

### Opponent Archetypes (`/api/opponent-archetypes`) — todas requieren auth
Arquetipos de mazos rivales, con sus sprites asociados.
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Lista los arquetipos del usuario |
| GET | `/by-name?name=` | Busca un arquetipo por nombre |
| POST | `/` | Crea o actualiza un arquetipo (upsert) |

### Torneos (`/api/tournaments`) — todas requieren auth

Dos modos, distinguidos por el campo `mode`:

- **`tracked`**: registro del propio historial dentro de un torneo externo (no organizado por la app).
- **`hosted`**: la app aloja el torneo completo, con varios jugadores (sin cuenta propia) y emparejamientos automáticos.

Ambos comparten 5 estructuras posibles (`structure`): `swiss`, `swiss_elimination`, `groups_elimination`, `elimination`, `league`.

#### Comunes a ambos modos
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/?page=&limit=` | Lista torneos del usuario (paginado) |
| GET | `/:id` | Detalle de un torneo. En `tracked`, incluye sus `matches` ordenados por fase/ronda |
| POST | `/` | Crea un torneo. `structure` y `deckId` obligatorios si `mode` es `tracked` |
| PUT | `/:id` | Edita un torneo |
| DELETE | `/:id` | Elimina un torneo; sus partidas (modo `tracked`) **no** se borran, quedan sueltas (se limpia su `tournamentId`/`phase`/`round`) |
| GET | `/:id/summary` | Resumen W-L-T global y desglosado por fase (solo `tracked`) |
| POST | `/:id/standing` | Añade un snapshot manual de puntos/posición. Solo válido si `structure` es `league` (modo `tracked`) |

#### Modo `hosted` — jugadores
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/:id/players` | Crea una inscripción (jugador). `isOrganizer: true` requiere `deckId` (tu mazo real, si participas tú) |
| GET | `/:id/players` | Lista los jugadores del torneo |
| PUT | `/:id/players/:playerId` | Edita un jugador (nombre, `dropped`, etc.) |
| DELETE | `/:id/players/:playerId` | Elimina un jugador (sin cascada sobre sus partidas) |

#### Modo `hosted` — rondas y emparejamientos
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/:id/swiss-round` | Genera la siguiente ronda suiza (evita repetir rivales, byes automáticos) |
| POST | `/:id/elimination-bracket` | Genera el bracket inicial de eliminación directa (`seeded` o aleatorio) |
| POST | `/:id/advance-bracket` | Avanza el bracket a la fase siguiente, emparejando ganadores. Resuelve ida/vuelta (agregado de premios) y muerte súbita |
| POST | `/:id/assign-groups` | Reparte los jugadores en grupos (`groupSize`) |
| POST | `/:id/group-stage-rounds` | Genera el calendario todos-contra-todos de cada grupo |
| POST | `/:id/league-rounds` | Genera el calendario de liga (ida, o ida y vuelta si `leagueDoubleRound`) |
| POST | `/:id/close-phase` | Cierra la fase suiza (`topCut`) o de grupos (`qualifiersPerGroup`) y calcula la entrada a eliminatoria (byes + ronda previa si el nº de clasificados no es potencia de 2) |
| POST | `/:id/resolve-preliminary-entry` | Resuelve la entrada a la fase destino tras completar la ronda previa reducida |
| PUT | `/:id/hosted-matches/:matchId/result` | Registra el resultado de una partida. Si el jugador es `isOrganizer`, genera automáticamente un `Match` normal vinculado a su `deckId`, para que cuente en sus stats |
| GET | `/:id/hosted-matches` | Lista todas las partidas del torneo |
| GET | `/:id/hosted-standings` | Clasificación: puntos, W-L-D, y desempates (diferencial de premios, luego OMW%) |

#### Modo `hosted` — exportar / importar
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/:id/export` | Exporta el torneo completo (jugadores + partidas + resultados) a JSON |
| POST | `/import` | Importa un torneo exportado. `selfPlayerId` + `selfDeckId` opcionales, para vincular una inscripción a tu cuenta |

> Diseño completo del modo hosted: ver [`TORNEOS_HOSTED_GDD.md`](./TORNEOS_HOSTED_GDD.md) — bracket de eliminatoria soportado hasta 64 jugadores en la primera ronda (issue #67).

## Autenticación

Todas las rutas protegidas requieren el header:
Authorization: Bearer <token>

- El token se obtiene en `/api/auth/register` o `/api/auth/login` y caduca según `JWT_EXPIRES_IN` (30 días por defecto). Al caducar, el cliente lo trata como sesión expirada y redirige a Login.
- Los endpoints `/register` y `/login` tienen un límite de 10 intentos por IP cada 15 minutos para mitigar fuerza bruta y spam.
- Un `401` en cualquier ruta protegida indica token ausente, inválido o caducado; el cliente lo trata como sesión caducada solo si la petición llevaba token.

## Scripts de mantenimiento

- `node scripts/cleanupOrphanMatches.js`: elimina partidas cuyo mazo ya no existe. Solo necesario para datos anteriores al borrado en cascada (issue #31); ejecutado una vez el 10/07/2026 (31 partidas eliminadas).

## Deploy

Conectado a Render con auto-deploy en cada push a `main`. Variables de entorno configuradas en el dashboard de Render (Environment).
