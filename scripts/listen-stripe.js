import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key?.startsWith('sk_test_')) throw new Error('Save STRIPE_SECRET_KEY as a test key in the server .env first.');
const executable = process.env.STRIPE_CLI_PATH || resolve('node_modules/.cache/stripe-cli/node_modules/@stripe/cli-win32-x64/bin/stripe.exe');
if (!existsSync(executable)) throw new Error('Install the official CLI locally: npm install --prefix node_modules/.cache/stripe-cli --no-package-lock --no-save @stripe/cli');
const listener = spawn(executable, ['listen', '--events', 'checkout.session.completed,checkout.session.async_payment_succeeded', '--forward-to', 'http://localhost:5000/api/payments/webhook'], {
  env: { ...process.env, STRIPE_API_KEY: key }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
function readLines(stream) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    pending += chunk;
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) {
      const secret = line.match(/whsec_[A-Za-z0-9]+/)?.[0];
      if (secret) {
        const path = resolve('.env');
        let content = readFileSync(path, 'utf8');
        const setting = 'STRIPE_WEBHOOK_SECRET=' + secret;
        content = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(content) ? content.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, setting) : content.trimEnd() + '\n' + setting + '\n';
        writeFileSync(path, content);
        console.log('Stripe test listener ready. Webhook secret saved to ignored .env; restart API to load it.');
      } else {
        console.log(line.replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/g, '[REDACTED]'));
      }
    }
  });
}
readLines(listener.stdout); readLines(listener.stderr);
listener.on('error', () => { console.error('Unable to start Stripe CLI.'); process.exitCode = 1; });
listener.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => listener.kill());
