require('dotenv').config();
const { pool } = require('../src/config/database');
const nc = require('../src/routes/napcheck');
(async () => {
  const sql = `
    SELECT
      CASE
        WHEN UPPER(COALESCE(province_name,'')) LIKE '%CEBU%' OR UPPER(COALESCE(cfs_region,'')) LIKE '%CEBU%' THEN 'CEBU'
        WHEN UPPER(COALESCE(province_name,'')) LIKE '%BOHOL%' OR UPPER(COALESCE(cfs_region,'')) LIKE '%BOHOL%' THEN 'BOHOL'
        WHEN UPPER(COALESCE(province_name,'')) LIKE '%NEGROS%ORIENTAL%' OR UPPER(COALESCE(cfs_region,'')) LIKE '%NEGROS%ORIENTAL%' THEN 'NEGROS ORIENTAL'
        ELSE 'OTHER'
      END AS grp,
      COUNT(*)::int c
    FROM naps
    WHERE ${nc.VISAYAS_WHERE}
    GROUP BY grp ORDER BY c DESC
  `;
  const r = await pool.query(sql);
  r.rows.forEach(x => console.log(x.grp, x.c));
  const total = r.rows.reduce((a,b)=>a+b.c,0);
  console.log('total visayas (via VISAYAS_WHERE):', total);
  console.log('kept:', r.rows.filter(x=>x.grp!=='OTHER').reduce((a,b)=>a+b.c,0));
  await pool.end();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
