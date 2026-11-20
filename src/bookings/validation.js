const invalid = message => Object.assign(new Error(message), { status: 400 });

export function dhakaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(value => value.type === type).value;
  return part('year') + '-' + part('month') + '-' + part('day');
}

export function validateBooking(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Repair request details are required.');
  if (typeof body.serviceId !== 'string' || !/^[a-f\d]{24}$/i.test(body.serviceId)) throw invalid('Choose a valid service.');
  const fields = {};
  if (body.problemImage !== undefined && body.problemImage !== '') {
    if (typeof body.problemImage !== 'string' || body.problemImage.length > 2048) throw invalid('Upload a valid damage photo or submit without one.');
    let image;
    try { image = new URL(body.problemImage); } catch { throw invalid('Upload a valid damage photo or submit without one.'); }
    if (image.protocol !== 'https:' || image.hostname !== 'i.ibb.co' || image.username || image.password || image.port) throw invalid('Use a damage photo uploaded through ImgBB.');
    fields.problemImage = image.href;
  }
  for (const [key, min, max] of [['customerPhone', 7, 24], ['address', 10, 500], ['problemDescription', 20, 3000]]) {
    if (typeof body[key] !== 'string' || body[key].trim().length < min || body[key].trim().length > max) throw invalid(key + ' must contain ' + min + '–' + max + ' characters.');
    fields[key] = body[key].trim();
  }
  const digits = fields.customerPhone.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]+$/.test(fields.customerPhone) || digits.length < 7 || digits.length > 15) throw invalid('Enter a valid phone number.');
  const date = body.preferredDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid('Choose a valid preferred date.');
  const parsed = new Date(date + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < dhakaDate(now)) throw invalid('Preferred date must be today or later in Bangladesh.');
  return { ...fields, serviceId: body.serviceId.toLowerCase(), preferredDate: parsed };
}
