// trustProxy: honour X-Forwarded-* headers set by Caddy so request.ip and
// the rate limiter see the real client address. Safe here because the app
// is only reachable through the Caddy container on the private bridge —
// do NOT enable this if the app is exposed directly to untrusted clients.
const fastify = require('fastify')({ logger: true, trustProxy: true });
const path = require('path');
const cors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static');
const jwt = require('@fastify/jwt');
const fastifyCookie = require('@fastify/cookie');
const { Server } = require('socket.io');

require('dotenv').config();

// Boot-time validation
const REQUIRED_ENV = ['JWT_SECRET', 'DB_PATH', 'PORT'];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const KNOWN_WEAK_SECRETS = [
  'replace_with_a_random_64_character_string',
  'supersecretkeyreplace_with_a_random_64_character_string',
];
const jwtSecret = process.env.JWT_SECRET || '';
const isWeakSecret =
  KNOWN_WEAK_SECRETS.includes(jwtSecret) ||
  jwtSecret.length < 32;

if (isWeakSecret) {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════╗');
  console.error('║              ⚠  SECURITY WARNING  ⚠                         ║');
  console.error('╠══════════════════════════════════════════════════════════════╣');
  console.error('║  JWT_SECRET in your .env file is weak or still set to the   ║');
  console.error('║  default placeholder value.                                  ║');
  console.error('║                                                              ║');
  console.error('║  Anyone who knows this value can forge authentication        ║');
  console.error('║  tokens and log in as any user without a password.           ║');
  console.error('║                                                              ║');
  console.error('║  HOW TO FIX:                                                 ║');
  console.error('║  1. Run:  openssl rand -hex 64                               ║');
  console.error('║  2. Copy the output into your .env file:                     ║');
  console.error('║     JWT_SECRET=<paste generated value here>                  ║');
  console.error('║  3. Restart the server.                                      ║');
  console.error('║                                                              ║');
  console.error('║  The server will continue running, but you should fix this   ║');
  console.error('║  before exposing the app to any network.                     ║');
  console.error('╚══════════════════════════════════════════════════════════════╝');
  console.error('');
}

// Register plugins
// In production, CORS is disabled (origin: false) because Caddy serves both
// frontend and API from the same origin. If deployed without a reverse proxy,
// set CORS_ORIGIN env var or add an explicit allowed origin here.
fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'https://localhost:5173'],
  credentials: true
});

fastify.register(fastifyCookie, {
  secret: process.env.JWT_SECRET, // for cookies signature
  hook: 'onRequest',
  parseOptions: {}
});

fastify.register(jwt, {
  secret: process.env.JWT_SECRET,
  cookie: {
    cookieName: 'token',
    signed: false
  }
});

fastify.register(require('@fastify/rate-limit'), {
  global: false
});

// Middleware to verify JWT
fastify.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: true, message: 'Unauthorized' });
  }
});

// Block all non-password-change API routes for accounts that still have the
// default password set.  The mustChange flag is embedded in the JWT at login.
fastify.addHook('preHandler', async (request, reply) => {
  if (!request.user?.mustChange) return;
  if (request.url.startsWith('/api/v1/auth/')) return;
  if (request.url === '/api/v1/settings/password') return;
  reply.code(403).send({ error: true, message: 'Password change required before accessing other resources.' });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/',
  });
}

// Register routes
fastify.register(require('./routes/auth'), { prefix: '/api/v1/auth' });
fastify.register(require('./routes/devices'), { prefix: '/api/v1/devices' });
fastify.register(require('./routes/segments'), { prefix: '/api/v1/segments' });
fastify.register(require('./routes/alerts'), { prefix: '/api/v1/alerts' });
fastify.register(require('./routes/unifi'), { prefix: '/api/v1/unifi' });
fastify.register(require('./routes/settings'), { prefix: '/api/v1/settings' });
fastify.register(require('./routes/ai'), { prefix: '/api/v1/ai' });
fastify.register(require('./routes/discovery'), { prefix: '/api/v1/discovery' });


