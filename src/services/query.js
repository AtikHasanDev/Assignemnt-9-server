export const categories = ['Smartphone', 'Laptop & PC', 'AC', 'Refrigerator', 'TV', 'Washing Machine', 'Electrical'];
export const serviceModes = ['Home Visit', 'Shop Drop-off'];
const badRequest = message => Object.assign(new Error(message), { status: 400 });
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function serviceQuery(query) {
  const text = key => {
    if (query[key] === undefined) return '';
    if (typeof query[key] !== 'string') throw badRequest('Invalid ' + key + ' parameter.');
    return query[key].trim();
  };
  const search = text('search');
  const category = text('category');
  const mode = text('serviceMode');
  const sort = text('sort') || 'newest';
  if (search.length > 100) throw badRequest('Search must be at most 100 characters.');
  if (category && !categories.includes(category)) throw badRequest('Unknown service category.');
  if (mode && !serviceModes.includes(mode)) throw badRequest('Unknown service mode.');
  const sorts = { newest: { createdAt: -1, _id: -1 }, 'price-asc': { basePrice: 1, _id: 1 }, 'price-desc': { basePrice: -1, _id: 1 } };
  if (!Object.hasOwn(sorts, sort)) throw badRequest('Unknown sort option.');
  function positive(key, fallback, max) {
    const value = text(key);
    if (!value) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw badRequest('Invalid ' + key + '.');
    return Number(value);
  }
  const page = positive('page', 1, 100000);
  const limit = positive('limit', 12, 48);
  const filter = { approvalStatus: 'approved', isAvailable: true };
  if (category) filter.category = category;
  if (mode) filter.serviceMode = mode;
  if (search) filter.$or = ['title', 'category'].map(field => ({ [field]: { $regex: escapeRegex(search), $options: 'i' } }));
  return { filter, sort: sorts[sort], page, limit, skip: (page - 1) * limit };
}
