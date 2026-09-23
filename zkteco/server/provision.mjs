// Only the integration collections are changed by employee linking.
import { DEVICE_COLLECTIONS } from './schema.mjs';

export async function provisionDeviceCollections(database) {
  // Provision only the integration's three internal collections, never unrelated application schemas.
  const schema = DEVICE_COLLECTIONS;
  for (const name of ['attendance_devices', 'device_employee_links', 'device_punch_receipts']) {
    const definition = schema[name];
    const exists = await database.listCollections({ name }, { nameOnly: true }).hasNext();
    if (!exists) {
      await database.createCollection(name, { validator: definition.validator });
    } else {
      await database.command({ collMod: name, validator: definition.validator });
    }
    for (const index of definition.indexes) {
      await database.collection(name).createIndex(index.keys, index.options);
    }
  }
}
