const fastify = require('fastify')({ logger: true });
const path = require('path');
const cors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static');
const jwt = require('@fastify/jwt');
const fastifyCookie = require('@fastify/cookie');
const { Server } = require('socket.io');

require('dotenv').config();

// Register plugins
fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
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

// Middleware to verify JWT
fastify.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
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
        origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
        methods: ["GET", "POST"],
        credentials: true
      }
    });

    fastify.decorate('io', io);

    io.on('connection', (socket) => {
      fastify.log.info(`Socket connected: ${socket.id}`);
      socket.on('disconnect', () => {
        fastify.log.info(`Socket disconnected: ${socket.id}`);
      });
    });

    // Fastify needs to bind to 0.0.0.0 for Docker
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);

    // Start background jobs after server is up
    require('./jobs/pingJob')(fastify);
    require('./jobs/unifiJob')(fastify);
    require('./jobs/scanJob')(fastify);

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
