import 'server-only';
import { db, withTransaction } from '@/lib/db/mongodb-connection';
import { createQueryClient } from '@/lib/db/scoped-query-client';
import { classify, readPunchPolicy, resolveDay } from '@/lib/punch';
import { localParts } from '@/lib/punch-day';
import { punchWriteReason, readDayEvents } from '@/lib/punch-storage';
import { toCoordinate } from '@/lib/db/decimal-conversions';
import { allowsZktecoPunch } from '@/lib/punch-access';
import { crossTransportReceiptFilter, deviceEventId, devicePunchKind } from './punch-protocol';
import { resolveDeviceEmployee, UnknownDeviceEmployee } from './employee-mapping';
import type { Document } from 'mongodb';
import type { DevicePunch } from './punch-protocol';

async function recordDevicePunch(event: DevicePunch) {
  const database = await db();
  const eventId = deviceEventId(event);
  const mode = process.env.ZKTECO_PUNCH_MODE ?? 'toggle';
  if (mode !== 'toggle' && mode !== 'device') {
    throw new Error('ZKTECO_PUNCH_MODE must be toggle or device.');
  }
  const debounceSeconds = Number(process.env.ZKTECO_DEBOUNCE_SECONDS ?? '60');
  if (!Number.isFinite(debounceSeconds) || debounceSeconds < 0 || debounceSeconds > 300) {
    throw new Error('ZKTECO_DEBOUNCE_SECONDS must be between 0 and 300.');
  }

  return withTransaction(
    async (session) => {
      const receipts = database.collection<Document & { _id: string }>('device_punch_receipts');
      const previous = await receipts.findOne({ _id: eventId }, { session });
      if (previous) {
        return { status: previous.status as string, duplicate: true, eventId };
      }
      const { terminal, link, employee, login } = await resolveDeviceEmployee(
        database,
        event,
        session,
      );
      // Employee resolution holds the same write lock used by all attendance writers.
      // During cutover, a pull packet and an ADMS row can describe the same scan.
      const otherTransport = await receipts.findOne(
        crossTransportReceiptFilter(event, employee._id),
        { session },
      );
      if (otherTransport) {
        return { status: otherTransport.status as string, duplicate: true, eventId };
      }
      const deviceAllowed = allowsZktecoPunch(login?.punch_access);
      const at = new Date(event.timestamp);
      const date = localParts(at).date;
      const prior = await readDayEvents(employee._id, date, session);
      const dbc = createQueryClient(true, session);
      const { office, requireLocation } = await readPunchPolicy(employee._id, dbc);
      const latitude = terminal.latitude;
      const longitude = terminal.longitude;
      const point =
        typeof latitude === 'number' &&
        Number.isFinite(latitude) &&
        Math.abs(latitude) <= 90 &&
        typeof longitude === 'number' &&
        Number.isFinite(longitude) &&
        Math.abs(longitude) <= 180
          ? { latitude, longitude, accuracy: 0 }
          : null;
      // Coordinates belong to the registered fixed terminal, never to the request payload.
      if (deviceAllowed && requireLocation && !point) {
        throw new UnknownDeviceEmployee(
          'Register the fixed terminal location to satisfy the HRMS location policy.',
        );
      }
      const blocked = await punchWriteReason(employee._id, date, session);
      const last = prior.at(-1);
      const elapsed = last ? at.getTime() - new Date(last.punched_at).getTime() : Infinity;
      let status = 'recorded';
      let reason: string | null = null;
      let kind: 'in' | 'out' | null = null;
      if (!deviceAllowed) {
        // A deliberate access restriction is acknowledged, so changing it later cannot
        // replay scans that were refused under the current setting.
        status = 'ignored';
        reason = 'ZKTeco punching is disabled for this user. Use the web punch buttons.';
      } else if (blocked || date < localParts().date) {
        status = 'needs_review';
        reason =
          blocked ??
          'This scan arrived after its IST work day ended. HR must review it without reopening a swept day.';
      } else if (elapsed < 0) {
        status = 'needs_review';
        reason =
          'A newer punch already exists; review this delayed scan before changing attendance.';
      } else if (elapsed <= debounceSeconds * 1000) {
        status = 'ignored';
        reason = 'Repeated scan inside the debounce window.';
      } else {
        try {
          kind = devicePunchKind(event.punch, mode, last?.kind);
        } catch (error) {
          if (mode !== 'device') {
            throw error;
          }
          status = 'needs_review';
          reason = error instanceof Error ? error.message : 'Unsupported punch code.';
        }
        if (
          kind &&
          ((kind === 'in' && last?.kind === 'in') || (kind === 'out' && last?.kind !== 'in'))
        ) {
          status = 'needs_review';
          reason = 'Device direction conflicts with the current attendance state.';
        }
      }
      if (status === 'recorded' && kind) {
        const { error } = await dbc.from('punch_events').insert({
          _id: `zkteco-${eventId}`,
          employee_id: employee._id,
          punched_at: at,
          kind,
          lat: toCoordinate(point?.latitude ?? null),
          lng: toCoordinate(point?.longitude ?? null),
          within_geofence: classify(point, office),
          source: 'zkteco',
          location_source: 'fixed_terminal',
          device_branch_id: terminal.branch_id ?? null,
          device_id: event.deviceId,
          device_uid: link.device_uid,
          device_attendance_uid: event.uid ?? null,
          device_transport: event.source ?? 'pull',
          device_event_id: eventId,
        });
        if (error) {
          throw new Error(error.message);
        }
        await resolveDay(employee._id, date, [...prior, { kind, punched_at: at }], dbc);
      }
      await receipts.insertOne(
        {
          _id: eventId,
          device_id: event.deviceId,
          raw: event,
          device_uid: link.device_uid,
          employee_id: employee._id,
          user_id: login?._id ?? null,
          work_date: date,
          status,
          reason,
          kind,
          received_at: new Date(),
        },
        { session },
      );
      return { status, reason, kind, eventId, duplicate: false };
    },
    { required: true },
  );
}

export { recordDevicePunch };
