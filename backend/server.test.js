process.env.OPENAI_API_KEY = 'test';
process.env.NODE_ENV = 'test';
const request = require('supertest');
const app = require('./server');

(async () => {
  const unauth = await request(app).post('/prompt').send({ prompt: 'hi' });
  if (unauth.status !== 401) {
    throw new Error('prompt without account should be rejected');
  }
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
  console.log('free plan limit test passed');

  // Premium plan bypasses limits
  const email2 = `premium${Date.now()}@example.com`;
  const signup2 = await request(app).post('/signup').send({ email: email2, password });
  const userId2 = signup2.body.id;
  await request(app).post('/subscribe').send({ userId: userId2 });
  for (let i = 0; i < 10; i++) {
    const res = await request(app).post('/prompt').send({ userId: userId2, prompt: 'hi' });
    if (res.status !== 200) {
      throw new Error('premium prompt should be allowed');
    }
  }
  console.log('premium plan unlimited test passed');
})();
