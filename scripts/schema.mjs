// ============================================================================
// The schema applied to MongoDB: base definitions + overrides, composed by
// buildSchema() and applied by db-setup.mjs.
//
// The bulk of it lives in scripts/schema.generated.mjs; this file layers
// OVERRIDES over that. The split is historical — the base file was once
// generated from the Postgres DDL and this one held everything the translation
// could not express — but both are hand-maintained now, so the division is a
// convention rather than a constraint. Keep it: a small, reasoned override list
// is easier to review than the same edits scattered through 2,000 lines of
// validators.
//
// Three kinds of thing belong here:
//   1. Cross-field constraints. $jsonSchema compares a field to a literal,
//      never to another field, so these are expressed as $expr clauses.
//   2. Format checks (PAN, Aadhaar, IFSC).
//   3. Fields and indexes that exist only in the MongoDB model: denormalised
//      names, and indexes for queries that used to be served by a view.
// ============================================================================
import { GENERATED } from './schema.generated.mjs';

const TEXT = { bsonType: ['string', 'null'] };

/**
 * Per-collection adjustments.
 *   drop            - do not create this collection at all
 *   properties      - merged over the generated properties
 *   required        - replaces the generated required list
 *   expr            - an $expr clause ANDed with $jsonSchema
 *   indexes         - appended to the generated indexes
 *   replaceIndexes  - replaces the generated indexes entirely
 */
