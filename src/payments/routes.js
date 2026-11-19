import { Router } from 'express';

export function paymentRoutes(payments, authorization) {
  const router = Router();
  router.use(authorization.verifyToken, authorization.verifyCustomer);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const run = handler => async (req, res, next) => {
    try { res.json(await handler(req)); }
    catch (error) {
      if ([502, 503].includes(error.status)) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  };
  router.post('/checkout', run(req => payments.checkout(req.body?.bookingId, req.user.email)));
  router.post('/verify', run(req => payments.fulfill(req.body?.sessionId, req.user.email)));
  return router;
}

export function paymentWebhook(payments) {
  return async (req, res) => {
    let event;
    try { event = payments.event(req.body, req.headers['stripe-signature']); }
    catch (error) { return res.status(error.status || 400).json({ message: error.message }); }
    try {
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) await payments.fulfill(event.data.object.id);
      res.json({ received: true });
    } catch { res.status(500).json({ message: 'Payment processing failed. Please retry delivery.' }); }
  };
}
