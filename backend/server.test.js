process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const keyPath = path.join(__dirname, 'apikeys.js');
fs.writeFileSync(keyPath, "module.exports = 'test';");
const request = require('supertest');
const app = require('./server');

(async () => {
  const email = `user${Date.now()}@example.com`;
  const password = 'pass123';
  const signup = await request(app).post('/signup').send({ email, password });
  const userId = signup.body.id;

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
})();