const OVERRIDES = {
  // user_tab_access is a per-user map, and a per-user map belongs on the user.
  // It is embedded as users.tab_access, so the collection does not exist.
  // role_tab_access is per ROLE, not per user, so it stays a collection.
  user_tab_access: { drop: true },

  branches: {
    // The generator cannot know a name comparison should ignore case. Without
    // the collation, "Pune" and "pune" are two branches — and the employee
    // drawer creates branches inline by name, so that happens by accident.
    replaceIndexes: [
      {
        keys: { name: 1 },
        options: { unique: true, name: 'branches_name_unique', collation: { locale: 'en', strength: 2 } },
      },
    ],
  },

  departments: {
    replaceIndexes: [
      {
        keys: { name: 1, branch_id: 1 },
        options: {
          unique: true,
          name: 'departments_name_branch_id_unique',
          collation: { locale: 'en', strength: 2 },
        },
      },
      { keys: { branch_id: 1 }, options: { name: 'departments_branch_id' } },
    ],
  },

  employees: {
    properties: {
      // Denormalised so list screens do not join — see EmployeeDoc.
      branch_name: TEXT,
      department_name: TEXT,
      // Format CHECK constraints the generator cannot see (0001, 0022, 0023).
      pan: { bsonType: ['string', 'null'], pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' },
      aadhaar: { bsonType: ['string', 'null'], pattern: '^[0-9]{12}$' },
      bank_ifsc: { bsonType: ['string', 'null'], pattern: '^[A-Z]{4}0[A-Z0-9]{6}$' },
    },
    // `constraint salary_components_sum` — gross must equal its parts. The one
    // constraint on this table that money correctness actually depends on.
    expr: {
      $eq: ['$gross_monthly', { $add: ['$basic_da', '$hra', '$special_allowance'] }],
    },
  },

  attendance_days: {
    // The register reads a month for one employee, and the board reads a day
    // across everyone. The unique index serves the first; this serves the second.
    indexes: [{ keys: { work_date: 1, status: 1 }, options: { name: 'attendance_days_date_status' } }],
  },

  punch_events: {
    // Punch history is always "this employee, newest first".
    indexes: [{ keys: { employee_id: 1, punched_at: -1 }, options: { name: 'punch_events_employee_time' } }],
  },

  notifications: {
    // The bell: unread for me, newest first.
    indexes: [
      { keys: { recipient_id: 1, created_at: -1 }, options: { name: 'notifications_recipient_time' } },
      {
        keys: { recipient_id: 1, read_at: 1 },
        options: { name: 'notifications_unread', partialFilterExpression: { read_at: null } },
      },
    ],
  },

  // cron_run_log needs no override: the SQL already declared
  // `unique (job, run_key)`, so the generator emits it. That unique index IS
  // the idempotency guarantee — a job that already ran for a key does nothing.

  settings: {
    indexes: [{ keys: { key: 1 }, options: { unique: true, name: 'settings_key_unique' } }],
  },

  activity_log: {
    // The audit screen showed actor and employee names through an embedded
    // select — a two-way join on every row of a 200-row feed. Names are copied
    // in at write time instead; an audit entry is a historical record, so the
    // name as it was then is arguably more correct than the name now.
    properties: { actor_name: TEXT, employee_code: TEXT, employee_name: TEXT },
    indexes: [
      { keys: { occurred_at: -1 }, options: { name: 'activity_log_time' } },
      { keys: { event_type: 1, occurred_at: -1 }, options: { name: 'activity_log_type_time' } },
    ],
  },

  // Both showed a branch name through an embedded select. Denormalised for the
  // same reason as employees.branch_name, and refreshed by updateBranch().
  holidays: {
    properties: { branch_name: TEXT },
    indexes: [{ keys: { holiday_date: 1 }, options: { name: 'holidays_date' } }],
  },

  notices: {
    properties: { branch_name: TEXT },
    indexes: [{ keys: { created_at: -1 }, options: { name: 'notices_created' } }],
  },

  helpdesk_ticket_comments: {
    // The chat window pages one ticket in order; the change stream tails it.
    indexes: [{ keys: { ticket_id: 1, created_at: 1 }, options: { name: 'helpdesk_comments_ticket_time' } }],
  },

};

// --- collections with no SQL ancestor ---------------------------------------

const APP_ROLES = ['super_admin', 'admin', 'hr', 'manager', 'employee'];

const EXTRA_COLLECTIONS = {
  // auth.users (GoTrue) + public.profiles + public.user_tab_access, merged.
  users: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'email', 'password_hash', 'role', 'disabled', 'token_version', 'created_at'],
        properties: {
          _id: { bsonType: 'string' },
          // Deliberately loose. Strict email regexes reject valid addresses;
          // deliverability is proven by the verification mail, not a pattern.
          email: { bsonType: 'string', pattern: '^[^@ ]+@[^@ ]+[.][^@ ]+$' },
          password_hash: { bsonType: 'string' },
          full_name: TEXT,
          role: { enum: APP_ROLES },
          branch_id: TEXT,
          avatar: TEXT,
          employee_id: TEXT,
          disabled: { bsonType: 'bool' },
          token_version: { bsonType: ['int', 'long'], minimum: 0 },
          tab_access: { bsonType: 'object' },
          email_verified_at: { bsonType: ['date', 'null'] },
          last_sign_in_at: { bsonType: ['date', 'null'] },
          created_at: { bsonType: 'date' },
          updated_at: { bsonType: 'date' },
        },
      },
    },
    indexes: [
      {
        keys: { email: 1 },
        options: { unique: true, name: 'users_email_unique', collation: { locale: 'en', strength: 2 } },
      },
      {
        keys: { employee_id: 1 },
        options: {
          unique: true,
          name: 'users_employee_unique',
          partialFilterExpression: { employee_id: { $type: 'string' } },
        },
      },
      { keys: { role: 1 }, options: { name: 'users_role' } },
    ],
  },

  // Replaces GoTrue's recovery link. Only a hash is stored; expiry is a TTL index.
  password_reset_tokens: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'user_id', 'token_hash', 'expires_at', 'created_at'],
        properties: {
          _id: { bsonType: 'string' },
          user_id: { bsonType: 'string' },
          token_hash: { bsonType: 'string' },
          expires_at: { bsonType: 'date' },
          created_at: { bsonType: 'date' },
          requested_ip: TEXT,
        },
      },
    },
    indexes: [
      // mongod deletes the document itself once expires_at passes.
      { keys: { expires_at: 1 }, options: { name: 'reset_tokens_ttl', expireAfterSeconds: 0 } },
      { keys: { token_hash: 1 }, options: { unique: true, name: 'reset_tokens_hash_unique' } },
      { keys: { user_id: 1 }, options: { name: 'reset_tokens_user' } },
    ],
  },
};

/** The final schema: generated, overridden, plus the collections SQL never had. */
export function buildSchema() {
  const schema = {};

  for (const [name, gen] of Object.entries(GENERATED)) {
    const o = OVERRIDES[name] ?? {};
    if (o.drop) continue;

    const jsonSchema = {
      ...gen.validator.$jsonSchema,
      required: o.required ?? gen.validator.$jsonSchema.required,
      properties: { ...gen.validator.$jsonSchema.properties, ...(o.properties ?? {}) },
    };

    schema[name] = {
      // $expr sits beside $jsonSchema under $and, because a validator may hold
      // only one top-level query and the two express different kinds of rule.
      validator: o.expr ? { $and: [{ $jsonSchema: jsonSchema }, { $expr: o.expr }] } : { $jsonSchema: jsonSchema },
      indexes: [...(o.replaceIndexes ?? gen.indexes), ...(o.indexes ?? [])],
    };
  }

  for (const [name, def] of Object.entries(EXTRA_COLLECTIONS)) schema[name] = def;
  return schema;
}
