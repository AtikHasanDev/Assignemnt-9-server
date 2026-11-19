import { SignJWT, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';

export function createAuthorization({ secret, findUser }) {
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  const key = new TextEncoder().encode(secret);
  const issuer = 'fixmate-api';
  const audience = 'fixmate-client';
  async function issueToken(user) {
    return new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(String(user.id || user._id))
      .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('15m').sign(key);
  }
  async function verifyToken(req, res, next) {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ message: 'A valid access token is required.' });
    let payload;
    try { ({ payload } = await jwtVerify(match[1], key, { algorithms: ['HS256'], issuer, audience })); }
    catch { return res.status(401).json({ message: 'Access token is invalid or expired.' }); }
    if (!payload.sub || !ObjectId.isValid(payload.sub)) return res.status(401).json({ message: 'Invalid token identity.' });
    try {
      // Always read the current role from MongoDB, so a role change takes effect immediately.
      const user = await findUser(payload.sub);
      if (!user || user.email !== payload.email) return res.status(401).json({ message: 'Account is no longer available.' });
      req.user = user;
      next();
    } catch (error) { next(error); }
  }
  const requireRole = role => (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Authentication is required.' });
    if (req.user.role !== role) return res.status(403).json({ message: 'This action is not available for your role.' });
    next();
  };
  return { issueToken, verifyToken, verifyCustomer: requireRole('customer'), verifyTechnician: requireRole('technician'), verifyAdmin: requireRole('admin') };
}