// Fallback for React Router in production
fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api')) {
    reply.code(404).send({ error: true, message: 'Not Found' });
  } else if (process.env.NODE_ENV === 'production') {
    reply.sendFile('index.html');
  } else {
    reply.code(404).send({ error: true, message: 'Not Found' });
  }
});

const start = async () => {
  try {
    const port = process.env.PORT || 3001;

    // Setup Socket.IO
    const io = new Server(fastify.server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'https://localhost:5173'],
        methods: ["GET", "POST"],
        credentials: true
      }
    });

    fastify.decorate('io', io);

    // Socket.IO authentication middleware using Fastify's JWT pipeline
    io.use(async (socket, next) => {
      try {
        const cookie = socket.handshake.headers.cookie;
        if (!cookie) {
          return next(new Error('Authentication error: No cookies found'));
        }

        // Standard parsing for 'token' cookie
        const tokenMatch = cookie.match(/token=([^;]+)/);
        const token = tokenMatch ? tokenMatch[1] : null;

        if (!token) {
          return next(new Error('Authentication error: Token not found'));
        }

        // Use fastify.jwt for unified verification logic
        const decoded = await fastify.jwt.verify(token);
        socket.user = decoded;
        next();
      } catch (err) {
        fastify.log.error(`Socket auth failed: ${err.message}`);
        next(new Error('Authentication error: Invalid or expired token'));
      }
    });

    io.on('connection', (socket) => {
      fastify.log.info(`Socket connected: ${socket.id} (User: ${socket.user?.email || 'unknown'})`);
      socket.on('disconnect', () => {
        fastify.log.info(`Socket disconnected: ${socket.id}`);
      });
    });

    // Fastify needs to bind to 0.0.0.0 for Docker
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);

    // Start background jobs after server is up
    require('./jobs/criticalPingJob').start(fastify);
    require('./jobs/unifiJob')(fastify);
    require('./jobs/scanJob').start(fastify);
    const { startAiJobs } = require('./jobs/aiJob');
    startAiJobs(fastify);

    const { startCleanupJobs } = require('./jobs/cleanupJob');
    startCleanupJobs(fastify);

    // Ensure the IEEE OUI database exists; auto-fetch if missing (gitignored file).
    // Uses spawn (non-blocking) so the event loop stays responsive during the ~10s fetch.
    (async () => {
      const fs = require('fs');
      const ouiDbPath = require('path').join(__dirname, 'data/oui-ieee.json');
      if (!fs.existsSync(ouiDbPath)) {
        fastify.log.warn('[OUI] IEEE database missing — auto-fetching (this takes ~10 s)…');
        try {
          await new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const child = spawn(
              process.execPath,
              [require('path').join(__dirname, 'scripts/update-oui-db.js')],
              { stdio: 'inherit' }
            );
            child.on('close', code => code === 0 ? resolve() : reject(new Error(`exit code ${code}`)));
            child.on('error', reject);
          });
          const { reloadIeeeMap } = require('./services/macOuiService');
          reloadIeeeMap();
          const { ouiIdentifyUnprocessed } = require('./services/discoveryService');
          ouiIdentifyUnprocessed();
          fastify.log.info('[OUI] IEEE database ready.');
        } catch (e) {
          fastify.log.error(`[OUI] Auto-fetch failed: ${e.message} — run: npm run update-oui`);
        }
      }
    })();

    // Run one-time OUI backfill for existing devices
    const { backfillVendors } = require('./services/backfillService');
    backfillVendors(fastify).catch(err => fastify.log.error(`Backfill failed: ${err.message}`));

    // Log discovery capabilities on startup
    const { checkDiscoveryCapability } = require('./services/discoveryService');
    checkDiscoveryCapability().then(cap => {
      fastify.log.info({
        msg: 'Discovery capability check',
        arp_scan: cap.can_arp_scan,
        unifi_harvest: cap.can_unifi_harvest,
        l2_segment: cap.l2_segment?.cidr || 'none',
        nmap: cap.nmap_available,
        note: cap.platform_note || 'all tools available'
      });
    }).catch(err => {
      fastify.log.warn(`Discovery capability check failed: ${err.message}`);
    });


  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
