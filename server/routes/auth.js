const bcrypt = require('bcrypt');
const db = require('../db/database');

module.exports = async function (fastify, opts) {
    fastify.post('/login', async (request, reply) => {
        try {
            const { email, password } = request.body;

            const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

            if (!user) {
                return reply.code(401).send({ error: true, message: 'Invalid credentials' });
            }

            const match = await bcrypt.compare(password, user.password_hash);

            if (!match) {
                return reply.code(401).send({ error: true, message: 'Invalid credentials' });
            }

            const token = fastify.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '8h' });

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
