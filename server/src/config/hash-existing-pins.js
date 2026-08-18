require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

const hashExistingPins = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Get all users with plaintext PINs
    const result = await client.query('SELECT id, employee_id, pin FROM users');
    
    const salt = await bcrypt.genSalt(10);
    
    for (const user of result.rows) {
      // Check if PIN is already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
      if (!user.pin.startsWith('$2')) {
        const hashedPin = await bcrypt.hash(user.pin, salt);
        await client.query('UPDATE users SET pin = $1 WHERE id = $2', [hashedPin, user.id]);
        console.log(`Hashed PIN for ${user.employee_id}`);
      } else {
        console.log(`PIN for ${user.employee_id} already hashed, skipping`);
      }
    }

    await client.query('COMMIT');
    console.log('\nAll PINs have been hashed!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

hashExistingPins()
  .then(() => {
    console.log('Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
