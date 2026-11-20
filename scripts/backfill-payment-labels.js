import { ObjectId } from 'mongodb';
import { connectDatabase, getDatabase, closeDatabase } from '../src/db/mongodb.js';

try {
  await connectDatabase(); const db = getDatabase();
  const records = await db.collection('payments').find({ $or: [{ customerName: { $exists: false } }, { technicianName: { $exists: false } }, { paymentStatus: { $exists: false } }] }).toArray();
  let updated = 0;
  for (const record of records) {
    if (!/^[a-f\d]{24}$/i.test(record.bookingId)) continue;
    const booking = await db.collection('bookings').findOne({ _id: new ObjectId(record.bookingId), paymentStatus: 'paid' });
    if (!booking) continue;
    const fields = {};
    if (!record.customerName && booking.customerName) fields.customerName = booking.customerName;
    if (!record.technicianName && booking.technicianName) fields.technicianName = booking.technicianName;
    if (!record.paymentStatus) fields.paymentStatus = 'paid';
    if (!Object.keys(fields).length) continue;
    if (process.argv.includes('--apply')) await db.collection('payments').updateOne({ _id: record._id }, { $set: fields });
    updated++;
  }
  console.log((process.argv.includes('--apply') ? 'Updated' : 'Would update') + ' labels/status on ' + updated + ' verified payment records. Amounts and transaction references are unchanged.');
} finally { await closeDatabase(); }
