const { pool } = require('./database');

async function fixCityNames() {
    const result = await pool.query(
        "UPDATE naps SET city_name = regexp_replace(city_name, '([a-z])([A-Z])', '\\1 \\2', 'g') WHERE city_name ~ '[a-z][A-Z]'"
    );
    console.log('Updated city names:', result.rowCount);

    const provResult = await pool.query(
        "UPDATE naps SET province_name = regexp_replace(province_name, '([a-z])([A-Z])', '\\1 \\2', 'g') WHERE province_name ~ '[a-z][A-Z]'"
    );
    console.log('Updated province names:', provResult.rowCount);

    const sample = await pool.query(
        "SELECT DISTINCT city_name, province_name FROM naps WHERE province_name = 'Cebu' LIMIT 15"
    );
    console.log('\nCebu cities:');
    sample.rows.forEach(r => console.log('  ' + r.city_name + ', ' + r.province_name));

    await pool.end();
}

fixCityNames().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
