const bcrypt = require('bcrypt');
const db = require('../db/database');

// In-memory per-account lockout: Map<email, { count, lockedUntil }>
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function isAccountLocked(email) {
    const entry = loginAttempts.get(email);
    if (!entry) return false;
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
    if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
        loginAttempts.delete(email);
    }
    return false;
}

function recordFailedAttempt(email) {
    const entry = loginAttempts.get(email) || { count: 0, lockedUntil: null };
    entry.count += 1;
    if (entry.count >= MAX_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_MS;
    }
    loginAttempts.set(email, entry);
}

function clearAttempts(email) {
    loginAttempts.delete(email);
}

module.exports = async function (fastify, opts) {
    fastify.post('/login', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '15m',
                errorResponse: (request, reply) => {
                    reply.status(429).send({
                        error: true,
                        message: 'Too many login attempts, try again in 15 minutes'
                    });
                }
            }
        }
    }, async (request, reply) => {
        try {
            const { email, password } = request.body;

            if (isAccountLocked(email)) {
                return reply.code(429).send({ error: true, message: 'Account temporarily locked. Try again in 15 minutes.' });
            }

            const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

            if (!user) {
                recordFailedAttempt(email);
                return reply.code(401).send({ error: true, message: 'Invalid credentials' });
            }

            const match = await bcrypt.compare(password, user.password_hash);

            if (!match) {
                recordFailedAttempt(email);
                return reply.code(401).send({ error: true, message: 'Invalid credentials' });
            }

            clearAttempts(email);

            const token = fastify.jwt.sign(
                { id: user.id, email: user.email, mustChange: user.must_change_password === 1 },
                { expiresIn: '8h' }
            );

            reply
                .setCookie('token', token, {
                    path: '/',
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: 8 * 60 * 60 // 8 hours
                })
                .send({ success: true, must_change_password: user.must_change_password === 1 });

        } catch (err) {
            fastify.log.error(err);
            reply.code(500).send({ error: true, message: 'Internal Server Error' });
        }
    });

    fastify.post('/logout', async (request, reply) => {
        reply
            .clearCookie('token', { path: '/' })
            .send({ success: true });
    });

    fastify.get('/me', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const user = db.prepare('SELECT id, email, must_change_password FROM users WHERE id = ?').get(request.user.id);
        if (!user) {
            return reply.code(401).send({ error: true, message: 'User not found' });
        }
        reply.send({ user });
    });
};
