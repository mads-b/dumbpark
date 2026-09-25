'use strict';

const TARGET = 'tieto booking sluppen p40';

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

async function confirmPermit(client, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, client.confirmationDelayMs ?? 2000));
    try {
      const state = assessMobilePermits(await client.getMyPermits());
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

async function bookTieto(client, { plateNumber, now = new Date() } = {}) {
  const permits = await client.getMyPermits();
  const state = assessVehiclePermit(permits, plateNumber, now);
  if (state.state === 'active') {
    client.pendingOrderId = undefined;
    client.uncertainAcquisition = false;
    await client.persistSession?.();
    return state;
  }
  if (state.state !== 'missing') return state;
  if (client.pendingOrderId) {
    return { state: 'pending', message: 'A Tieto P40 order is still pending. Check permits again before trying to book.' };
  }
  if (client.uncertainAcquisition) {
    return { state: 'unknown', message: 'A previous booking request has an uncertain outcome. Check SmartPark before trying again.' };
  }
  const prepared = await prepareTieto(client, permits, plateNumber, now);
  if (prepared.state !== 'ready') return prepared;

  // The acquisition request has a fresh idempotency key and is never retried.
  // If its response is lost, read the permit list before reporting uncertainty.
  let acquired;
  client.uncertainAcquisition = true;
  await client.persistSession?.();
  try { acquired = await client.acquirePermit(prepared.variantId, prepared.formData, globalThis.crypto.randomUUID()); }
  catch (error) {
    const after = await confirmPermit(client);
    if (after) {
      client.uncertainAcquisition = false;
      await client.persistSession?.();
      return after;
    }
    return { state: 'unknown', message: `Booking outcome is uncertain: ${error.message} Check SmartPark before trying again.` };
  }
  if (acquired.orderId) {
    client.pendingOrderId = acquired.orderId;
    client.uncertainAcquisition = false;
    await client.persistSession?.();
    const after = await confirmPermit(client);
    if (after) {
      client.pendingOrderId = undefined;
      await client.persistSession?.();
      return after;
    }
    return { state: 'pending', message: 'SmartPark accepted the order but has not yet confirmed the permit. Check permits again shortly; do not book again.' };
  }
  if (!acquired.permit || String(acquired.permit.name || '').trim().toLowerCase() !== TARGET) {
    return { state: 'unknown', message: 'SmartPark did not confirm the Tieto permit. Check SmartPark before trying again.' };
  }
  client.uncertainAcquisition = false;
  await client.persistSession?.();
  const end = Date.parse(acquired.permit.expiresAt);
  return { state: 'booked', message: 'SmartPark confirmed the Tieto P40 booking.',
    validToTime: acquired.permit.expiresAt || null, validToEpochMs: Number.isFinite(end) ? end : null };
}

module.exports = { osloDate, assessMobilePermits, assessVehiclePermit, plateFromPermits, validPlate,
  bookTieto };
