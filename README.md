# 🛡️ SentryAgent

Agente personal de control de sistemas vía **Telegram**, con cerebro **Gemini 2.0 Flash** y lógica en **TypeScript**. Diseñado para gestionar la laptop/servidor local de forma remota bajo arquitectura de Confianza Cero.

## Filosofía

- **Costo mínimo:** Gemini 2.0 Flash + lazy loading de contexto vía `INDEX.md`. Solo se cargan los `.md` que la tarea necesita.
- **Cero dependencias innecesarias:** `--env-file` nativo de Node 20.6+ en lugar de `dotenv`. `fetch` nativo en lugar de SDKs.
- **Seguridad activa:** whitelist estricta de `chat_id` + Human-in-the-Loop (HITL) en código para acciones destructivas.
- **Bare metal:** sin Docker, sin frameworks pesados. Control directo sobre la máquina.

## Estructura

```text
SentryAgent/
├── .agent/                  # Contexto del agente
│   ├── agent.md             # Persona + reglas + tono (fusionado, ~200 tokens)
│   ├── INDEX.md             # Mapa de carga perezosa
│   └── memory/
│       ├── learned.md       # Hechos sobre la máquina local
│       └── sessions/        # Historial por sesión (gitignored)
├── src/
│   ├── index.ts             # Bootstrap
│   ├── telegram.ts          # Bot + middleware de seguridad
│   ├── llm.ts               # Cliente Gemini (fetch nativo)
│   ├── executor.ts          # Orquestador + HITL
│   └── actions/
│       ├── files.ts         # Leer / escribir / borrar archivos
│       ├── server.ts        # Reiniciar IIS, Node-RED
│       ├── email.ts         # Enviar / leer correo
│       └── system.ts        # Desbloqueo, exec genérico
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

## Setup

```bash
# 1. Clonar
git clone <repo>
cd SentryAgent

# 2. Instalar
npm install

# 3. Configurar
cp .env.example .env
# Editar .env con tus tokens

# 4. Desarrollo
npm run dev

# 5. Producción
npm run build
npm start
```

## Requisitos

- Node.js >= 20.6 (necesario para `--env-file` nativo)
- Cuenta en [Google AI Studio](https://aistudio.google.com/apikey)
- Bot creado vía [@BotFather](https://t.me/botfather) en Telegram

## Seguridad

- Solo el `ALLOWED_CHAT_ID` configurado puede interactuar con el bot
- Cualquier acción destructiva (borrado, reinicio de servicio) requiere confirmación física vía botón inline en Telegram
- Las sesiones se guardan localmente y nunca se suben al repo
