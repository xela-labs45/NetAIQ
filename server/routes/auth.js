const bcrypt = require('bcrypt');
const db = require('../db/database');

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function isAccountLocked(username) {
    const user = db.prepare('SELECT locked_until FROM users WHERE username = ?').get(username);
    if (!user?.locked_until) return false;
    if (Date.now() < new Date(user.locked_until).getTime()) return true;
    // Lock expired — clear it
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = ?').run(username);
    return false;
}

function recordFailedAttempt(username) {
    const user = db.prepare('SELECT failed_attempts FROM users WHERE username = ?').get(username);
    if (!user) return;
    const attempts = (user.failed_attempts || 0) + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MS).toISOString()
        : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE username = ?')
        .run(attempts, lockedUntil, username);
}

function clearAttempts(username) {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = ?').run(username);
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
            const { username, password } = request.body;

            // Accept username or email — allows existing users whose username was
            // auto-derived from email to still sign in with either credential.
            const user = db.prepare(
                'SELECT * FROM users WHERE username = ? OR email = ?'
            ).get(username, username);

            if (!user) {
                return reply.code(401).send({ error: true, message: 'Invalid credentials' });
            }

            // Lockout is keyed on the canonical username, not the raw login input.
            if (isAccountLocked(user.username)) {
                return reply.code(429).send({ error: true, message: 'Account temporarily locked. Try again in 15 minutes.' });
            }

            const match = await bcrypt.compare(password, user.password_hash);

            if (!match) {
                recordFailedAttempt(user.username);
                return reply.code(401).send({ error: true, message: 'Invalid credentials' });
            }

            clearAttempts(user.username);

            const token = fastify.jwt.sign(
                { id: user.id, username: user.username, mustChange: user.must_change_password === 1 },
                { expiresIn: '8h' }
            );

            reply
                .setCookie('token', token, {
                    path: '/',
                    httpOnly: true,
                    secure: process.env.COOKIE_SECURE === 'true',
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
        const user = db.prepare('SELECT id, username, email, must_change_password FROM users WHERE id = ?').get(request.user.id);
        if (!user) {
            return reply.code(401).send({ error: true, message: 'User not found' });
        }

        const KNOWN_WEAK_SECRETS = [
            'replace_with_a_random_64_character_string',
            'supersecretkeyreplace_with_a_random_64_character_string',
        ];
        const jwtSecret = process.env.JWT_SECRET || '';
        const warnings = [];
        if (KNOWN_WEAK_SECRETS.includes(jwtSecret) || jwtSecret.length < 32) {
            warnings.push({
                code: 'WEAK_JWT_SECRET',
                message: 'JWT_SECRET is set to the default placeholder value. Anyone can forge login tokens.',
                fix: 'Run: openssl rand -hex 64  — paste the output as JWT_SECRET in your .env file, then restart the server.',
            });
        }

        reply.send({ user, warnings });
    });
};
