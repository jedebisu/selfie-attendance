require('dotenv').config();
const { pool } = require('./database');

const seedData = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Insert test users
    const users = [
      { employee_id: 'EMP001', name: 'John Doe', email: 'john@example.com', pin: '1234' },
      { employee_id: 'EMP002', name: 'Jane Smith', email: 'jane@example.com', pin: '5678' },
      { employee_id: 'EMP003', name: 'Mike Johnson', email: 'mike@example.com', pin: '9012' },
    ];

    for (const user of users) {
      await client.query(
        `INSERT INTO users (employee_id, name, email, pin)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id) DO NOTHING`,
        [user.employee_id, user.name, user.email, user.pin]
      );
    }

    console.log('Test users created successfully!');
    console.log('\nTest credentials:');
    console.log('EMP001 / 1234');
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
