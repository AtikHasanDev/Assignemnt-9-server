import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { validateProfile } from './validation.js';

export function userRoutes(db, authorization) {
  const router = Router();
  router.patch('/profile', authorization.verifyToken, async (req, res, next) => {
    try {
      const fields = validateProfile(req.body);
      const userId = new ObjectId(String(req.user._id || req.user.id));
      const result = await db.collection('user').updateOne({ _id: userId }, { $set: { ...fields, updatedAt: new Date() } });
      if (!result.matchedCount) return res.status(404).json({ message: 'Account not found.' });
      res.set('Cache-Control', 'no-store').json({ message: 'Profile updated.', user: { name: req.user.name, email: req.user.email, role: req.user.role, image: req.user.image, phone: req.user.phone, area: req.user.area, bio: req.user.bio, ...fields } });
    } catch (error) { next(error); }
  });
  return router;
}
