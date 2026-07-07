# Deck Tracker – Backend

API REST para gestión de mazos de Pokémon TCG y seguimiento de partidas, con estadísticas agregadas por mazo y globales.

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
│   └── db.js
├── models/
│   ├── Deck.js
│   ├── Match.js
│   └── User.js
├── controllers/
│   ├── authController.js
│   ├── deckController.js
│   ├── matchController.js
│   └── statsController.js
├── routes/
│   ├── authRoutes.js
│   ├── deckRoutes.js
│   ├── matchRoutes.js
│   └── statsRoutes.js
└── middleware/
    └── authMiddleware.js
```

## Variables de entorno

Crea un archivo `.env` en la raíz con:
MONGO_URI=tu_uri_de_mongodb_atlas
PORT=5000
JWT_SECRET=una_cadena_larga_y_aleatoria

## Instalación local

```bash
npm install
npm run dev
```

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
| DELETE | `/:id` | Elimina un mazo |
| PATCH | `/:id/stats` | (legacy) suma win/loss simple |

### Matches (`/api/matches`) — todas requieren auth
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/?deckId=&page=&limit=` | Lista partidas (filtrable por mazo, paginado) |
| GET | `/opponent-suggestions?q=` | Autocompletado de rivales ya registrados |
| GET | `/:id` | Detalle de una partida |
| POST | `/` | Registra una partida |
| PUT | `/:id` | Edita una partida (recalcula el resultado) |
| DELETE | `/:id` | Elimina una partida |

Cada partida guarda `userPrizes` / `opponentPrizes` (cartas premio cogidas por cada lado, 0-6). El campo `result` (`win`/`loss`/`tie`) se calcula automáticamente al guardar. `endReason` admite: `normal`, `concession`, `no_pokemon`, `time`, `deck_out`.

### Stats (`/api/stats`) — todas requieren auth
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/deck/:deckId/overview` | Resumen del mazo: win-rate, totales y promedios de premios |
| GET | `/deck/:deckId/matchups` | Win-rate desglosado por mazo rival |
| GET | `/deck/:deckId/streak` | Racha actual (victorias/derrotas seguidas) |
| GET | `/global/overview` | Resumen combinado de todos los mazos del usuario |
| GET | `/global/ranking?minMatches=` | Ranking de mazos por win-rate (mínimo de partidas configurable, por defecto 3) |

## Autenticación

Todas las rutas protegidas requieren el header:
Authorization: Bearer <token>

- El token se obtiene en `/api/auth/register` o `/api/auth/login` y no tiene expiración (sesión indefinida hasta que el usuario cierre sesión manualmente).
- Los endpoints `/register` y `/login` tienen un límite de 10 intentos por IP cada 15 minutos para mitigar fuerza bruta y spam.

## Deploy

Conectado a Render con auto-deploy en cada push a `main`. Variables de entorno configuradas en el dashboard de Render (Environment).