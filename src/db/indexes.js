// BetterAuth owns user identity in its default "user" collection.
// Its session/account/verification collections are auth infrastructure.
export const collectionNames = Object.freeze({ users: 'user', services: 'services', bookings: 'bookings', payments: 'payments' });
export const activeBookingStatuses = Object.freeze(['requested', 'accepted', 'in-progress']);

export async function ensureIndexes(db) {
  await db.collection(collectionNames.users).createIndexes([
    { key: { email: 1 }, name: 'user_email_unique', unique: true },
    { key: { role: 1, createdAt: -1 }, name: 'user_role_created' },
  ]);
  await db.collection(collectionNames.services).createIndexes([
    { key: { approvalStatus: 1, isAvailable: 1, createdAt: -1 }, name: 'public_services_newest' },
    { key: { approvalStatus: 1, isAvailable: 1, category: 1, serviceMode: 1, basePrice: 1 }, name: 'public_services_filters_price' },
    { key: { technicianEmail: 1, createdAt: -1 }, name: 'technician_services' },
  ]);
  await db.collection(collectionNames.bookings).createIndexes([
    // The constraint remains correct under simultaneous requests and releases
    // automatically when a booking leaves an active status.
    { key: { customerEmail: 1, serviceId: 1 }, name: 'one_active_request_per_service', unique: true,
      partialFilterExpression: { status: { $in: [...activeBookingStatuses] } } },
    { key: { customerEmail: 1, createdAt: -1 }, name: 'customer_bookings' },
    { key: { technicianEmail: 1, status: 1, createdAt: -1 }, name: 'technician_job_queue' },
    { key: { status: 1, createdAt: -1 }, name: 'admin_booking_status' },
  ]);
  await db.collection(collectionNames.payments).createIndexes([
    { key: { bookingId: 1 }, name: 'one_payment_per_booking', unique: true },
    { key: { stripeSessionId: 1 }, name: 'stripe_session_unique', unique: true },
    { key: { transactionId: 1 }, name: 'stripe_intent_unique', unique: true },
    { key: { customerEmail: 1, paidAt: -1 }, name: 'customer_payment_history' },
    { key: { technicianEmail: 1, paidAt: -1 }, name: 'technician_payments' },
    { key: { paidAt: -1 }, name: 'admin_transactions' },
  ]);
}

