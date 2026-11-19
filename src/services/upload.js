import { Router } from 'express';
import { env } from '../config/env.js';

export function validateImage(value) {
  if (typeof value !== 'string' || !value.length || value.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Object.assign(new Error('Choose a valid PNG, JPEG, or WebP image.'), { status: 400 });
  const bytes = Buffer.from(value, 'base64');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (bytes.length > 5 * 1024 * 1024 || bytes.length < 12 || (!png && !jpeg && !webp)) throw Object.assign(new Error('Use a PNG, JPEG, or WebP image up to 5 MB.'), { status: 400 });
  return value;
}

export function uploadRoutes(authorization) {
  const router = Router();
  router.post('/', authorization.verifyToken, async (req, res, next) => {
    try {
      const image = validateImage(req.body?.image);
      if (!env.imgbbKey) return res.status(503).json({ message: 'Image upload is not configured yet.' });
      const form = new FormData(); form.set('key', env.imgbbKey); form.set('image', image);
      const response = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok || !result.success || !result.data?.url?.startsWith('https://i.ibb.co/')) return res.status(502).json({ message: 'Image upload failed. Please try again.' });
      res.status(201).json({ url: result.data.url });
    } catch (error) {
      if (!error.status) return res.status(502).json({ message: 'Image upload is unavailable. Please try again.' });
      next(error);
    }
  });
  return router;
}
