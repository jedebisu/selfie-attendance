require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

const seedData = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Hash PINs before seeding
    const salt = await bcrypt.genSalt(10);
    const users = [
      { employee_id: 'EMP001', name: 'John Doe', email: 'john@example.com', pin: '123456', is_admin: true },
      { employee_id: 'EMP002', name: 'Jane Smith', email: 'jane@example.com', pin: '5678', is_admin: false },
      { employee_id: 'EMP003', name: 'Mike Johnson', email: 'mike@example.com', pin: '9012', is_admin: false },
    ];

    for (const user of users) {
      const hashedPin = await bcrypt.hash(user.pin, salt);
      await client.query(
        `INSERT INTO users (employee_id, name, email, pin, is_admin)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_id) DO UPDATE SET pin = EXCLUDED.pin, is_admin = EXCLUDED.is_admin, is_active = true`,
        [user.employee_id, user.name, user.email, hashedPin, user.is_admin]
      );
    }

    console.log('Test users seeded successfully!');
    console.log('\nTest credentials:');
    console.log('EMP001 / 123456 (Admin)');
    console.log('EMP002 / 5678');
    console.log('EMP003 / 9012');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

seedData()
  .then(() => {
    console.log('Seed completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
