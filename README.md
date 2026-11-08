# TCGMasters – Servidor

API REST de TCGMasters con tres módulos (usuarios, Deck Tracker y TCG Raid Battles). Deck Tracker: gestión de mazos de Pokémon TCG, seguimiento de partidas con estadísticas agregadas, torneos completos (tanto seguimiento del propio historial -**tracked**- como torneos alojados por la app con varios jugadores -**hosted**-), y sistema de amigos con invitaciones a torneos.

## Stack

- Node.js + Express
- MongoDB Atlas (vía Mongoose)
- JWT para autenticación
- Desplegado en Render

## URL en producción
https://deck-tracker-server.onrender.com/api

## Estructura del proyecto

El servidor es **uno solo** (un único proceso y una única base de MongoDB) pero el código está separado en tres módulos bajo `src/modules/`. `src/app.js` solo monta las rutas de cada uno.

```
src/
├── app.js                      # arranque: CORS, JSON, health y montaje de los tres módulos
├── config/
│   └── db.js                   # conexión a MongoDB (compartida)
└── modules/
    ├── usuarios/               # cuentas, sesión y amistades
    │   ├── models/             # User, FriendRequest (pending/accepted/rejected/blocked)
    │   ├── controllers/        # authController, friendController
    │   ├── routes/             # /api/auth, /api/friends
    │   ├── middleware/         # authMiddleware (JWT, `protect`), rateLimitMiddleware
    │   └── services/           # emailService
    ├── deck-tracker/           # mazos, partidas, estadísticas y torneos
    │   ├── models/             # Deck, Match, OpponentArchetype, Tournament, TournamentPlayer, TournamentMatch, TournamentInvite
    │   ├── controllers/        # deck, match, stats, pokemon, cardCatalog, opponentArchetype, tournamentInvite y tournament/ (por responsabilidad)
    │   ├── routes/             # /api/decks, /matches, /stats, /pokemon, /cards, /opponent-archetypes, /tournaments, /tournament-invites
    │   └── services/           # emparejamientos (suizo, eliminatoria, grupos, liga), desempates, pokeapi, tcgdex, deckStats, acceso a torneos
    └── tcg-raid-battles/       # Game Master de Incursiones (/api/incursiones)
        ├── montar.js           # único archivo propio de este repo (pegamento con usuarios y MongoDB)
        └── ...                 # resto vendorizado desde TCG-Raid-Battles (ver ORIGEN.md)
scripts/                        # one-off: cleanupOrphanMatches.js (issue #31)
tests/                          # refleja los módulos: usuarios/, deck-tracker/, tcg-raid-battles/
```

### Dependencias entre módulos

- `usuarios` es la base: `authMiddleware` (`protect`) y el modelo `User` los usan los otros dos módulos.
- `deck-tracker` usa `User` y `FriendRequest` (invitaciones a torneo) de `usuarios`.
- `usuarios` conoce datos de `deck-tracker` en dos sitios: el borrado en cascada de una cuenta (`authController`) y las estadísticas de mazos de un amigo (`friendController`).
- `tcg-raid-battles` solo depende de `usuarios` (`protect` y `User`).
- Los modelos se importan siempre por ruta directa; evita añadir dependencias nuevas entre `usuarios` y `deck-tracker` sin necesidad.

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

