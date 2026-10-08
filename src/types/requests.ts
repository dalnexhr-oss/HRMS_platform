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
  /**
   * True when the current approver's login has been disabled or deleted. Admin and HR may then
   * decide the request, so it is not left waiting on someone who cannot sign in.
   */
  approverUnavailable: boolean;
}

type EmployeeApprovalView = 'all' | 'pending' | 'reviewed' | 'cc';

export type {
  RequestPerson,
  RequestRecipient,
  RequestApproval,
  RequestRouting,
  EmployeeApprovalView,
};
