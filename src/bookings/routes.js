import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { validateBooking } from './validation.js';
import { technicianTransition } from './workflow.js';

export function bookingRoutes(db, authorization) {
  const router = Router();
  router.use(authorization.verifyToken);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/', authorization.verifyCustomer, async (req, res, next) => {
    try {
      const fields = validateBooking(req.body);
      const service = await db.collection('services').findOne({ _id: new ObjectId(fields.serviceId), approvalStatus: 'approved', isAvailable: true });
      if (!service) return res.status(404).json({ message: 'This service is no longer available.' });
      if (service.technicianEmail === req.user.email) return res.status(403).json({ message: 'You cannot request your own service.' });
      const now = new Date();
      const booking = {
        ...fields, serviceId: String(service._id), serviceTitle: service.title, serviceImage: service.image, category: service.category,
        basePrice: service.basePrice, technicianName: service.technicianName, technicianEmail: service.technicianEmail,
        customerName: req.user.name, customerEmail: req.user.email,
        status: 'requested', paymentStatus: 'unpaid', finalAmount: service.basePrice,
        createdAt: now, updatedAt: now, statusHistory: [{ status: 'requested', changedAt: now }],
      };
      // MongoDB's partial unique index enforces this atomically, including
      // concurrent requests and clients using different case for the service id.
      const result = await db.collection('bookings').insertOne(booking);
      res.status(201).json({ ...booking, _id: result.insertedId });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'You already have an active request for this service.' });
      next(error);
    }
  });
  router.get('/my', authorization.verifyCustomer, async (req, res, next) => {
    try {
      const items = await db.collection('bookings').find({ customerEmail: req.user.email }).sort({ createdAt: -1 }).toArray();
      res.json({ items });
    } catch (error) { next(error); }
  });
  router.get('/technician', authorization.verifyTechnician, async (req, res, next) => {
    try {
      const status = req.query.status;
      if (status !== undefined && !['all', 'requested', 'accepted', 'in-progress', 'completed', 'rejected', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Choose a valid status filter.' });
      const filter = { technicianEmail: req.user.email };
      if (status && status !== 'all') filter.status = status;
      const items = await db.collection('bookings').find(filter).sort({ createdAt: -1 }).toArray();
      res.json({ items });
    } catch (error) { next(error); }
  });
  function objectId(value) {
    if (!/^[a-f\d]{24}$/i.test(value)) throw Object.assign(new Error('Booking not found.'), { status: 404 });
    return new ObjectId(value);
  }
  router.patch('/:id/cancel', authorization.verifyCustomer, async (req, res, next) => {
    try {
      const bookings = db.collection('bookings');
      const owner = { _id: objectId(req.params.id), customerEmail: req.user.email };
      const booking = await bookings.findOne(owner);
      if (!booking) return res.status(404).json({ message: 'Booking not found.' });
      if (booking.status !== 'requested') return res.status(409).json({ message: 'Only a requested job can be cancelled.' });
      const now = new Date();
      const result = await bookings.updateOne({ ...owner, status: 'requested' }, { $set: { status: 'cancelled', updatedAt: now }, $push: { statusHistory: { status: 'cancelled', changedAt: now } } });
      if (!result.matchedCount) return res.status(409).json({ message: 'This job changed while you were cancelling. Refresh and try again.' });
      res.json({ message: 'Your repair request has been cancelled.' });
    } catch (error) { next(error); }
  });
  router.patch('/:id/status', authorization.verifyTechnician, async (req, res, next) => {
    try {
      const bookings = db.collection('bookings');
      const owner = { _id: objectId(req.params.id), technicianEmail: req.user.email };
      const booking = await bookings.findOne(owner);
      if (!booking) return res.status(404).json({ message: 'Booking not found.' });
      const fields = technicianTransition(booking.status, req.body?.status, req.body?.finalAmount);
      const now = new Date();
      const result = await bookings.updateOne({ ...owner, status: booking.status }, { $set: { ...fields, updatedAt: now }, $push: { statusHistory: { status: fields.status, changedAt: now } } });
      if (!result.matchedCount) return res.status(409).json({ message: 'This job changed while you were updating it. Refresh and try again.' });
      res.json({ message: 'Job status updated.', ...fields });
    } catch (error) { next(error); }
  });
  return router;
}
