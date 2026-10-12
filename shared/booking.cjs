'use strict';

const TARGET = 'tieto booking sluppen p40';
const { SessionExpiredError } = require('./mobile.cjs');
const bookingsInFlight = new WeakMap();
const comparablePlate = value => String(value || '').replace(/[ -]/g, '').toUpperCase();
const targetPermit = permit => String(permit.name || '').trim().toLowerCase() === TARGET;

function permitKey(permit) {
  return JSON.stringify([permit.id || null, comparablePlate(plateFromPermit(permit)),
    permit.validFrom || null, permit.expiresAt || null]);
}

async function clearBookingAttempt(client) {
  client.pendingOrderId = undefined;
  client.uncertainAcquisition = false;
  client.bookingAttempt = undefined;
  await client.persistSession?.();
}

async function reconcileBookingAttempt(client, permits, { plateNumber, now = new Date(), fromBooking = false } = {}) {
  if ((!client.pendingOrderId && !client.uncertainAcquisition) ||
      (!fromBooking && bookingsInFlight.has(client))) return false;
  const attempt = client.bookingAttempt;
  let confirmed;
  if (attempt) {
    if (!validPlate(attempt.plateNumber) || !Number.isFinite(attempt.startedAt) ||
        !Array.isArray(attempt.previousPermitKeys)) return false;
    confirmed = assessVehiclePermit(permits, attempt.plateNumber, now).state === 'active' || permits.some(permit => {
      if (!targetPermit(permit) || comparablePlate(plateFromPermit(permit)) !== comparablePlate(attempt.plateNumber) ||
          attempt.previousPermitKeys.includes(permitKey(permit))) return false;
      const end = Date.parse(permit.expiresAt);
      const start = Date.parse(permit.validFrom);
      // A newly observed permit for this attempt resolves its order even after expiry.
      return Number.isFinite(start) && Number.isFinite(end) && end > start &&
        end > attempt.startedAt && start <= now.getTime() && osloDate(new Date(start)) === attempt.date;
    });
  } else {
    // Older versions saved no attempt identity. A current matching permit is the
    // only evidence available to retire that legacy guard automatically.
    confirmed = validPlate(plateNumber) && assessVehiclePermit(permits, plateNumber, now).state === 'active';
  }
  if (!confirmed) return false;
  await clearBookingAttempt(client);
  return true;
}

function unresolvedBookingState(client) {
  if (client.pendingOrderId) return { state: 'pending', bookingBlocked: true,
    message: 'A previous Tieto P40 order is unconfirmed. Check it in SmartPark, then check permits again. No new booking was sent.' };
  if (client.uncertainAcquisition) return { state: 'unknown', bookingBlocked: true,
    message: 'A previous booking request has an uncertain outcome. Check SmartPark before trying again. No new booking was sent.' };
  return null;
}

function osloDate(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(at);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function assessMobilePermits(permits, at = new Date()) {
  const target = permits.filter(permit =>
    typeof permit.name === 'string' && permit.name.trim().toLowerCase() === TARGET);
  if (!target.length) return { state: 'missing', message: 'No Tieto P40 permit was found.' };
  for (const permit of target) {
    const end = Date.parse(permit.expiresAt);
    const start = permit.validFrom ? Date.parse(permit.validFrom) : NaN;
    if (!Number.isFinite(end)) continue;
    if (end > at.getTime() && (!Number.isFinite(start) || start <= at.getTime())) {
      return { state: 'active', message: `Tieto P40 permit active until ${new Date(end).toLocaleString()}.`,
        validToTime: permit.expiresAt, validToEpochMs: end, plateNumber: plateFromPermit(permit) };
    }
    if (end > at.getTime() && start > at.getTime()) {
      return { state: 'scheduled', message: 'A Tieto P40 permit is already scheduled.' };
    }
  }
  if (target.some(permit => !Number.isFinite(Date.parse(permit.expiresAt)))) {
    return { state: 'unknown', message: 'A Tieto permit exists, but its expiry could not be verified.' };
  }
  return { state: 'missing', message: 'No current Tieto P40 permit was found.' };
}

function plateFromPermit(permit) {
  const value = permit.formFields?.find(field => field.name === 'plate_number_1')?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function plateFromPermits(permits) {
  for (const permit of permits) {
    if (String(permit.name || '').trim().toLowerCase() !== TARGET) continue;
    const value = plateFromPermit(permit);
    if (value) return value;
  }
  return null;
}

function validPlate(value) {
  return typeof value === 'string' && /^[\p{L}\p{N} -]{2,16}$/u.test(value.trim());
}

function assessVehiclePermit(permits, plateNumber, at = new Date()) {
  const state = assessMobilePermits(permits, at);
  const comparable = value => String(value).replace(/[ -]/g, '').toUpperCase();
  if (state.state === 'active' && state.plateNumber && validPlate(plateNumber) &&
      comparable(state.plateNumber) !== comparable(plateNumber)) {
    return { state: 'vehicle-mismatch',
      message: `The active Tieto P40 permit is for ${state.plateNumber}, not ${plateNumber}. Check SmartPark before parking this car.` };
  }
  return state;
}

async function confirmPermit(client, attempts = 6, at = new Date(), plateNumber) {
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, client.confirmationDelayMs ?? 2000));
    try {
      const state = assessVehiclePermit(await client.getMyPermits(), plateNumber, at);
      if (state.state === 'active') return state;
    } catch { /* A later read or the acquisition response may still confirm it. */ }
  }
  return null;
}

