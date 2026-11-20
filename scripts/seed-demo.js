import 'dotenv/config';
import { parse } from 'dotenv';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ObjectId } from 'mongodb';
import { connectDatabase, getDatabase, closeDatabase } from '../src/db/mongodb.js';
import { createAuth } from '../src/auth/auth.js';
import { env } from '../src/config/env.js';
import { categories } from '../src/services/query.js';
import { validateService } from '../src/services/validation.js';
import { uploadToImgBB, validateImage } from '../src/services/upload.js';
import { deviceIllustration } from './seed-illustrations.js';

const tag = 'fixmate-demo-v1';
const accounts = [
  { name: 'Demo Administrator', email: 'admin.demo@fixmate.example', role: 'admin' },
  { name: 'Demo Customer', email: 'customer.demo@fixmate.example', role: 'customer' },
  { name: 'Demo Nadia Rahman', email: 'nadia.demo@fixmate.example', role: 'technician' },
  { name: 'Demo Rafi Ahmed', email: 'rafi.demo@fixmate.example', role: 'technician' },
];
const offerings = [
  ['Smartphone screen repair', 'Smartphone', 35], ['Laptop keyboard replacement', 'Laptop & PC', 45],
  ['AC cleaning and inspection', 'AC', 30], ['Refrigerator cooling diagnosis', 'Refrigerator', 40],
  ['TV display diagnosis', 'TV', 25], ['Washing machine drum inspection', 'Washing Machine', 38],
  ['Home electrical safety check', 'Electrical', 20], ['Smartphone battery replacement', 'Smartphone', 28],
  ['Laptop performance tune-up', 'Laptop & PC', 32], ['AC cooling diagnosis', 'AC', 42],
  ['Refrigerator door seal replacement', 'Refrigerator', 26], ['Washing machine drain repair', 'Washing Machine', 34],
];
const stableId = key => new ObjectId(createHash('sha256').update(tag + ':' + key).digest('hex').slice(0, 24));
if (!process.argv.includes('--apply')) {
  console.log('Preview: add 4 demo accounts, 12 approved services with uploaded device illustrations, and 6 connected unpaid bookings. Existing seeded edits are preserved. Run npm run seed:demo -- --apply to write.');
} else {
  if (env.isProduction && !process.argv.includes('--allow-production')) throw new Error('Production seeding requires the explicit --allow-production flag.');
  let db;
  try {
    await connectDatabase(); db = getDatabase();
    // Preflight every reserved identity before creating or promoting accounts.
    for (const account of accounts) {
      const existing = await db.collection('user').findOne({ email: account.email });
      if (existing && existing.demoSeed !== tag) throw new Error('A reserved demo email belongs to a non-seed user; no account will be overwritten.');
    }
    for (const [kind, count] of [['service', 12], ['booking', 6]]) for (let index = 0; index < count; index++) {
      const existing = await db.collection(kind === 'service' ? 'services' : 'bookings').findOne({ _id: stableId(kind + index) });
      if (existing && existing.demoSeed !== tag) throw new Error('A reserved seed id is occupied; no record will be overwritten.');
    }
    const credentials = existsSync('.env.demo') ? parse(readFileSync('.env.demo')) : {};
    if (!credentials.SEED_PASSWORD && await db.collection('user').findOne({ demoSeed: tag })) throw new Error('Existing seed accounts need their original .env.demo credential file. Passwords will not be reset.');
    const password = credentials.SEED_PASSWORD || 'DemoA' + randomBytes(14).toString('hex');
    if (!credentials.SEED_PASSWORD) writeFileSync('.env.demo', '# Local demo login details. Ignored by Git.\nSEED_PASSWORD=' + password + '\n' + accounts.map((account, index) => 'DEMO_EMAIL_' + index + '=' + account.email).join('\n') + '\n');
    const auth = createAuth();
    for (const account of accounts) {
      if (await db.collection('user').findOne({ email: account.email, demoSeed: tag })) continue;
      const result = await auth.api.signUpEmail({ body: { ...account, role: account.role === 'admin' ? 'customer' : account.role, password }, headers: new Headers({ origin: env.clientOrigins[0] }) });
      await db.collection('user').updateOne({ _id: new ObjectId(result.user.id), email: account.email }, { $set: { demoSeed: tag, role: account.role, area: 'Dhaka', bio: 'Demo account for assignment workflow testing.' } });
      // Seeding should not leave unused signed-in sessions behind.
      if (result.token) await db.collection('session').deleteOne({ token: result.token });
    }
    mkdirSync('node_modules/.cache', { recursive: true });
    const cachePath = 'node_modules/.cache/fixmate-seed-images.json';
    const images = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
    for (const category of categories) {
      if (images[category]) continue;
      images[category] = await uploadToImgBB(validateImage(deviceIllustration(category).toString('base64')));
      writeFileSync(cachePath, JSON.stringify(images, null, 2));
      console.log('Uploaded demo illustration: ' + category);
    }
    const now = new Date();
    const services = [];
    for (let index = 0; index < offerings.length; index++) {
      const [title, category, basePrice] = offerings[index];
      const technician = accounts[2 + index % 2];
      const fields = validateService({ title: 'Demo · ' + title, category, basePrice, image: images[category], description: 'Demo repair service for assignment testing. ' + title + ' includes a careful inspection, a clear explanation of findings, and a final quote before payment after completion.', estimatedDuration: index % 2 ? '2–3 hours' : '1–2 hours', serviceMode: index % 3 ? 'Home Visit' : 'Shop Drop-off', serviceArea: index % 2 ? 'Dhanmondi, Dhaka' : 'Mirpur, Dhaka' });
      const service = { _id: stableId('service' + index), ...fields, technicianName: technician.name, technicianEmail: technician.email, approvalStatus: 'approved', isAvailable: true, demoSeed: tag, createdAt: new Date(now.getTime() - index * 60000) };
      await db.collection('services').updateOne({ _id: service._id }, { $setOnInsert: service }, { upsert: true }); services.push(await db.collection('services').findOne({ _id: service._id }));
    }
    const statuses = ['requested', 'accepted', 'in-progress', 'completed', 'rejected', 'cancelled'];
    for (let index = 0; index < statuses.length; index++) {
      const service = services[index], status = statuses[index];
      const trail = status === 'cancelled' || status === 'rejected' ? ['requested', status] : ['requested', 'accepted', 'in-progress', 'completed'].slice(0, ['requested', 'accepted', 'in-progress', 'completed'].indexOf(status) + 1);
      const history = trail.map((step, stepIndex) => ({ status: step, changedAt: new Date(now.getTime() - (trail.length - stepIndex) * 3600000) }));
      const booking = { _id: stableId('booking' + index), demoSeed: tag, serviceId: String(service._id), serviceTitle: service.title, serviceImage: service.image, category: service.category, basePrice: service.basePrice, technicianName: service.technicianName, technicianEmail: service.technicianEmail, customerName: accounts[1].name, customerEmail: accounts[1].email, customerPhone: '+8801000000000', address: 'Demo address for testing, Mirpur, Dhaka', problemDescription: 'Demo request: please inspect this device and explain the repair options before beginning work.', preferredDate: new Date(new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z'), status, paymentStatus: 'unpaid', finalAmount: service.basePrice, statusHistory: history, createdAt: history[0].changedAt, updatedAt: history.at(-1).changedAt };
      const existing = await db.collection('bookings').findOne({ _id: booking._id });
      if (existing) continue;
      if (['requested', 'accepted', 'in-progress'].includes(status) && await db.collection('bookings').findOne({ customerEmail: booking.customerEmail, serviceId: booking.serviceId, status: { $in: ['requested', 'accepted', 'in-progress'] } })) throw new Error('An existing active demo request prevents insertion; it will not be overwritten.');
      await db.collection('bookings').insertOne(booking);
    }
    console.log('Demo seed complete: 4 accounts, 12 connected services, 6 unpaid bookings. Existing edits preserved. Login password is in the ignored server .env.demo file.');
  } catch (error) {
    console.error('Demo seed failed: ' + (error.status ? 'provider/configuration issue (' + error.status + ')' : error.message)); process.exitCode = 1;
  } finally { await closeDatabase(); }
}
