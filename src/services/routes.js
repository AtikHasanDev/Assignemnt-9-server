import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { serviceQuery } from './query.js';

export function serviceRoutes(db) {
  const router = Router();
  router.get('/', async (req, res, next) => {
    try {
      const { filter, sort, page, limit, skip } = serviceQuery(req.query);
      const services = db.collection('services');
      const [items, total] = await Promise.all([
        services.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
        services.countDocuments(filter),
      ]);
      res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (error) { next(error); }
  });
  router.get('/:id', async (req, res, next) => {
    try {
      if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ message: 'Service not found.' });
      const service = await db.collection('services').findOne({ _id: new ObjectId(req.params.id), approvalStatus: 'approved', isAvailable: true });
      if (!service) return res.status(404).json({ message: 'Service not found.' });
      const technician = await db.collection('user').findOne({ email: service.technicianEmail }, { projection: { name: 1, image: 1, area: 1, bio: 1, _id: 0 } });
      res.json({ ...service, technician });
    } catch (error) { next(error); }
  });
  return router;
}
