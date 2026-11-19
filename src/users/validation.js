const invalid = message => Object.assign(new Error(message), { status: 400 });

export function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Profile details are required.');
  if (['role', 'email', 'id', '_id'].some(key => Object.hasOwn(body, key))) throw Object.assign(new Error('Email, role, and account identity cannot be changed here.'), { status: 403 });
  const result = {};
  for (const [key, min, max] of [['name', 2, 100], ['phone', 0, 24], ['area', 0, 160], ['bio', 0, 2000]]) {
    if (!Object.hasOwn(body, key)) continue;
    if (typeof body[key] !== 'string' || body[key].trim().length < min || body[key].trim().length > max) throw invalid(key + ' must contain ' + min + '–' + max + ' characters.');
    result[key] = body[key].trim();
  }
  if (result.phone) {
    const digits = result.phone.replace(/\D/g, '');
    if (!/^\+?[\d\s()-]+$/.test(result.phone) || digits.length < 7 || digits.length > 15) throw invalid('Enter a valid phone number.');
  }
  if (Object.hasOwn(body, 'image')) {
    if (typeof body.image !== 'string') throw invalid('Upload a valid profile photo.');
    if (body.image === '') result.image = '';
    else {
      let url;
      try { url = new URL(body.image); } catch { throw invalid('Upload a valid profile photo.'); }
      if (url.protocol !== 'https:' || url.hostname !== 'i.ibb.co' || url.username || url.password) throw invalid('Use a profile photo uploaded through ImgBB.');
      result.image = url.href;
    }
  }
  if (!Object.keys(result).length) throw invalid('Provide at least one profile field to update.');
  return result;
}
