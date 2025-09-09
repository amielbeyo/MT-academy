process.env.NODE_ENV = 'test';
delete process.env.STRIPE_SECRET;
delete process.env.STRIPE_PRICE_ID;
const fs = require('fs');
const path = require('path');
const keyPath = path.join(__dirname, 'apikeys.js');
fs.writeFileSync(keyPath, "module.exports = 'test';");
const usersPath = path.join(__dirname, 'users.json');
if (fs.existsSync(usersPath)) fs.unlinkSync(usersPath);
const request = require('supertest');
const app = require('./server');

(async () => {
  const email = `user${Date.now()}@example.com`;
  const password = 'pass123';
  const signup = await request(app).post('/signup').send({ email, password });
  const userId = signup.body.id;
  const login = await request(app).post('/login').send({ email, password });
  if (login.body.plan !== 'free') {
    throw new Error('login should report free plan');
  }
  console.log('login plan test passed');

  const planCheck = await request(app).get(`/plan/${userId}`);
  if (planCheck.body.plan !== 'free') {
    throw new Error('plan endpoint should return free');
  }
  console.log('plan endpoint test passed');

  const subRes = await request(app).post('/subscribe').send({ userId });
  if (!subRes.body.url) {
    throw new Error('subscribe should return a url');
  }
  console.log('subscribe fallback test passed');

  const confirmRes = await request(app).post('/confirm').send({ sessionId: 'x' });
  if (confirmRes.status !== 400) {
    throw new Error('confirm should require stripe');
  }
  console.log('confirm endpoint test passed');

  for (let i = 0; i < 5; i++) {
    const res = await request(app).post('/prompt').send({ userId, prompt: 'hi' });
    if (res.status !== 200) {
      throw new Error('prompt should be allowed');
    }
  }
  const limitRes = await request(app).post('/prompt').send({ userId, prompt: 'hi again' });
  if (limitRes.status !== 403) {
    throw new Error('usage limit should be enforced');
  }
  console.log('usage limit test passed');
  fs.unlinkSync(keyPath);
  if (fs.existsSync(usersPath)) fs.unlinkSync(usersPath);
})();
