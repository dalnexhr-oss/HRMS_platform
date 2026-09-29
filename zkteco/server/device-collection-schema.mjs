// Internal ZKTeco collections, also included by the application's database setup.
const TEXT = { bsonType: ['string', 'null'] };

const DEVICE_COLLECTIONS = {
  attendance_devices: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'serial_number', 'enabled', 'created_at', 'updated_at'],
        properties: {
          _id: { bsonType: 'string' },
          serial_number: { bsonType: 'string' },
          enabled: { bsonType: 'bool' },
          ignored_employee_ids: {
            bsonType: 'array',
            uniqueItems: true,
            items: { bsonType: 'string' },
          },
          branch_id: TEXT,
          latitude: { bsonType: ['double', 'int', 'null'], minimum: -90, maximum: 90 },
          longitude: { bsonType: ['double', 'int', 'null'], minimum: -180, maximum: 180 },
          created_at: { bsonType: 'date' },
          updated_at: { bsonType: 'date' },
        },
      },
    },
    indexes: [
      { keys: { serial_number: 1 }, options: { unique: true, name: 'attendance_device_serial' } },
    ],
  },
  device_employee_links: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: [
          '_id',
          'device_id',
          'serial_number',
          'device_uid',
          'employee_id',
          'user_ids',
          'enabled',
          'created_at',
          'updated_at',
        ],
        properties: {
          _id: { bsonType: 'string' },
          device_id: { bsonType: 'string' },
          serial_number: { bsonType: 'string' },
          device_uid: { bsonType: 'string' },
          employee_id: { bsonType: 'string' },
          enabled: { bsonType: 'bool' },
          user_ids: {
            bsonType: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { bsonType: 'string' },
          },
          created_at: { bsonType: 'date' },
          updated_at: { bsonType: 'date' },
        },
      },
    },
    indexes: [
      { keys: { device_id: 1, device_uid: 1 }, options: { unique: true, name: 'device_link_uid' } },
      {
        keys: { device_id: 1, employee_id: 1 },
        options: { unique: true, name: 'device_link_employee' },
      },
      {
        keys: { device_id: 1, serial_number: 1, user_ids: 1 },
        options: { name: 'device_link_user_ids' },
      },
    ],
  },
  // Device receipts are retained permanently so a replay never recreates attendance.
  // Only the authenticated device endpoint accesses this internal collection.
  device_punch_receipts: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'device_id', 'employee_id', 'raw', 'status', 'received_at'],
        properties: {
          _id: { bsonType: 'string' },
          device_id: { bsonType: 'string' },
          employee_id: { bsonType: 'string' },
          user_id: TEXT,
          work_date: { bsonType: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
          raw: {
            bsonType: 'object',
            required: ['deviceId', 'uid', 'userId', 'timestamp', 'punch', 'status'],
            properties: {
              deviceId: { bsonType: 'string' },
              uid: { bsonType: 'string' },
              userId: { bsonType: 'string' },
              timestamp: { bsonType: 'string' },
              punch: { bsonType: ['int', 'long', 'double'] },
              status: { bsonType: ['int', 'long', 'double'] },
            },
          },
          status: { enum: ['recorded', 'ignored', 'needs_review'] },
          reason: TEXT,
          kind: { enum: ['in', 'out', null] },
          received_at: { bsonType: 'date' },
        },
      },
    },
    indexes: [
      {
        keys: { device_id: 1, status: 1, received_at: -1 },
        options: { name: 'device_receipts_review' },
      },
      { keys: { employee_id: 1, received_at: -1 }, options: { name: 'device_receipts_employee' } },
    ],
  },
};

export { DEVICE_COLLECTIONS };
