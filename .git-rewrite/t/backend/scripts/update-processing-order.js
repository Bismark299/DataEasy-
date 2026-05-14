require('dotenv').config();
const { Order } = require('../models');

async function updateOrder() {
  try {
    // Find the Processing order
    const order = await Order.findOne({
      where: { deliveryStatus: 'Processing' }
    });
    
    if (!order) {
      console.log('No Processing orders found');
      return;
    }
    
    console.log('Found order:', order.orderId);
    console.log('Current status:', order.deliveryStatus);
    
    // Update to Delivered
    await order.update({
      deliveryStatus: 'Delivered',
      deliveryError: null
    });
    
    console.log('✅ Updated to Delivered');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    const { sequelize } = require('../models');
    await sequelize.close();
  }
}

updateOrder();
