import type { AttendanceStatus } from '@/types/database';

// Status metadata: short label, CSS class, and display label. Site and travel share the
// outdoor-duty style.
const attendanceStatusMeta: Record<string, [string, string, string]> = {
  P: ['P', 'attendance-status-present', 'Present'],
  LM: ['LM', 'attendance-status-late', 'Late mark'],
  HD: ['HD', 'attendance-status-half-day', 'Half day'],
  L: ['L', 'attendance-status-leave', 'Leave'],
  WO: ['WO', 'attendance-status-weekly-off', 'Week off'],
  OH: ['OH', 'attendance-status-holiday', 'Holiday'],
  AB: ['A', 'attendance-status-absent', 'Absent'],
  S: ['S', 'attendance-status-outdoor-duty', 'Site'],
  T: ['T', 'attendance-status-outdoor-duty', 'Travel'],
  // A taken comp off is paid time off, so it shares the holiday stamp style.
  CO: ['CO', 'attendance-status-holiday', 'Comp off'],
};

function getAttendanceStatusDetails(s: AttendanceStatus | string) {
  return attendanceStatusMeta[s] ?? attendanceStatusMeta.P;
}

const registerLegend: Array<[AttendanceStatus, string]> = [
  ['P', 'Present'],
  ['LM', 'Late mark'],
  ['HD', 'Half day'],
  ['L', 'Leave'],
  ['WO', 'Week off'],
  ['OH', 'Holiday'],
  ['CO', 'Comp off'],
  ['S', 'Site / travel'],
];

const dow = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export { attendanceStatusMeta, getAttendanceStatusDetails, registerLegend, dow };

export type { AttendanceStatus };
