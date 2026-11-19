import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { validateBooking } from './validation.js';

export function bookingRoutes(db, authorization) {
  const router = Router();
  router.use(authorization.verifyToken, authorization.verifyCustomer);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/', async (req, res, next) => {
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
  router.get('/my', async (req, res, next) => {
    try {
      const items = await db.collection('bookings').find({ customerEmail: req.user.email }).sort({ createdAt: -1 }).toArray();
      res.json({ items });
    } catch (error) { next(error); }
  });
  return router;
}
