require('dotenv').config();
const { sequelize } = require('../models');

async function checkColumns() {
  try {
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'orders'
    `);
    console.log('Existing columns:', results.map(c => c.column_name).join(', '));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await sequelize.close();
  }
}

checkColumns();
