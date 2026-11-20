import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { paymentHistory } from '../payments/history.js';
const badRequest = message => Object.assign(new Error(message), { status: 400 });
function id(value) { if (!/^[a-f\d]{24}$/i.test(value)) throw badRequest('Invalid record id.'); return new ObjectId(value); }
function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100 || (query.page && typeof query.page !== 'string') || (query.limit && typeof query.limit !== 'string')) throw badRequest('Invalid pagination.');
  return { page, limit, skip: (page - 1) * limit };
}
export function adminRoutes(db, authorization) {
  const router = Router();
  router.use(authorization.verifyToken, authorization.verifyAdmin);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get(['/transactions', '/payments'], async (req, res, next) => {
    try { res.json(await paymentHistory(db, req.query)); }
    catch (error) { next(error); }
  });
  router.get('/bookings', async (req, res, next) => {
    try {
      if (Object.keys(req.query).some(key => !['status', 'paymentStatus', 'page', 'limit'].includes(key))) throw badRequest('Invalid booking filter parameter.');
      const status = req.query.status ?? 'all';
      const paymentStatus = req.query.paymentStatus ?? 'all';
      if (!['all', 'requested', 'accepted', 'in-progress', 'completed', 'rejected', 'cancelled'].includes(status)) throw badRequest('Invalid booking status filter.');
      if (!['all', 'unpaid', 'paid'].includes(paymentStatus)) throw badRequest('Invalid payment status filter.');
      const filter = {};
      if (status !== 'all') filter.status = status;
      if (paymentStatus !== 'all') filter.paymentStatus = paymentStatus;
      const { page, limit, skip } = pagination(req.query);
      const bookings = db.collection('bookings');
      const [items, total] = await Promise.all([
        bookings.find(filter, { projection: {
          serviceTitle: 1, category: 1, customerName: 1, customerEmail: 1, customerPhone: 1,
          technicianName: 1, technicianEmail: 1, address: 1, preferredDate: 1, problemDescription: 1, problemImage: 1,
          basePrice: 1, finalAmount: 1, status: 1, paymentStatus: 1, statusHistory: 1, createdAt: 1, updatedAt: 1,
        } }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).toArray(),
        bookings.countDocuments(filter),
      ]);
      res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (error) { next(error); }
  });
  router.get('/users', async (req, res, next) => {
    try {
      const { page, limit, skip } = pagination(req.query);
      const users = db.collection('user');
      const [items, total] = await Promise.all([
        users.find({}, { projection: { name: 1, email: 1, role: 1, image: 1, createdAt: 1 } }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).toArray(), users.countDocuments({}),
      ]);
      res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (error) { next(error); }
  });
  router.patch('/users/:id/role', async (req, res, next) => {
    try {
      const userId = id(req.params.id);
      if (String(userId) === String(req.user._id || req.user.id)) return res.status(403).json({ message: 'You cannot change your own role.' });
      if (!['customer', 'technician', 'admin'].includes(req.body?.role)) throw badRequest('Choose customer, technician, or admin.');
      const result = await db.collection('user').updateOne({ _id: userId }, { $set: { role: req.body.role, updatedAt: new Date() } });
      if (!result.matchedCount) return res.status(404).json({ message: 'User not found.' });
      res.json({ message: 'User role updated.' });
    } catch (error) { next(error); }
  });
  router.get('/services', async (req, res, next) => {
    try {
      const status = req.query.approvalStatus ?? 'pending';
      if (!['all', 'pending', 'approved', 'rejected'].includes(status)) throw badRequest('Invalid approval filter.');
      const filter = status === 'all' ? {} : { approvalStatus: status };
      const { page, limit, skip } = pagination(req.query);
      const services = db.collection('services');
      const [items, total] = await Promise.all([
        services.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).toArray(), services.countDocuments(filter),
      ]);
      res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (error) { next(error); }
  });
  router.patch('/services/:id/approval', async (req, res, next) => {
    try {
      const serviceId = id(req.params.id);
      if (!['approved', 'rejected'].includes(req.body?.approvalStatus)) throw badRequest('Choose approved or rejected.');
      const result = await db.collection('services').updateOne({ _id: serviceId }, { $set: { approvalStatus: req.body.approvalStatus, moderatedBy: req.user.email, moderatedAt: new Date() } });
      if (!result.matchedCount) return res.status(404).json({ message: 'Service not found.' });
      res.json({ message: 'Service ' + req.body.approvalStatus + '.' });
    } catch (error) { next(error); }
  });
  return router;
}
