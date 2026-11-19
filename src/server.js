import { createApp } from './app.js';
import { env } from './config/env.js';

const server = createApp().listen(env.port, () => {
  console.log('FixMate API listening at http://localhost:' + env.port);
});

server.on('error', error => {
  console.error('Unable to start FixMate API:', error.message);
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(signal + ': closing HTTP server.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

