import { env } from './env.js';
import { buildApp } from './app.js';

const app = buildApp();

app.listen({ port: env.PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`API listening on http://localhost:${env.PORT}`);
});

export { app };
