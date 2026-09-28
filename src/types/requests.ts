interface RequestPerson {
  id: string;
  name: string;
  email: string;
}

interface RequestRecipient extends RequestPerson {
  employeeId: string | null;
  /** Company role, department, and employee code for searching the directory. */
  detail: string;
}

interface RequestApproval {
  approver: RequestPerson;
  decision: 'approved' | 'rejected';
  decidedAt: string;
  remark: string | null;
  forwardedTo: RequestPerson | null;
}

interface RequestRouting {
  initialApprover: RequestPerson;
  currentApprover: RequestPerson;
  cc: RequestPerson[];
  history: RequestApproval[];
  revision: number;
}

type EmployeeApprovalView = 'all' | 'pending' | 'reviewed' | 'cc';

export type {
  RequestPerson,
  RequestRecipient,
  RequestApproval,
  RequestRouting,
  EmployeeApprovalView,
};