async function prepareTieto(client, permits, plateNumber, now) {
  const plate = plateNumber?.trim() || plateFromPermits(permits);
  if (!validPlate(plate)) {
    return { state: 'needs-plate', message: 'Enter your vehicle plate in DumbPark before booking.' };
  }
  const variants = new Map((await client.getTietoVariants()).map(variant => [variant.id, variant]));
  if (variants.size !== 1) {
    return { state: 'unknown', message: `Expected one Tieto P40 variant; found ${variants.size}. Booking stopped.` };
  }
  const variant = [...variants.values()][0];
  if (variant.priceCents !== 0) {
    return { state: 'unknown', message: 'The Tieto P40 price is no longer zero. Booking stopped.' };
  }
  if (variant.availability?.inStock !== true) {
    return { state: 'unavailable', message: 'No Tieto P40 space is available right now.' };
  }
  const fields = variant.formFields || [];
  const required = fields.filter(field => field.required).map(field => field.name).sort();
  if (JSON.stringify(required) !== JSON.stringify(['plate_number_1', 'start_date'])) {
    return { state: 'unknown', message: 'SmartPark changed the required booking fields. Booking stopped.' };
  }
  const formData = [
    { name: 'plate_number_1', value: plate },
    { name: 'start_date', value: osloDate(now) }
  ];
  const preview = await client.previewOrder(variant.id, formData);
  if (preview.availability && preview.availability.inStock !== true) {
    return { state: 'unavailable', message: 'SmartPark reports no Tieto P40 space for today.' };
  }
  if (preview.price && preview.price.priceCents !== 0) {
    return { state: 'unknown', message: 'SmartPark quoted a nonzero price. Booking stopped.' };
  }
  return { state: 'ready', message: 'SmartPark confirms a free Tieto P40 space for today.',
    variantId: variant.id, formData };
}

function bookTieto(client, options = {}) {
  const running = bookingsInFlight.get(client);
  if (running) {
    if (comparablePlate(running.plateNumber) === comparablePlate(options.plateNumber)) return running.promise;
    return Promise.resolve({ state: 'pending', message: 'A booking for another car is running. Let it finish before booking this car.' });
  }
  const promise = runBooking(client, options).finally(() => {
    if (bookingsInFlight.get(client)?.promise === promise) bookingsInFlight.delete(client);
  });
  bookingsInFlight.set(client, { plateNumber: options.plateNumber, promise });
  return promise;
}

async function runBooking(client, { plateNumber, now = new Date() } = {}) {
  const permits = await client.getMyPermits();
  await reconcileBookingAttempt(client, permits, { plateNumber, now, fromBooking: true });
  const state = assessVehiclePermit(permits, plateNumber, now);
  if (state.state === 'active') {
    return state;
  }
  if (state.state !== 'missing') return state;
  const unresolved = unresolvedBookingState(client);
  if (unresolved) return unresolved;
  const prepared = await prepareTieto(client, permits, plateNumber, now);
  if (prepared.state !== 'ready') return prepared;

  // Acquisition keeps one idempotency key; only an explicit auth rejection permits a retry.
  // If its response is lost, read the permit list before reporting uncertainty.
  let acquired;
  const idempotencyKey = globalThis.crypto.randomUUID();
  client.bookingAttempt = { date: osloDate(now), startedAt: now.getTime(),
    plateNumber: prepared.formData.find(field => field.name === 'plate_number_1').value,
    idempotencyKey, previousPermitKeys: permits.filter(targetPermit).map(permitKey) };
  client.uncertainAcquisition = true;
  try { await client.persistSession?.(); }
  catch (error) {
    // The request has not been sent, so this is not an uncertain acquisition.
    client.bookingAttempt = undefined;
    client.uncertainAcquisition = false;
    throw error;
  }
  try { acquired = await client.acquirePermit(prepared.variantId, prepared.formData, idempotencyKey); }
  catch (error) {
    if (error instanceof SessionExpiredError) {
      await clearBookingAttempt(client);
      throw error;
    }
    const after = await confirmPermit(client, 6, now, plateNumber);
    if (after) {
      await clearBookingAttempt(client);
      return after;
    }
    return { state: 'unknown', bookingBlocked: true,
      message: `Booking outcome is uncertain: ${error.message} Check SmartPark before trying again.` };
  }
  if (acquired.orderId) {
    client.pendingOrderId = acquired.orderId;
    client.uncertainAcquisition = false;
    await client.persistSession?.();
    const after = await confirmPermit(client, 6, now, plateNumber);
    if (after) {
      await clearBookingAttempt(client);
      return after;
    }
    return { state: 'pending', bookingBlocked: true,
      message: 'SmartPark accepted the order but has not yet confirmed the permit. Check permits again shortly; do not book again.' };
  }
  if (!acquired.permit || String(acquired.permit.name || '').trim().toLowerCase() !== TARGET) {
    return { state: 'unknown', bookingBlocked: true,
      message: 'SmartPark did not confirm the Tieto permit. Check SmartPark before trying again.' };
  }
  await clearBookingAttempt(client);
  const end = Date.parse(acquired.permit.expiresAt);
  return { state: 'booked', message: 'SmartPark confirmed the Tieto P40 booking.',
    validToTime: acquired.permit.expiresAt || null, validToEpochMs: Number.isFinite(end) ? end : null };
}

module.exports = { osloDate, assessMobilePermits, assessVehiclePermit, plateFromPermits, validPlate,
  bookTieto, reconcileBookingAttempt, unresolvedBookingState };
