import { Router } from 'express';
import { activeBookingStatuses } from '../db/indexes.js';

const bookingLabels = { requested: 'Requested', accepted: 'Accepted', 'in-progress': 'In progress', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled' };
async function grouped(collection, filter, field, labels) {
  const rows = await collection.aggregate([{ $match: filter }, { $group: { _id: '$' + field, count: { $sum: 1 } } }]).toArray();
  return Object.entries(labels).map(([status, label]) => ({ status, label, value: rows.find(row => row._id === status)?.count || 0 }));
}

export function dashboardRoutes(db, authorization) {
  const router = Router();
  router.use(authorization.verifyToken);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/customer', authorization.verifyCustomer, async (req, res, next) => {
    try {
      const items = await grouped(db.collection('bookings'), { customerEmail: req.user.email }, 'status', bookingLabels);
      const total = items.reduce((sum, item) => sum + item.value, 0);
      const active = items.filter(item => activeBookingStatuses.includes(item.status)).reduce((sum, item) => sum + item.value, 0);
      res.json({ role: 'customer', stats: [ { label: 'Total requests', value: total }, { label: 'Active jobs', value: active }, { label: 'Completed jobs', value: items.find(item => item.status === 'completed').value } ], chart: { title: 'Your repair requests by status', items } });
    } catch (error) { next(error); }
  });
  router.get('/technician', authorization.verifyTechnician, async (req, res, next) => {
    try {
      const services = db.collection('services');
      const filter = { technicianEmail: req.user.email };
      const [total, approved, pendingRequests, items] = await Promise.all([
        services.countDocuments(filter), services.countDocuments({ ...filter, approvalStatus: 'approved' }),
        db.collection('bookings').countDocuments({ ...filter, status: 'requested' }),
        grouped(db.collection('bookings'), filter, 'status', bookingLabels),
      ]);
      res.json({ role: 'technician', stats: [ { label: 'Total services', value: total }, { label: 'Approved services', value: approved }, { label: 'Pending requests', value: pendingRequests } ], chart: { title: 'Your repair jobs by status', items } });
    } catch (error) { next(error); }
  });
  router.get('/admin', authorization.verifyAdmin, async (_req, res, next) => {
    try {
      const [users, technicians, pending, items] = await Promise.all([
        db.collection('user').countDocuments({}), db.collection('user').countDocuments({ role: 'technician' }),
        db.collection('services').countDocuments({ approvalStatus: 'pending' }),
        grouped(db.collection('services'), {}, 'approvalStatus', { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected' }),
      ]);
      res.json({ role: 'admin', stats: [ { label: 'Total users', value: users }, { label: 'Total technicians', value: technicians }, { label: 'Pending services', value: pending } ], chart: { title: 'Service moderation overview', items } });
    } catch (error) { next(error); }
  });
  return router;
}
