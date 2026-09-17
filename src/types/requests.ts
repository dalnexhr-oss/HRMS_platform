export interface RequestPerson {
  id: string;
  name: string;
  email: string;
}

export interface RequestRecipient extends RequestPerson {
  employeeId: string | null;
  /** Company role, department, and employee code for searching the directory. */
  detail: string;
}

export interface RequestApproval {
  approver: RequestPerson;
  decision: 'approved' | 'rejected';
  decidedAt: string;
  remark: string | null;
  forwardedTo: RequestPerson | null;
}

export interface RequestRouting {
  initialApprover: RequestPerson;
  currentApprover: RequestPerson;
  cc: RequestPerson[];
  history: RequestApproval[];
  revision: number;
}
