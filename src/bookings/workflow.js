const forward = { requested: ['accepted', 'rejected'], accepted: ['in-progress'], 'in-progress': ['completed'] };

export function technicianTransition(current, next, amount) {
  if (typeof next !== 'string' || !Object.values(forward).flat().includes(next)) throw Object.assign(new Error('Choose a valid next job status.'), { status: 400 });
  if (!forward[current]?.includes(next)) throw Object.assign(new Error('This job cannot move from ' + current + ' to ' + next + '.'), { status: 409 });
  const fields = { status: next };
  if (next === 'completed') {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw Object.assign(new Error('Final amount must be positive USD with at most two decimal places.'), { status: 400 });
    fields.finalAmount = amount;
  }
  return fields;
}
