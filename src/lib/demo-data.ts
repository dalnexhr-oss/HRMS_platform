// ============================================================================
// Demo data — a verbatim copy of the prototype's embedded DATA object plus the
// static dashboard arrays. Used as a fallback so the UI renders before Supabase
// is connected, and as the seed source of truth.
// ============================================================================
import type { AttendanceStatus } from '@/types/database';

export interface DemoEmployee {
  code: string;
  name: string;
  branch: string;
  gender: 'Male' | 'Female';
  doj: string;
  gross: number;
  uan: string;
  esic_no: string | null;
  statuses: AttendanceStatus[];
  times: { in: string; out: string; hrs: string }[];
  sum: { P: number; LM: number; HD: number; L: number; WO: number; working: number; payable: number };
  worked: string;
  target: string;
  worked_min: number;
  target_min: number;
  pay: {
    perday: number; earned: number; basic_e: number; hra_e: number; spl_e: number;
    shortmin: number; shortfall: number; pf: number; pf_er: number;
    esic: number; esic_er: number; pt: number; net: number;
  };
}

export interface DemoData {
  days: number[];
  week_offs: number[];
  employees: DemoEmployee[];
}

export const DATA: DemoData = {
  days: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],
  week_offs: [6,7,14,20,21,28],
  employees: [
    { code:'DN001', name:'Rajesh Kumar', branch:'Pune', gender:'Male', doj:'15 Jul 2022', gross:45000, uan:'101234567890', esic_no:null,
      statuses:['P','P','P','P','P','WO','WO','P','P','P','P','P','P','WO','P','P','P','P','HD','WO','WO','P','P','L','P','P','P','WO','P','P'],
      times:[{in:'08:57',out:'18:17',hrs:'09:20'},{in:'08:58',out:'18:23',hrs:'09:25'},{in:'08:59',out:'18:15',hrs:'09:16'},{in:'09:00',out:'18:23',hrs:'09:23'},{in:'08:59',out:'18:17',hrs:'09:18'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'08:56',out:'18:15',hrs:'09:19'},{in:'09:06',out:'18:15',hrs:'09:09'},{in:'08:54',out:'18:35',hrs:'09:41'},{in:'08:53',out:'18:33',hrs:'09:40'},{in:'08:53',out:'18:17',hrs:'09:24'},{in:'08:57',out:'18:23',hrs:'09:26'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'08:55',out:'18:31',hrs:'09:36'},{in:'08:55',out:'19:05',hrs:'10:10'},{in:'08:59',out:'18:17',hrs:'09:18'},{in:'08:59',out:'18:15',hrs:'09:16'},{in:'09:12',out:'13:05',hrs:'03:53'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'08:56',out:'18:16',hrs:'09:20'},{in:'09:11',out:'18:19',hrs:'09:08'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'08:53',out:'18:15',hrs:'09:22'},{in:'08:55',out:'18:15',hrs:'09:20'},{in:'08:54',out:'18:15',hrs:'09:21'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'08:59',out:'18:16',hrs:'09:17'},{in:'09:47',out:'20:42',hrs:'10:55'}],
      sum:{P:22,LM:0,HD:1,L:1,WO:6,working:22.5,payable:28.5}, worked:'212:17', target:'208:08', worked_min:12737, target_min:12488,
      pay:{perday:1500.0,earned:42750,basic_e:21375,hra_e:12825,spl_e:8550,shortmin:0,shortfall:0,pf:2565,pf_er:2565,esic:0,esic_er:0,pt:200,net:39985} },
    { code:'DN002', name:'Amit Shah', branch:'Vadodara', gender:'Male', doj:'03 Jan 2024', gross:20000, uan:'100987654321', esic_no:'3100456789',
      statuses:['P','P','P','P','P','WO','WO','P','P','P','LM','P','P','WO','P','P','P','P','P','WO','WO','P','P','L','LM','P','P','WO','P','HD'],
      times:[{in:'09:45',out:'18:20',hrs:'08:35'},{in:'09:05',out:'18:19',hrs:'09:14'},{in:'09:02',out:'18:19',hrs:'09:17'},{in:'08:56',out:'18:31',hrs:'09:35'},{in:'09:03',out:'18:24',hrs:'09:21'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:04',out:'18:23',hrs:'09:19'},{in:'09:31',out:'18:18',hrs:'08:47'},{in:'09:09',out:'18:32',hrs:'09:23'},{in:'10:19',out:'19:21',hrs:'09:02'},{in:'09:11',out:'18:27',hrs:'09:16'},{in:'09:09',out:'18:30',hrs:'09:21'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:08',out:'18:20',hrs:'09:12'},{in:'09:12',out:'18:34',hrs:'09:22'},{in:'09:39',out:'18:42',hrs:'09:03'},{in:'08:36',out:'19:40',hrs:'11:04'},{in:'09:21',out:'19:51',hrs:'10:30'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:28',out:'18:34',hrs:'09:06'},{in:'09:04',out:'18:32',hrs:'09:28'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:39',out:'17:38',hrs:'07:59'},{in:'09:15',out:'18:19',hrs:'09:04'},{in:'09:51',out:'18:16',hrs:'08:25'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:53',out:'18:54',hrs:'09:01'},{in:'09:48',out:'14:14',hrs:'04:26'}],
      sum:{P:20,LM:2,HD:1,L:1,WO:6,working:22.5,payable:28.5}, worked:'207:50', target:'208:08', worked_min:12470, target_min:12488,
      pay:{perday:666.67,earned:19000,basic_e:9500,hra_e:5700,spl_e:3800,shortmin:18,shortfall:21,pf:1140,pf_er:1140,esic:143,esic_er:618,pt:200,net:17496} },
    { code:'DN003', name:'Priya Deshmukh', branch:'Pune', gender:'Female', doj:'20 Mar 2023', gross:32000, uan:'101122334455', esic_no:null,
      statuses:['P','P','P','P','P','WO','WO','P','P','P','P','P','P','WO','HD','L','P','P','P','WO','WO','P','P','P','P','P','P','WO','HD','P'],
      times:[{in:'09:17',out:'18:44',hrs:'09:27'},{in:'09:15',out:'18:32',hrs:'09:17'},{in:'09:15',out:'18:32',hrs:'09:17'},{in:'09:15',out:'18:22',hrs:'09:07'},{in:'09:17',out:'18:42',hrs:'09:25'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:21',out:'18:43',hrs:'09:22'},{in:'09:25',out:'18:29',hrs:'09:04'},{in:'09:20',out:'18:34',hrs:'09:14'},{in:'09:19',out:'18:38',hrs:'09:19'},{in:'09:20',out:'18:38',hrs:'09:18'},{in:'09:10',out:'18:31',hrs:'09:21'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:28',out:'12:34',hrs:'03:06'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:34',out:'18:25',hrs:'08:51'},{in:'09:09',out:'18:38',hrs:'09:29'},{in:'09:23',out:'18:24',hrs:'09:01'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:27',out:'18:28',hrs:'09:01'},{in:'09:29',out:'18:04',hrs:'08:35'},{in:'09:40',out:'18:12',hrs:'08:32'},{in:'09:26',out:'18:17',hrs:'08:51'},{in:'09:12',out:'18:25',hrs:'09:13'},{in:'09:12',out:'18:11',hrs:'08:59'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'13:31',out:'18:26',hrs:'04:55'},{in:'09:22',out:'18:27',hrs:'09:05'}],
      sum:{P:21,LM:0,HD:2,L:1,WO:6,working:22,payable:28}, worked:'199:49', target:'203:30', worked_min:11989, target_min:12210,
      pay:{perday:1066.67,earned:29867,basic_e:14933,hra_e:8960,spl_e:5973,shortmin:221,shortfall:425,pf:1792,pf_er:1792,esic:0,esic_er:0,pt:200,net:27450} },
    { code:'DN004', name:'Sneha Patel', branch:'Vadodara', gender:'Female', doj:'11 Sep 2024', gross:26000, uan:'100556677889', esic_no:'3100998877',
      statuses:['P','P','P','P','L','WO','WO','HD','L','L','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD','HD'],
      times:[{in:'09:08',out:'18:20',hrs:'09:12'},{in:'09:05',out:'18:19',hrs:'09:14'},{in:'09:03',out:'18:35',hrs:'09:32'},{in:'09:03',out:'18:33',hrs:'09:30'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:05',out:'23:55',hrs:'14:50'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:00',out:'13:14',hrs:'04:14'},{in:'09:01',out:'13:22',hrs:'04:21'},{in:'09:02',out:'13:31',hrs:'04:29'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:01',out:'13:18',hrs:'04:17'},{in:'09:01',out:'13:31',hrs:'04:30'},{in:'09:00',out:'13:46',hrs:'04:46'},{in:'09:01',out:'13:16',hrs:'04:15'},{in:'09:00',out:'13:16',hrs:'04:16'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:01',out:'13:33',hrs:'04:32'},{in:'09:02',out:'13:55',hrs:'04:53'},{in:'09:02',out:'13:17',hrs:'04:15'},{in:'09:01',out:'13:32',hrs:'04:31'},{in:'09:06',out:'13:21',hrs:'04:15'},{in:'09:04',out:'12:44',hrs:'03:40'},{in:'00:00',out:'00:00',hrs:'00:00'},{in:'09:01',out:'14:17',hrs:'05:16'},{in:'09:02',out:'13:48',hrs:'04:46'}],
      sum:{P:4,LM:0,HD:21,L:3,WO:2,working:15,payable:17}, worked:'123:34', target:'97:08', worked_min:7414, target_min:5828,
      pay:{perday:866.67,earned:14733,basic_e:7367,hra_e:4420,spl_e:2947,shortmin:0,shortfall:0,pf:884,pf_er:884,esic:0,esic_er:0,pt:200,net:13649} },
  ],
};

// ---- static dashboard content (from the prototype) ----

export const PUNCH_LOG: [string, string, string, string, string, string, AttendanceStatus][] = [
  ['DN007','Kavita Rao','Pune','10:14','—','2h 06m','LM'],
  ['DN001','Rajesh Kumar','Pune','08:57','—','3h 23m','P'],
  ['DN002','Amit Shah','Vadodara','09:02','—','3h 18m','S'],
  ['DN003','Priya Deshmukh','Pune','09:11','—','3h 09m','P'],
  ['DN019','Nilesh Joshi','Vadodara','09:24','—','2h 56m','P'],
  ['DN011','Deepak Nair','Pune','08:49','—','3h 31m','P'],
  ['DN004','Sneha Patel','Vadodara','09:31','13:05','3h 34m','HD'],
  ['DN023','Farhan Sheikh','Pune','—','—','—','AB'],
];

export const CELEBRATIONS = [
  { icon: '🎂', name: 'Kavita Rao', note: 'birthday', meta: 'Pune · Accounts' },
  { icon: '🎂', name: 'Arjun Mehta', note: 'birthday', meta: 'Vadodara · Sales' },
  { icon: '🏅', name: 'Rajesh Kumar', note: '4 years at Dalnex', meta: 'Pune · Operations' },
];

export const MARKS_WATCH = [
  { name: 'Kavita Rao', marks: 2, hot: true },
  { name: 'Amit Shah', marks: 1, hot: false },
  { name: 'Nilesh Joshi', marks: 1, hot: false },
];

export const DEMO_POLICIES = [
  {
    id: 'pol-1', title: 'Attendance & Punch Policy', category: 'Attendance', version: 2,
    effective_date: '2026-01-01',
    body: 'Punch in from the mobile app on arrival and punch out when leaving. Three late marks in a calendar month convert the third into an automatic half-day. Outdoor duty / site visits must be approved in advance to punch outside the office geofence.',
  },
  {
    id: 'pol-2', title: 'Leave Policy', category: 'Leave', version: 1,
    effective_date: '2026-01-01',
    body: 'Paid leave accrues monthly and must be applied for through the app. Sudden absences without an approved leave or a punch are marked Absent. Leave balances are shown on your dashboard.',
  },
  {
    id: 'pol-3', title: 'Code of Conduct', category: 'HR', version: 3,
    effective_date: '2026-04-01',
    body: 'Treat colleagues, clients and company property with respect. Report grievances through the Helpdesk. Any harassment or misuse of company resources is subject to disciplinary action.',
  },
  {
    id: 'pol-4', title: 'Payroll & Reimbursement', category: 'Payroll', version: 1,
    effective_date: '2026-01-01',
    body: 'Salaries are processed after the monthly register locks (typically the 10th). Statutory deductions (PF, ESIC, Professional Tax) follow applicable law. Reimbursement claims must be submitted with receipts before the adjustments window closes.',
  },
];

export const ACTIVITY = [
  { when: '11:00 PM', html: 'Night sweep closed <b>1 open session</b> yesterday — Deepak Nair auto punched-out at 6:00 PM.' },
  { when: '10:14 AM', html: '<b>Kavita Rao</b> earned a late mark (in at 10:14). 2 marks this month.' },
  { when: '9:02 AM', html: '<b>Amit Shah</b> punched in from approved site visit — Nashik client location.' },
];

// ---- settings / holidays / notices / helpdesk / requests demo datasets ----
// These are already in the view shape returned by the matching query fns, so the
// no-Supabase fallback path in queries.ts is a straight `return DEMO_...`.

export const DEMO_SETTINGS = [
  { key: 'mark_threshold',   value: 3,        label: 'Late marks before auto half-day', description: '3rd late mark in a month becomes an automatic half-day.' },
  { key: 'shift_start',      value: '09:00',  label: 'Shift start', description: 'Standard office shift start time.' },
  { key: 'shift_end',        value: '18:00',  label: 'Shift end',   description: 'Standard office shift end time.' },
  { key: 'full_day_minutes', value: 480,      label: 'Full-day minutes', description: 'Minutes that constitute a full working day.' },
  { key: 'night_sweep_time', value: '23:00',  label: 'Night sweep', description: 'Auto punch-out time for open sessions.' },
  { key: 'esic_gross_cap',   value: 21000,    label: 'ESIC gross cap', description: 'ESIC applies only when monthly gross is at or below this cap.' },
];

// branch null = all branches
export const DEMO_HOLIDAYS = [
  { id: 'hol-1', date: '2026-08-15', name: 'Independence Day',            branch: null },
  { id: 'hol-2', date: '2026-09-14', name: 'Ganesh Chaturthi',           branch: 'Pune' },
  { id: 'hol-3', date: '2026-10-02', name: 'Gandhi Jayanti',             branch: null },
  { id: 'hol-4', date: '2026-10-20', name: 'Dussehra',                   branch: null },
  { id: 'hol-5', date: '2026-11-08', name: 'Diwali (Deepavali)',         branch: null },
  { id: 'hol-6', date: '2026-11-09', name: 'Nutan Varsh (Gujarati New Year)', branch: 'Vadodara' },
];

export const DEMO_NOTICES = [
  { id: 'notice-1', title: 'June payroll locks Friday 10 July',
    body: 'The June 2026 register locks at end of day on Friday 10 July. Please clear pending punch corrections and leave approvals before then — adjustments close after lock.',
    channel: 'both' as const, branch: null, published: true,
    publishedAt: '2026-07-06T09:30:00+05:30', createdAt: '2026-07-06T09:15:00+05:30' },
  { id: 'notice-2', title: 'Diwali holiday schedule',
    body: 'Offices will remain closed for Diwali (Deepavali) on 8 November. Vadodara additionally observes Nutan Varsh on 9 November. Plan client commitments accordingly.',
    channel: 'app' as const, branch: null, published: true,
    publishedAt: '2026-07-10T11:00:00+05:30', createdAt: '2026-07-10T10:45:00+05:30' },
  { id: 'notice-3', title: 'New biometric punch app v2.1',
    body: 'Version 2.1 of the punch app is now live with faster geofence checks and offline punch queueing. Update from the app store and re-login once to refresh your session.',
    channel: 'both' as const, branch: null, published: true,
    publishedAt: '2026-07-12T18:00:00+05:30', createdAt: '2026-07-12T17:40:00+05:30' },
];

export const DEMO_TICKETS = [
  { id: 'tk-1', subject: 'Payslip PF amount looks wrong', body: 'My June payslip shows a PF deduction that seems higher than usual. Can someone check the basic used for the calculation?',
    category: 'Payroll', status: 'open' as const, employeeName: 'Priya Deshmukh', employeeCode: 'DN003', resolutionNote: null, createdAt: '2026-07-13T10:20:00+05:30' },
  { id: 'tk-2', subject: 'Update my WhatsApp number', body: 'I changed my mobile number. Please update it so I keep getting notice alerts on WhatsApp.',
    category: 'Profile', status: 'in_progress' as const, employeeName: 'Amit Shah', employeeCode: 'DN002', resolutionNote: null, createdAt: '2026-07-11T14:05:00+05:30' },
  { id: 'tk-3', subject: 'Reimbursement not reflected', body: 'The travel reimbursement I submitted last month has not shown up in my payslip yet.',
    category: 'Payroll', status: 'resolved' as const, employeeName: 'Rajesh Kumar', employeeCode: 'DN001',
    resolutionNote: 'Verified with finance — the claim was approved and will appear in your July payslip.', createdAt: '2026-07-04T09:40:00+05:30' },
];

export const DEMO_REQUESTS = [
  { id: 'req-1', employeeName: 'Priya Deshmukh', employeeCode: 'DN003', branch: 'Pune',
    type: 'leave' as const, leaveKind: 'PL', startDate: '2026-07-16', endDate: '2026-07-17', days: 2,
    reason: 'Family function in Nagpur.', status: 'pending' as const, balanceAfter: 7.0 },
  { id: 'req-2', employeeName: 'Amit Shah', employeeCode: 'DN002', branch: 'Vadodara',
    type: 'site_visit' as const, leaveKind: null, startDate: '2026-07-21', endDate: '2026-07-22', days: 2,
    reason: 'Client install at Nashik plant.', status: 'pending' as const, balanceAfter: null },
];
