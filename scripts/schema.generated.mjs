// ============================================================================
// Collection validators and indexes. GENERATED from supabase/migrations/*.sql,
// then hand-adjusted — see the OVERRIDES block at the bottom, which is where
// anything the mechanical translation could not express lives.
//
// Translation rules, applied uniformly:
//   uuid, text        -> string            (uuid PKs keep their value, so every
//                                           existing foreign-key string stays valid)
//   date              -> "YYYY-MM-DD"      BSON Date is a UTC instant; a calendar
//                                          day round-tripped through it shifts in IST
//   time              -> "HH:MM"           BSON has no time-of-day type
//   timestamptz       -> BSON date         these genuinely are instants
//   numeric(p,s)      -> decimal           money is never float64
//   integer           -> int | long
//   jsonb             -> subdocument
//   enum type         -> enum, including every later `alter type ... add value`
//   unique (...)      -> unique index      the ONLY thing preventing duplicates now
//   references        -> plain index       no foreign keys exist to enforce
//
// NOT translated, because a JSON Schema cannot express them: cross-field CHECK
// constraints. Those appear in OVERRIDES as $expr clauses, or are enforced in
// the action that writes the collection.
// ============================================================================

export const GENERATED = {
  "branches": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "name",
          "state",
          "geofence_radius_m",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "name": {
            "bsonType": "string"
          },
          "state": {
            "enum": [
              "Andhra Pradesh",
              "Arunachal Pradesh",
              "Assam",
              "Bihar",
              "Chhattisgarh",
              "Goa",
              "Gujarat",
              "Haryana",
              "Himachal Pradesh",
              "Jharkhand",
              "Karnataka",
              "Kerala",
              "Madhya Pradesh",
              "Maharashtra",
              "Manipur",
              "Meghalaya",
              "Mizoram",
              "Nagaland",
              "Odisha",
              "Punjab",
              "Rajasthan",
              "Sikkim",
              "Tamil Nadu",
              "Telangana",
              "Tripura",
              "Uttar Pradesh",
              "Uttarakhand",
              "West Bengal",
              "Andaman and Nicobar Islands",
              "Chandigarh",
              "Dadra and Nagar Haveli and Daman and Diu",
              "Delhi",
              "Jammu and Kashmir",
              "Ladakh",
              "Lakshadweep",
              "Puducherry"
            ]
          },
          "address": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "geofence_lat": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "geofence_lng": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "geofence_radius_m": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "name": 1
        },
        "options": {
          "unique": true,
          "name": "branches_name_unique"
        }
      }
    ]
  },
  "departments": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "name"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "name": {
            "bsonType": "string"
          },
          "branch_id": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "branch_id": 1
        },
        "options": {
          "name": "departments_branch_id"
        }
      },
      {
        "keys": {
          "name": 1,
          "branch_id": 1
        },
        "options": {
          "unique": true,
          "name": "departments_name_branch_id_unique"
        }
      }
    ]
  },
  "employees": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "code",
          "full_name",
          "branch_id",
          "gender",
          "date_of_joining",
          "gross_monthly",
          "basic_da",
          "hra",
          "special_allowance",
          "status",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "code": {
            "bsonType": "string"
          },
          "full_name": {
            "bsonType": "string"
          },
          "branch_id": {
            "bsonType": "string"
          },
          "department_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "designation": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "gender": {
            "enum": [
              "Male",
              "Female",
              "Other"
            ]
          },
          "date_of_joining": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "date_of_birth": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "whatsapp": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "email": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "pan": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "pf_uan": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "esic_number": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "gross_monthly": {
            "bsonType": "decimal"
          },
          "basic_da": {
            "bsonType": "decimal"
          },
          "hra": {
            "bsonType": "decimal"
          },
          "special_allowance": {
            "bsonType": "decimal"
          },
          "status": {
            "enum": [
              "active",
              "on_notice",
              "inactive"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          },
          "mobile_official": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "mobile_personal": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "email_official": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "email_personal": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "aadhaar": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "bank_name": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "bank_account_number": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "bank_ifsc": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "emergency_contact_name": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "emergency_contact_relation": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "emergency_contact_phone": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "resignation_date": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "last_working_day": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "notice_period_days": {
            "bsonType": [
              "int",
              "long",
              "null"
            ]
          },
          "exit_reason": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "code": 1
        },
        "options": {
          "unique": true,
          "name": "employees_code_unique"
        }
      },
      {
        "keys": {
          "branch_id": 1
        },
        "options": {
          "name": "employees_branch_id"
        }
      },
      {
        "keys": {
          "department_id": 1
        },
        "options": {
          "name": "employees_department_id"
        }
      }
    ]
  },
  "punch_events": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "punched_at",
          "kind",
          "source",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "punched_at": {
            "bsonType": "date"
          },
          "kind": {
            "bsonType": "string"
          },
          "lat": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "lng": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "within_geofence": {
            "bsonType": [
              "bool",
              "null"
            ]
          },
          "source": {
            "bsonType": "string"
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "punch_events_employee_id"
        }
      }
    ]
  },
  "attendance_days": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "work_date",
          "status",
          "worked_minutes",
          "is_corrected",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "work_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "status": {
            "enum": [
              "P",
              "LM",
              "HD",
              "L",
              "WO",
              "OH",
              "AB",
              "S",
              "T",
              "CO"
            ]
          },
          "punch_in": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{2}:[0-9]{2}$"
          },
          "punch_out": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{2}:[0-9]{2}$"
          },
          "worked_minutes": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "is_corrected": {
            "bsonType": "bool"
          },
          "correction_reason": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "corrected_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "attendance_days_employee_id"
        }
      },
      {
        "keys": {
          "corrected_by": 1
        },
        "options": {
          "name": "attendance_days_corrected_by"
        }
      },
      {
        "keys": {
          "employee_id": 1,
          "work_date": 1
        },
        "options": {
          "unique": true,
          "name": "attendance_days_employee_id_work_date_unique"
        }
      }
    ]
  },
  "late_marks": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "mark_date",
          "auto_half_day",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "mark_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "auto_half_day": {
            "bsonType": "bool"
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "late_marks_employee_id"
        }
      },
      {
        "keys": {
          "employee_id": 1,
          "mark_date": 1
        },
        "options": {
          "unique": true,
          "name": "late_marks_employee_id_mark_date_unique"
        }
      }
    ]
  },
  "holidays": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "holiday_date",
          "name",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "holiday_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "name": {
            "bsonType": "string"
          },
          "branch_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "branch_id": 1
        },
        "options": {
          "name": "holidays_branch_id"
        }
      },
      {
        "keys": {
          "holiday_date": 1,
          "branch_id": 1
        },
        "options": {
          "unique": true,
          "name": "holidays_holiday_date_branch_id_unique"
        }
      }
    ]
  },
  "leave_balances": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "year",
          "type",
          "balance"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "year": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "type": {
            "enum": [
              "PL",
              "CL",
              "SL",
              "LWP"
            ]
          },
          "balance": {
            "bsonType": "decimal"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "leave_balances_employee_id"
        }
      },
      {
        "keys": {
          "employee_id": 1,
          "year": 1,
          "type": 1
        },
        "options": {
          "unique": true,
          "name": "leave_balances_employee_id_year_type_unique"
        }
      }
    ]
  },
  "requests": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "type",
          "start_date",
          "end_date",
          "days",
          "status",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "type": {
            "enum": [
              "leave",
              "site_visit",
              "outdoor_duty",
              "wfh",
              "comp_off"
            ]
          },
          "leave_kind": {
            "enum": [
              "PL",
              "CL",
              "SL",
              "LWP",
              null
            ]
          },
          "start_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "end_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "days": {
            "bsonType": "decimal"
          },
          "reason": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "status": {
            "enum": [
              "pending",
              "approved",
              "rejected",
              "cancelled"
            ]
          },
          "balance_after": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "reviewed_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "reviewed_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "review_remark": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "requests_employee_id"
        }
      },
      {
        "keys": {
          "reviewed_by": 1
        },
        "options": {
          "name": "requests_reviewed_by"
        }
      }
    ]
  },
  "payroll_runs": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "period_month",
          "status",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "period_month": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "status": {
            "enum": [
              "draft",
              "in_review",
              "locked",
              "paid"
            ]
          },
          "working_days": {
            "bsonType": [
              "int",
              "long",
              "null"
            ]
          },
          "target_minutes": {
            "bsonType": [
              "int",
              "long",
              "null"
            ]
          },
          "month_closed_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "drafts_computed_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "adjustments_open": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "adjustments_close": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "locked_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "paid_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "period_month": 1
        },
        "options": {
          "unique": true,
          "name": "payroll_runs_period_month_unique"
        }
      }
    ]
  },
  "payslips": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "payroll_run_id",
          "employee_id",
          "payable_days",
          "worked_minutes",
          "target_minutes",
          "shortfall_minutes",
          "per_day_rate",
          "basic_earned",
          "hra_earned",
          "special_earned",
          "earned_gross",
          "shortfall_amount",
          "pf_employee",
          "pf_employer",
          "esic_employee",
          "esic_employer",
          "professional_tax",
          "net_payable",
          "status",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "payroll_run_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "payable_days": {
            "bsonType": "decimal"
          },
          "worked_minutes": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "target_minutes": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "shortfall_minutes": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "per_day_rate": {
            "bsonType": "decimal"
          },
          "basic_earned": {
            "bsonType": "decimal"
          },
          "hra_earned": {
            "bsonType": "decimal"
          },
          "special_earned": {
            "bsonType": "decimal"
          },
          "earned_gross": {
            "bsonType": "decimal"
          },
          "shortfall_amount": {
            "bsonType": "decimal"
          },
          "pf_employee": {
            "bsonType": "decimal"
          },
          "pf_employer": {
            "bsonType": "decimal"
          },
          "esic_employee": {
            "bsonType": "decimal"
          },
          "esic_employer": {
            "bsonType": "decimal"
          },
          "professional_tax": {
            "bsonType": "decimal"
          },
          "net_payable": {
            "bsonType": "decimal"
          },
          "status": {
            "enum": [
              "draft",
              "queued",
              "generated",
              "paid"
            ]
          },
          "pdf_url": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "payroll_run_id": 1
        },
        "options": {
          "name": "payslips_payroll_run_id"
        }
      },
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "payslips_employee_id"
        }
      },
      {
        "keys": {
          "payroll_run_id": 1,
          "employee_id": 1
        },
        "options": {
          "unique": true,
          "name": "payslips_payroll_run_id_employee_id_unique"
        }
      }
    ]
  },
  "payslip_adjustments": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "advance_recovery",
          "loss_damage",
          "last_month_balance",
          "reimbursement_bonus",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "advance_recovery": {
            "bsonType": "decimal"
          },
          "loss_damage": {
            "bsonType": "decimal"
          },
          "last_month_balance": {
            "bsonType": "decimal"
          },
          "reimbursement_bonus": {
            "bsonType": "decimal"
          },
          "remarks": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "updated_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "updated_at": {
            "bsonType": "date"
          },
          "other_deductions": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "bonus": {
            "bsonType": [
              "decimal",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "_id": 1
        },
        "options": {
          "name": "payslip_adjustments_id"
        }
      },
      {
        "keys": {
          "updated_by": 1
        },
        "options": {
          "name": "payslip_adjustments_updated_by"
        }
      }
    ]
  },
  "pt_slabs": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "state",
          "min_gross",
          "amount",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "state": {
            "enum": [
              "Andhra Pradesh",
              "Arunachal Pradesh",
              "Assam",
              "Bihar",
              "Chhattisgarh",
              "Goa",
              "Gujarat",
              "Haryana",
              "Himachal Pradesh",
              "Jharkhand",
              "Karnataka",
              "Kerala",
              "Madhya Pradesh",
              "Maharashtra",
              "Manipur",
              "Meghalaya",
              "Mizoram",
              "Nagaland",
              "Odisha",
              "Punjab",
              "Rajasthan",
              "Sikkim",
              "Tamil Nadu",
              "Telangana",
              "Tripura",
              "Uttar Pradesh",
              "Uttarakhand",
              "West Bengal",
              "Andaman and Nicobar Islands",
              "Chandigarh",
              "Dadra and Nagar Haveli and Daman and Diu",
              "Delhi",
              "Jammu and Kashmir",
              "Ladakh",
              "Lakshadweep",
              "Puducherry"
            ]
          },
          "gender": {
            "enum": [
              "Male",
              "Female",
              "Other",
              null
            ]
          },
          "min_gross": {
            "bsonType": "decimal"
          },
          "max_gross": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "amount": {
            "bsonType": "decimal"
          },
          "month": {
            "bsonType": [
              "int",
              "long",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": []
  },
  "notices": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "title",
          "channel",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "title": {
            "bsonType": "string"
          },
          "body": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "pdf_url": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "channel": {
            "enum": [
              "app",
              "whatsapp",
              "both"
            ]
          },
          "branch_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "published_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "branch_id": 1
        },
        "options": {
          "name": "notices_branch_id"
        }
      },
      {
        "keys": {
          "created_by": 1
        },
        "options": {
          "name": "notices_created_by"
        }
      }
    ]
  },
  "helpdesk_tickets": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "subject",
          "status",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "subject": {
            "bsonType": "string"
          },
          "body": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "category": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "status": {
            "enum": [
              "open",
              "in_progress",
              "resolved",
              "closed"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "resolved_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "resolution_note": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "helpdesk_tickets_employee_id"
        }
      }
    ]
  },
  "settings": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "key",
          "value",
          "updated_at"
        ],
        "properties": {
          "key": {
            "bsonType": "string"
          },
          "value": {},
          "label": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "description": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "branch_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "updated_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "branch_id": 1
        },
        "options": {
          "name": "settings_branch_id"
        }
      }
    ]
  },
  "activity_log": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "event_type",
          "message",
          "metadata",
          "occurred_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "actor_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "employee_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "event_type": {
            "bsonType": "string"
          },
          "message": {
            "bsonType": "string"
          },
          "metadata": {},
          "occurred_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "actor_id": 1
        },
        "options": {
          "name": "activity_log_actor_id"
        }
      },
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "activity_log_employee_id"
        }
      }
    ]
  },
  "policies": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "title",
          "body",
          "version",
          "published",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "title": {
            "bsonType": "string"
          },
          "category": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "body": {
            "bsonType": "string"
          },
          "version": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "effective_date": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "branch_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "published": {
            "bsonType": "bool"
          },
          "created_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "branch_id": 1
        },
        "options": {
          "name": "policies_branch_id"
        }
      },
      {
        "keys": {
          "created_by": 1
        },
        "options": {
          "name": "policies_created_by"
        }
      }
    ]
  },
  "policy_acknowledgements": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "policy_id",
          "employee_id",
          "acknowledged_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "policy_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "acknowledged_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "policy_id": 1
        },
        "options": {
          "name": "policy_acknowledgements_policy_id"
        }
      },
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "policy_acknowledgements_employee_id"
        }
      },
      {
        "keys": {
          "policy_id": 1,
          "employee_id": 1
        },
        "options": {
          "unique": true,
          "name": "policy_acknowledgements_policy_id_employee_id_unique"
        }
      }
    ]
  },
  "reimbursement_claims": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "claim_date",
          "description",
          "purpose",
          "amount",
          "status",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "claim_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "description": {
            "bsonType": "string"
          },
          "purpose": {
            "enum": [
              "travel",
              "material_purchase",
              "other"
            ]
          },
          "source_medium": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "kms": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "mode_of_payment": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "amount": {
            "bsonType": "decimal"
          },
          "remarks": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "status": {
            "enum": [
              "pending",
              "approved",
              "rejected",
              "paid",
              "finance_review"
            ]
          },
          "reviewed_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "reviewed_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "review_remark": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "receipt_path": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "paid_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "paid_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "payment_ref": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "finance_reviewed_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "finance_reviewed_at": {
            "bsonType": [
              "date",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "reimbursement_claims_employee_id"
        }
      },
      {
        "keys": {
          "reviewed_by": 1
        },
        "options": {
          "name": "reimbursement_claims_reviewed_by"
        }
      }
    ]
  },
  "comp_offs": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "earned_date",
          "status",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "earned_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "status": {
            "enum": [
              "available",
              "applied",
              "used",
              "expired"
            ]
          },
          "used_date": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "request_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "granted_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "expires_on": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "is_applicable": {
            "bsonType": [
              "bool",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "comp_offs_employee_id"
        }
      },
      {
        "keys": {
          "request_id": 1
        },
        "options": {
          "name": "comp_offs_request_id"
        }
      },
      {
        "keys": {
          "granted_by": 1
        },
        "options": {
          "name": "comp_offs_granted_by"
        }
      },
      {
        "keys": {
          "employee_id": 1,
          "earned_date": 1
        },
        "options": {
          "unique": true,
          "name": "comp_offs_employee_id_earned_date_unique"
        }
      }
    ]
  },
  "notifications": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "recipient_id",
          "kind",
          "title",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "recipient_id": {
            "bsonType": "string"
          },
          "kind": {
            "enum": [
              "notice",
              "policy",
              "request",
              "approval",
              "reimbursement",
              "comp_off",
              "ticket",
              "payroll",
              "system",
              "asset",
              "item",
              "warranty"
            ]
          },
          "title": {
            "bsonType": "string"
          },
          "body": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "link": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "read_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "recipient_id": 1
        },
        "options": {
          "name": "notifications_recipient_id"
        }
      }
    ]
  },
  "notice_reads": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "notice_id",
          "employee_id",
          "read_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "notice_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "read_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "notice_id": 1
        },
        "options": {
          "name": "notice_reads_notice_id"
        }
      },
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "notice_reads_employee_id"
        }
      },
      {
        "keys": {
          "notice_id": 1,
          "employee_id": 1
        },
        "options": {
          "unique": true,
          "name": "notice_reads_notice_id_employee_id_unique"
        }
      }
    ]
  },
  "helpdesk_ticket_comments": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "ticket_id",
          "author_is_staff",
          "body",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "ticket_id": {
            "bsonType": "string"
          },
          "author_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "author_name": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "author_is_staff": {
            "bsonType": "bool"
          },
          "body": {
            "bsonType": "string"
          },
          "created_at": {
            "bsonType": "date"
          },
          "author_role": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "ticket_id": 1
        },
        "options": {
          "name": "helpdesk_ticket_comments_ticket_id"
        }
      },
      {
        "keys": {
          "author_id": 1
        },
        "options": {
          "name": "helpdesk_ticket_comments_author_id"
        }
      }
    ]
  },
  "assets": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "desktop_name",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "desktop_name": {
            "bsonType": "string"
          },
          "brand": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "serial_no": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "model_no": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "warranty_upto": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "warranty_renew": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "product_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "device_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "processor": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "ram": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "graphics_card": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "storage": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "antivirus": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          },
          "assigned_employee_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "assigned_person_name": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "assigned_employee_code": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "assigned_date": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "assigned_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "asset_category": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": []
  },
  "items": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "item_name",
          "total_quantity",
          "returnable",
          "status",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "item_code": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "item_name": {
            "bsonType": "string"
          },
          "category": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "brand": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "size_spec": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "total_quantity": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "unit": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "returnable": {
            "bsonType": "bool"
          },
          "status": {
            "bsonType": "string"
          },
          "remarks": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          },
          "item_type": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": []
  },
  "item_assignments": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "item_id",
          "quantity",
          "assigned_date",
          "returned",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "item_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "person_name": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "employee_code": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "quantity": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "assigned_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "assigned_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "returned": {
            "bsonType": "bool"
          },
          "returned_date": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "remarks": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "item_id": 1
        },
        "options": {
          "name": "item_assignments_item_id"
        }
      },
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "item_assignments_employee_id"
        }
      }
    ]
  },
  "cron_run_log": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "job",
          "run_key",
          "ran_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "job": {
            "bsonType": "string"
          },
          "run_key": {
            "bsonType": "string"
          },
          "detail": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "ran_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "job": 1,
          "run_key": 1
        },
        "options": {
          "unique": true,
          "name": "cron_run_log_job_run_key_unique"
        }
      }
    ]
  },
  "asset_assignments": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "asset_id",
          "assigned_date",
          "returned",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "asset_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "person_name": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "employee_code": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "assigned_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "assigned_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "returned": {
            "bsonType": "bool"
          },
          "returned_date": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "remarks": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "asset_id": 1
        },
        "options": {
          "name": "asset_assignments_asset_id"
        }
      },
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "asset_assignments_employee_id"
        }
      }
    ]
  },
  "asset_maintenance": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "asset_id",
          "maint_date",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "asset_id": {
            "bsonType": "string"
          },
          "maint_date": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "maint_type": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "cost": {
            "bsonType": [
              "decimal",
              "null"
            ]
          },
          "vendor": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "notes": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "next_due": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "created_at": {
            "bsonType": "date"
          },
          "created_by": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "asset_id": 1
        },
        "options": {
          "name": "asset_maintenance_asset_id"
        }
      }
    ]
  },
  "reimbursement_events": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "claim_id",
          "action",
          "metadata",
          "occurred_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "claim_id": {
            "bsonType": "string"
          },
          "actor_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "actor_name": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "action": {
            "bsonType": "string"
          },
          "from_status": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "to_status": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "remark": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "metadata": {},
          "occurred_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "claim_id": 1
        },
        "options": {
          "name": "reimbursement_events_claim_id"
        }
      },
      {
        "keys": {
          "actor_id": 1
        },
        "options": {
          "name": "reimbursement_events_actor_id"
        }
      }
    ]
  },
  "leave_balance_adjustments": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "year",
          "type",
          "delta",
          "reason",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "year": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "type": {
            "enum": [
              "PL",
              "CL",
              "SL",
              "LWP"
            ]
          },
          "delta": {
            "bsonType": "decimal"
          },
          "reason": {
            "bsonType": "string"
          },
          "actor_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "leave_balance_adjustments_employee_id"
        }
      },
      {
        "keys": {
          "actor_id": 1
        },
        "options": {
          "name": "leave_balance_adjustments_actor_id"
        }
      }
    ]
  },
  "leave_encashment": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "year",
          "type",
          "days",
          "amount",
          "status",
          "requested_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "year": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "type": {
            "enum": [
              "PL",
              "CL",
              "SL",
              "LWP"
            ]
          },
          "days": {
            "bsonType": "decimal"
          },
          "amount": {
            "bsonType": "decimal"
          },
          "status": {
            "bsonType": "string"
          },
          "requested_at": {
            "bsonType": "date"
          },
          "approved_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "approved_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "remarks": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "leave_encashment_employee_id"
        }
      },
      {
        "keys": {
          "approved_by": 1
        },
        "options": {
          "name": "leave_encashment_approved_by"
        }
      }
    ]
  },
  "approval_steps": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "request_id",
          "step_no",
          "approver_role",
          "status",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "request_id": {
            "bsonType": "string"
          },
          "step_no": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "approver_role": {
            "enum": [
              "super_admin",
              "admin",
              "hr",
              "manager",
              "employee"
            ]
          },
          "status": {
            "enum": [
              "pending",
              "approved",
              "rejected",
              "cancelled"
            ]
          },
          "approver_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "decided_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "remark": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "request_id": 1
        },
        "options": {
          "name": "approval_steps_request_id"
        }
      },
      {
        "keys": {
          "approver_id": 1
        },
        "options": {
          "name": "approval_steps_approver_id"
        }
      },
      {
        "keys": {
          "request_id": 1,
          "step_no": 1
        },
        "options": {
          "unique": true,
          "name": "approval_steps_request_id_step_no_unique"
        }
      }
    ]
  },
  "employee_documents": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "storage_path",
          "uploaded_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "category": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "title": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "storage_path": {
            "bsonType": "string"
          },
          "uploaded_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "uploaded_at": {
            "bsonType": "date"
          },
          "verified_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "verified_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "verify_remark": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "bucket": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "employee_documents_employee_id"
        }
      },
      {
        "keys": {
          "uploaded_by": 1
        },
        "options": {
          "name": "employee_documents_uploaded_by"
        }
      },
      {
        "keys": {
          "verified_by": 1
        },
        "options": {
          "name": "employee_documents_verified_by"
        }
      }
    ]
  },
  "onboarding_templates": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "name",
          "active",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "name": {
            "bsonType": "string"
          },
          "active": {
            "bsonType": "bool"
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "name": 1
        },
        "options": {
          "unique": true,
          "name": "onboarding_templates_name_unique"
        }
      }
    ]
  },
  "onboarding_template_items": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "template_id",
          "seq",
          "title"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "template_id": {
            "bsonType": "string"
          },
          "seq": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "title": {
            "bsonType": "string"
          },
          "assignee_role": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "template_id": 1
        },
        "options": {
          "name": "onboarding_template_items_template_id"
        }
      },
      {
        "keys": {
          "template_id": 1,
          "title": 1
        },
        "options": {
          "unique": true,
          "name": "onboarding_template_items_template_id_title_unique"
        }
      }
    ]
  },
  "onboarding_tasks": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "title",
          "status",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "title": {
            "bsonType": "string"
          },
          "assignee_role": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "status": {
            "bsonType": "string"
          },
          "due_date": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "done_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "done_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "onboarding_tasks_employee_id"
        }
      },
      {
        "keys": {
          "done_by": 1
        },
        "options": {
          "name": "onboarding_tasks_done_by"
        }
      }
    ]
  },
  "acknowledgements": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "document_kind",
          "signed_name",
          "signed_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "document_kind": {
            "bsonType": "string"
          },
          "document_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "signed_name": {
            "bsonType": "string"
          },
          "signed_at": {
            "bsonType": "date"
          },
          "ip": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "user_agent": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "acknowledgements_employee_id"
        }
      }
    ]
  },
  "exit_cases": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "stage",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "stage": {
            "bsonType": "string"
          },
          "resignation_date": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "last_working_day": {
            "bsonType": [
              "string",
              "null"
            ],
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "reason": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          },
          "completed_at": {
            "bsonType": [
              "date",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "exit_cases_employee_id"
        }
      },
      {
        "keys": {
          "created_by": 1
        },
        "options": {
          "name": "exit_cases_created_by"
        }
      }
    ]
  },
  "exit_clearance_items": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "exit_case_id",
          "area",
          "cleared",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "exit_case_id": {
            "bsonType": "string"
          },
          "area": {
            "bsonType": "string"
          },
          "reference_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "description": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "cleared": {
            "bsonType": "bool"
          },
          "cleared_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "cleared_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "exit_case_id": 1
        },
        "options": {
          "name": "exit_clearance_items_exit_case_id"
        }
      },
      {
        "keys": {
          "cleared_by": 1
        },
        "options": {
          "name": "exit_clearance_items_cleared_by"
        }
      }
    ]
  },
  "exit_interviews": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "exit_case_id",
          "question",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "exit_case_id": {
            "bsonType": "string"
          },
          "question": {
            "bsonType": "string"
          },
          "answer": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "interviewer_id": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "submitted_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "exit_case_id": 1
        },
        "options": {
          "name": "exit_interviews_exit_case_id"
        }
      },
      {
        "keys": {
          "interviewer_id": 1
        },
        "options": {
          "name": "exit_interviews_interviewer_id"
        }
      }
    ]
  },
  "knowledge_transfer_items": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "exit_case_id",
          "task",
          "status",
          "created_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "exit_case_id": {
            "bsonType": "string"
          },
          "task": {
            "bsonType": "string"
          },
          "handover_to": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "status": {
            "bsonType": "string"
          },
          "notes": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "exit_case_id": 1
        },
        "options": {
          "name": "knowledge_transfer_items_exit_case_id"
        }
      },
      {
        "keys": {
          "handover_to": 1
        },
        "options": {
          "name": "knowledge_transfer_items_handover_to"
        }
      }
    ]
  },
  "full_and_final": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "exit_case_id",
          "salary_payable",
          "leave_encashment",
          "pending_reimbursements",
          "asset_recovery",
          "other_deductions",
          "net_payable",
          "status",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "exit_case_id": {
            "bsonType": "string"
          },
          "salary_payable": {
            "bsonType": "decimal"
          },
          "leave_encashment": {
            "bsonType": "decimal"
          },
          "pending_reimbursements": {
            "bsonType": "decimal"
          },
          "asset_recovery": {
            "bsonType": "decimal"
          },
          "other_deductions": {
            "bsonType": "decimal"
          },
          "net_payable": {
            "bsonType": "decimal"
          },
          "status": {
            "bsonType": "string"
          },
          "prepared_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "approved_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "approved_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "created_at": {
            "bsonType": "date"
          },
          "updated_at": {
            "bsonType": "date"
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "exit_case_id": 1
        },
        "options": {
          "unique": true,
          "name": "full_and_final_exit_case_id_unique"
        }
      },
      {
        "keys": {
          "exit_case_id": 1
        },
        "options": {
          "name": "full_and_final_exit_case_id"
        }
      },
      {
        "keys": {
          "prepared_by": 1
        },
        "options": {
          "name": "full_and_final_prepared_by"
        }
      },
      {
        "keys": {
          "approved_by": 1
        },
        "options": {
          "name": "full_and_final_approved_by"
        }
      }
    ]
  },
  "leave_salary_workings": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "_id",
          "employee_id",
          "year",
          "salary_before",
          "salary_after",
          "increment_effective",
          "total_amount",
          "status",
          "updated_at"
        ],
        "properties": {
          "_id": {
            "bsonType": "string"
          },
          "employee_id": {
            "bsonType": "string"
          },
          "year": {
            "bsonType": [
              "int",
              "long"
            ]
          },
          "salary_before": {
            "bsonType": "decimal"
          },
          "salary_after": {
            "bsonType": "decimal"
          },
          "increment_effective": {
            "bsonType": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "total_amount": {
            "bsonType": "decimal"
          },
          "status": {
            "bsonType": "string"
          },
          "remarks": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "paid_at": {
            "bsonType": [
              "date",
              "null"
            ]
          },
          "paid_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "updated_by": {
            "bsonType": [
              "string",
              "null"
            ]
          },
          "updated_at": {
            "bsonType": "date"
          },
          "if": {}
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "employee_id": 1
        },
        "options": {
          "name": "leave_salary_workings_employee_id"
        }
      },
      {
        "keys": {
          "paid_by": 1
        },
        "options": {
          "name": "leave_salary_workings_paid_by"
        }
      },
      {
        "keys": {
          "updated_by": 1
        },
        "options": {
          "name": "leave_salary_workings_updated_by"
        }
      },
      {
        "keys": {
          "employee_id": 1,
          "year": 1
        },
        "options": {
          "unique": true,
          "name": "leave_salary_workings_employee_id_year_unique"
        }
      }
    ]
  },
  "role_tab_access": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "role",
          "slug",
          "allowed",
          "updated_at"
        ],
        "properties": {
          "role": {
            "enum": [
              "super_admin",
              "admin",
              "hr",
              "manager",
              "employee"
            ]
          },
          "slug": {
            "bsonType": "string"
          },
          "allowed": {
            "bsonType": "bool"
          },
          "updated_at": {
            "bsonType": "date"
          },
          "updated_by": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "updated_by": 1
        },
        "options": {
          "name": "role_tab_access_updated_by"
        }
      }
    ]
  },
  "user_tab_access": {
    "validator": {
      "$jsonSchema": {
        "bsonType": "object",
        "required": [
          "user_id",
          "slug",
          "allowed",
          "updated_at"
        ],
        "properties": {
          "user_id": {
            "bsonType": "string"
          },
          "slug": {
            "bsonType": "string"
          },
          "allowed": {
            "bsonType": "bool"
          },
          "updated_at": {
            "bsonType": "date"
          },
          "updated_by": {
            "bsonType": [
              "string",
              "null"
            ]
          }
        }
      }
    },
    "indexes": [
      {
        "keys": {
          "user_id": 1
        },
        "options": {
          "name": "user_tab_access_user_id"
        }
      },
      {
        "keys": {
          "updated_by": 1
        },
        "options": {
          "name": "user_tab_access_updated_by"
        }
      }
    ]
  },
};
