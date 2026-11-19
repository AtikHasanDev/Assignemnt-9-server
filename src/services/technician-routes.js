import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { validateService } from './validation.js';

export function technicianServiceRoutes(db, authorization) {
  const router = Router();
  router.use(authorization.verifyToken, authorization.verifyTechnician);
  const services = db.collection('services');
  function owned(req) {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw Object.assign(new Error('Service not found.'), { status: 404 });
    return { _id: new ObjectId(req.params.id), technicianEmail: req.user.email };
  }
  router.get('/my', async (req, res, next) => {
    try { res.json({ items: await services.find({ technicianEmail: req.user.email }).sort({ createdAt: -1 }).toArray() }); }
    catch (error) { next(error); }
  });
  router.post('/', async (req, res, next) => {
    try {
      const service = { ...validateService(req.body), technicianName: req.user.name, technicianEmail: req.user.email, approvalStatus: 'pending', isAvailable: true, createdAt: new Date() };
      const { insertedId } = await services.insertOne(service);
      res.status(201).json({ ...service, _id: insertedId });
    } catch (error) { next(error); }
  });
  router.patch('/:id/availability', async (req, res, next) => {
    try {
      if (typeof req.body?.isAvailable !== 'boolean') throw Object.assign(new Error('Availability must be true or false.'), { status: 400 });
      const result = await services.updateOne(owned(req), { $set: { isAvailable: req.body.isAvailable, updatedAt: new Date() } });
      if (!result.matchedCount) return res.status(404).json({ message: 'Service not found.' });
      res.json({ message: 'Availability updated.' });
    } catch (error) { next(error); }
  });
  router.patch('/:id', async (req, res, next) => {
    try {
      const filter = owned(req);
      const fields = validateService(req.body);
      const result = await services.updateOne(filter, { $set: { ...fields, technicianName: req.user.name, approvalStatus: 'pending', updatedAt: new Date() } });
      if (!result.matchedCount) return res.status(404).json({ message: 'Service not found.' });
      res.json({ message: 'Service updated and awaiting approval.' });
    } catch (error) { next(error); }
  });
  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await services.deleteOne(owned(req));
      if (!result.deletedCount) return res.status(404).json({ message: 'Service not found.' });
      res.json({ message: 'Service deleted.' });
    } catch (error) { next(error); }
  });
  return router;
}
