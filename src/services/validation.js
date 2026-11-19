import { categories, serviceModes } from './query.js';
const invalid = message => Object.assign(new Error(message), { status: 400 });

export function validateService(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Service details are required.');
  const result = {};
  for (const [field, min, max] of [['title', 5, 120], ['description', 20, 5000], ['estimatedDuration', 2, 80], ['serviceArea', 2, 160]]) {
    if (typeof body[field] !== 'string' || body[field].trim().length < min || body[field].trim().length > max) throw invalid(field + ' must contain ' + min + '–' + max + ' characters.');
    result[field] = body[field].trim();
  }
  if (!categories.includes(body.category)) throw invalid('Choose a valid category.');
  if (!serviceModes.includes(body.serviceMode)) throw invalid('Choose a valid service mode.');
  if (typeof body.basePrice !== 'number' || !Number.isFinite(body.basePrice) || body.basePrice <= 0 || body.basePrice > 100000 || Math.abs(body.basePrice * 100 - Math.round(body.basePrice * 100)) > 0.00001) throw invalid('Starting price must be positive USD with at most two decimal places.');
  let image;
  try { image = new URL(body.image); } catch { throw invalid('Upload a service image first.'); }
  if (image.protocol !== 'https:' || image.hostname !== 'i.ibb.co' || image.username || image.password) throw invalid('Use an image uploaded to ImgBB.');
  return { ...result, category: body.category, serviceMode: body.serviceMode, basePrice: body.basePrice, image: image.href };
}