### Health (`/health`)
Fuera del prefijo `/api`. Sin autenticación y sin acceso a la base de datos; se usa para el keep-alive (ver [Deploy](#deploy)).
| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| GET | `/health` | Devuelve `{ "status": "ok" }` | No |

### Auth (`/api/auth`)
| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/register` | Crea usuario (requiere `username`, `password`, `email`), devuelve token. Envía un correo de verificación (best-effort: si el envío falla, la cuenta se crea igualmente) | No |
| POST | `/login` | Login, devuelve token | No |
| GET | `/me` | Datos del usuario autenticado | Sí |
| GET | `/verify-email?token=` | Verifica el email a partir del enlace del correo (página HTML de resultado, pensada para abrirse desde el navegador) | No |
| POST | `/resend-verification` | Reenvía el correo de verificación (cooldown de 60s entre reenvíos) | Sí |
| POST | `/change-password` | Cambia la contraseña, requiere `currentPassword` y `newPassword` | Sí |
| POST | `/change-username` | Cambia el nombre de usuario (`username`, 3-20 caracteres, letras/números/`_`) | Sí |
| POST | `/change-avatar` | Sube/cambia la foto de perfil (`avatarBase64`, data URI `image/png\|jpeg\|webp`, límite 2MB — ruta con su propio `express.json({ limit: '2mb' })`, el resto de la API se queda en el límite por defecto) | Sí |
| POST | `/change-email` | Añade o cambia el email de la cuenta (`email`). Mismo endpoint para ambos casos — útil para cuentas anteriores a la #268 que aún no tenían email. Queda sin verificar y se reenvía el correo de verificación | Sí |
| POST | `/delete-account` | Elimina la cuenta (requiere `password` de confirmación). Borra en cascada sus torneos propios (jugadores, partidas e invitaciones) y sus propias partidas/mazos; en torneos propios con participantes de otras cuentas, desvincula (no borra) sus partidas para no perder su historial | Sí |

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

### Amigos (`/api/friends`) — todas requieren auth
Una sola relación por par de usuarios (`FriendRequest`), con estado `pending` / `accepted` / `rejected` / `blocked`.
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/search?q=` | Busca usuarios por username (solo expone el username, nada más de la cuenta) |
| GET | `/requests?type=incoming\|outgoing` | Lista solicitudes pendientes, entrantes o salientes |
| POST | `/requests` | Envía una solicitud de amistad, por `username`. Si había una solicitud rechazada previa, se reutiliza (vuelve a quedar pendiente) |
| POST | `/requests/:id/accept` | Acepta una solicitud entrante |
| POST | `/requests/:id/reject` | Rechaza una solicitud entrante |
| GET | `/` | Lista los amigos actuales (relaciones aceptadas) |
| DELETE | `/:friendId` | Elimina una amistad ya aceptada |
| GET | `/:friendId/decks` | Lista los mazos de un amigo (solo si la amistad está aceptada) |
| GET | `/blocked` | Lista los usuarios que has bloqueado |
| POST | `/:userId/block` | Bloquea a un usuario (impide nuevas solicitudes en cualquier dirección) |
| DELETE | `/:userId/block` | Desbloquea; solo puede hacerlo quien bloqueó |

### Invitaciones a torneo (`/api/tournament-invites`) — todas requieren auth
Invitar a un amigo a un torneo hosted propio (requiere amistad aceptada, ver arriba). Al aceptar, crea el `TournamentPlayer` vinculado a la cuenta (`linkedUserId` + `role`).
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Lista las invitaciones pendientes recibidas |
| POST | `/:id/accept` | Acepta una invitación |
| POST | `/:id/reject` | Rechaza una invitación |

Enviar la invitación se hace desde el propio torneo: `POST /api/tournaments/:id/invites` con `userId` y `role` (`admin` o `guest`) — ver más abajo.

### Torneos (`/api/tournaments`) — todas requieren auth

Dos modos, distinguidos por el campo `mode`:

- **`tracked`**: registro del propio historial dentro de un torneo externo (no organizado por la app).
- **`hosted`**: la app aloja el torneo completo, con varios jugadores (con o sin cuenta propia) y emparejamientos automáticos.

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

#### Modo `hosted` — jugadores e invitaciones
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/:id/players` | Crea una inscripción (jugador). `isOrganizer: true` requiere `deckId` (tu mazo real, si participas tú) |
| GET | `/:id/players` | Lista los jugadores del torneo (documento completo, incluye `linkedUserId`/`role` si el jugador está vinculado a una cuenta) |
| PUT | `/:id/players/:playerId` | Edita un jugador (nombre, `dropped`, etc.) |
| DELETE | `/:id/players/:playerId` | Elimina un jugador (sin cascada sobre sus partidas) |
| POST | `/:id/invites` | Invita a un amigo (`userId`, `role`: `admin`/`guest`) a unirse como jugador vinculado a su cuenta |

> **Permisos (issue server#102):** un torneo solo era visible para su dueño. Ahora, un jugador invitado y vinculado (`TournamentPlayer.linkedUserId`) también puede leerlo: aparece en su propio `GET /` (listado), y puede consultar `GET /:id`, `GET /:id/players`, `GET /:id/hosted-matches` y `GET /:id/hosted-standings` de ese torneo — pero editarlo, gestionar jugadores o registrar resultados de otros sigue exigiendo ser el dueño.

#### Modo `hosted` — rondas y emparejamientos
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/:id/swiss-round` | Genera la siguiente ronda suiza (evita repetir rivales, byes automáticos) |
| POST | `/:id/elimination-bracket` | Genera el bracket inicial de eliminación directa (`seeded` o aleatorio) |
| POST | `/:id/advance-bracket` | Avanza el bracket a la fase siguiente, emparejando ganadores. Resuelve ida/vuelta (agregado de premios) y muerte súbita |
| POST | `/:id/assign-groups` | Reparte los jugadores en grupos (`groupSize`) |
| POST | `/:id/group-stage-rounds` | Genera el calendario todos-contra-todos de cada grupo |
| POST | `/:id/groups-elimination-entry` | Calcula la entrada a eliminatoria tras la fase de grupos |
| POST | `/:id/league-rounds` | Genera el calendario de liga (ida, o ida y vuelta si `leagueDoubleRound`) |
| POST | `/:id/close-phase` | Cierra la fase suiza (`topCut`) o de grupos (`qualifiersPerGroup`) y calcula la entrada a eliminatoria (byes + ronda previa si el nº de clasificados no es potencia de 2) |
| POST | `/:id/resolve-preliminary-entry` | Resuelve la entrada a la fase destino tras completar la ronda previa reducida |
| PUT | `/:id/hosted-matches/:matchId/result` | Registra el resultado de una partida. Si el jugador es `isOrganizer` (o tiene cuenta vinculada), genera automáticamente un `Match` normal vinculado a su `deckId`, para que cuente en sus stats |
| GET | `/:id/hosted-matches` | Lista todas las partidas del torneo |
| GET | `/:id/hosted-standings` | Clasificación: puntos, W-L-D, y desempates (diferencial de premios, luego OMW%) |

#### Modo `hosted` — exportar / importar
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/:id/export` | Exporta el torneo completo (jugadores + partidas + resultados) a JSON |
| POST | `/import` | Importa un torneo exportado. `selfPlayerId` + `selfDeckId` opcionales, para vincular una inscripción a tu cuenta |

> Diseño completo del modo hosted: ver [`TORNEOS_HOSTED_GDD.md`](./TORNEOS_HOSTED_GDD.md) — bracket de eliminatoria soportado hasta 64 jugadores en la primera ronda (issue #67).

## Incursiones (`/api/incursiones`)

Backend del Game Master de Incursiones (repo [TCG-Raid-Battles](https://github.com/Ayme-99/TCG-Raid-Battles)). Reutiliza las cuentas, el JWT y la base de este servidor; no hay servicio aparte.

- `src/modules/tcg-raid-battles/` es el módulo **tal como sale del otro repo**: no se edita aquí (ver `ORIGEN.md`). Se actualiza con `node server/scripts/exportar.js <este repo>/src/modules/tcg-raid-battles` desde TCG-Raid-Battles.
- `src/modules/tcg-raid-battles/montar.js` es lo único propio de Deck Tracker: usa `protect` (el id sale de `req.userId`), comprueba las cuentas contra el modelo `User` y crea el repositorio de MongoDB, con sus índices, en la primera petición.
- Colecciones nuevas: `incursiones_partidas` e `incursiones_partida_jugadores`.
- El cuerpo de estas rutas admite hasta 1 MB (un registro de partida lleva todos los eventos).

| Método y ruta | Qué hace |
|---|---|
| `POST /api/incursiones/partidas` | Guarda una partida terminada (idempotente por `partidaId`) y abona los puntos |
| `GET /api/incursiones/partidas` | Historial de la cuenta, paginado |
| `GET /api/incursiones/partidas/:id` | Registro completo (solo para quien jugó) |
| `GET /api/incursiones/me/puntos` | Puntos acumulados y lo que falta para desbloquear jefes |

Todas requieren `Authorization: Bearer <token>`. Detalle de errores y validaciones: `server/README.md` en TCG-Raid-Battles.

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

### Keep-alive (evitar que el servidor se duerma)

El plan gratuito de Render duerme el servicio tras 15 minutos sin tráfico entrante, y el siguiente arranque en frío tarda alrededor de un minuto (durante ese tiempo responde `503`). Para evitarlo, el servidor expone `GET /health` (responde `{ "status": "ok" }`, sin autenticación ni acceso a la base de datos) y hay dos pings independientes que lo llaman:

| Ping | Dónde se configura | Frecuencia |
| --- | --- | --- |
| Monitor HTTP externo (plan gratuito) | Panel del servicio de monitorización, fuera de este repo | Cada 5 minutos |
| Workflow de GitHub Actions `.github/workflows/keep-alive.yml` | Este repo | Cada ~10 minutos (`schedule`) y manual (`workflow_dispatch`) |

- El monitor externo es el ping principal. Tiene avisos por email por si el servidor devuelve `503` o deja de responder.
- El workflow de GitHub es un respaldo: GitHub puede retrasar o saltarse ejecuciones programadas, y las desactiva tras 60 días sin actividad en el repo. Si el servidor vuelve a dormirse, comprobar en la pestaña Actions que sigue activo y que aparecen ejecuciones con el evento `schedule`.
- El plan gratuito de Render incluye 750 horas de instancia al mes por workspace. Un solo servicio siempre despierto gasta unas 720, así que no conviene añadir un segundo Web Service gratuito en el mismo workspace. La web (`deck-tracker-web`) es un Static Site y no consume horas.
- Para probar el endpoint a mano: `curl https://deck-tracker-server.onrender.com/health`.
