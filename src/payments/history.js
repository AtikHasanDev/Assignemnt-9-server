const invalid = () => Object.assign(new Error('Invalid payment history pagination.'), { status: 400 });

export async function paymentHistory(db, query, customerEmail) {
  if (Object.keys(query).some(key => !['page', 'limit'].includes(key))) throw invalid();
  function positive(key, fallback, maximum) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !/^\d+$/.test(query[key])) throw invalid();
    const value = Number(query[key]);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw invalid();
    return value;
  }
  const page = positive('page', 1, 100000), limit = positive('limit', 12, 100);
  const filter = customerEmail === undefined ? {} : { customerEmail };
  const payments = db.collection('payments');
  const [items, total, revenue] = await Promise.all([
    payments.find(filter, { projection: { bookingId: 1, serviceTitle: 1, transactionId: 1, amount: 1, currency: 1, paidAt: 1, customerEmail: 1, technicianEmail: 1, customerName: 1, technicianName: 1, paymentStatus: 1 } })
      .sort({ paidAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    payments.countDocuments(filter),
    payments.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$amount' } } }]).toArray(),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit), totalRevenue: Math.round((revenue[0]?.amount || 0) * 100) / 100 };
}
