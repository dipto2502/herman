// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/herman_perfume';
mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  console.log('⚠️  Server will run without database. Products will use sample data.');
  console.log('💡 To fix: Set up MongoDB Atlas or install MongoDB locally');
});

// Debug endpoint to test order structure
app.post('/api/debug-order', (req, res) => {
  console.log('🔍 Debug order data received:');
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  // Validate the structure
  const issues = [];
  const data = req.body;
  
  if (!data.customer) issues.push('Missing customer object');
  else {
    if (!data.customer.firstName) issues.push('Missing customer.firstName');
    if (!data.customer.lastName) issues.push('Missing customer.lastName');
    if (!data.customer.phone) issues.push('Missing customer.phone');
  }
  
  if (!data.delivery) issues.push('Missing delivery object');
  else {
    if (!data.delivery.address) issues.push('Missing delivery.address');
    if (!data.delivery.city) issues.push('Missing delivery.city');
  }
  
  if (!data.payment) issues.push('Missing payment object');
  else {
    if (!data.payment.method) issues.push('Missing payment.method');
  }
  
  if (!data.items || !Array.isArray(data.items)) issues.push('Missing or invalid items array');
  else if (data.items.length === 0) issues.push('Items array is empty');
  
  if (!data.totals) issues.push('Missing totals object');
  else {
    if (typeof data.totals.total !== 'number') issues.push('totals.total is not a number');
  }
  
  res.json({
    received: true,
    dataStructure: Object.keys(data),
    issues: issues,
    valid: issues.length === 0
  });
});

// Product Schema
const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: String,
    required: true,
    enum: ['floral', 'woody', 'oriental', 'fresh'],
    lowercase: true
  },
  notes: [{
    type: String,
    trim: true
  }],
  image: {
    type: String,
    default: ''
  },
  badge: {
    type: String,
    enum: ['', 'New', 'Bestseller', 'Limited', 'Popular'],
    default: ''
  },
  inStock: {
    type: Boolean,
    default: true
  },
  quantity: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ORDER ROUTES

// Create new order
app.post('/api/orders', async (req, res) => {
  try {
    const orderData = req.body;
    
    // Validate required fields
    if (!orderData.customer || !orderData.delivery || !orderData.payment || !orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ error: 'Missing required order information' });
    }

    // Validate customer data
    if (!orderData.customer.firstName || !orderData.customer.lastName || !orderData.customer.phone) {
      return res.status(400).json({ error: 'Customer name and phone are required' });
    }

    // Validate delivery data
    if (!orderData.delivery.address || !orderData.delivery.city) {
      return res.status(400).json({ error: 'Delivery address and city are required' });
    }

    // Validate payment data
    if (!orderData.payment.method || !['bkash', 'cod'].includes(orderData.payment.method)) {
      return res.status(400).json({ error: 'Valid payment method is required (bkash or cod)' });
    }

    // If bkash payment, transaction ID is required
    if (orderData.payment.method === 'bkash' && !orderData.payment.transactionId) {
      return res.status(400).json({ error: 'Transaction ID is required for bKash payment' });
    }

    // Validate items
    if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item' });
    }

    // Validate each item
    for (let item of orderData.items) {
      if (!item.productId || !item.name || !item.price || !item.quantity) {
        return res.status(400).json({ error: 'Each item must have productId, name, price, and quantity' });
      }
      if (typeof item.price !== 'number' || item.price <= 0) {
        return res.status(400).json({ error: 'Item price must be a positive number' });
      }
      if (typeof item.quantity !== 'number' || item.quantity <= 0) {
        return res.status(400).json({ error: 'Item quantity must be a positive number' });
      }
    }

    // Validate totals
    if (!orderData.totals || typeof orderData.totals.total !== 'number' || orderData.totals.total <= 0) {
      return res.status(400).json({ error: 'Valid order total is required' });
    }

    // Prepare clean order data with all required fields
    const cleanOrderData = {
      customer: {
        firstName: orderData.customer.firstName.trim(),
        lastName: orderData.customer.lastName.trim(),
        phone: orderData.customer.phone.trim(),
        email: orderData.customer.email ? orderData.customer.email.trim() : undefined
      },
      delivery: {
        address: orderData.delivery.address.trim(),
        city: orderData.delivery.city.trim(),
        postalCode: orderData.delivery.postalCode ? orderData.delivery.postalCode.trim() : undefined
      },
      payment: {
        method: orderData.payment.method,
        transactionId: orderData.payment.transactionId ? orderData.payment.transactionId.trim() : undefined,
        status: 'pending'
      },
      items: orderData.items.map(item => ({
        productId: item.productId || item.id,
        name: item.name.trim(),
        price: Number(item.price),
        quantity: Number(item.quantity),
        category: item.category || 'other'
      })),
      totals: {
        subtotal: Number(orderData.totals.subtotal) || 0,
        deliveryCharge: Number(orderData.totals.deliveryCharge) || 0,
        total: Number(orderData.totals.total)
      },
      status: 'pending',
      orderNotes: orderData.orderNotes ? orderData.orderNotes.trim() : '',
      adminNotes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Remove undefined email if not provided
    if (!cleanOrderData.customer.email) {
      delete cleanOrderData.customer.email;
    }

    // Remove undefined postal code if not provided
    if (!cleanOrderData.delivery.postalCode) {
      delete cleanOrderData.delivery.postalCode;
    }

    // Remove undefined transaction ID if not provided
    if (!cleanOrderData.payment.transactionId) {
      delete cleanOrderData.payment.transactionId;
    }

    console.log('📋 Creating order with data:', JSON.stringify(cleanOrderData, null, 2));

    // Create new order
    const order = new Order(cleanOrderData);
    const savedOrder = await order.save();
    
    console.log('✅ New order created:', savedOrder.orderNumber);
    
    // Send confirmation notifications
    try {
      const notificationResults = await sendOrderConfirmation(savedOrder);
      console.log('📧 Notification results:', notificationResults);
    } catch (notificationError) {
      console.error('⚠️ Notification error:', notificationError);
      // Don't fail the order if notifications fail
    }
    
    // Send confirmation response
    res.status(201).json({
      success: true,
      message: 'Order placed successfully! You will receive confirmation via email/SMS.',
      orderNumber: savedOrder.orderNumber,
      order: savedOrder
    });

  } catch (error) {
    console.error('❌ Error creating order:', error);
    
    // Handle validation errors specifically
    if (error.name === 'ValidationError') {
      const validationErrors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
      
      return res.status(400).json({ 
        error: 'Order validation failed',
        details: validationErrors
      });
    }
    
    res.status(500).json({ error: 'Failed to place order: ' + error.message });
  }
});

// Get all orders (admin)
app.get('/api/orders', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    let filter = {};
    
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const totalOrders = await Order.countDocuments(filter);
    
    res.json({
      orders,
      totalPages: Math.ceil(totalOrders / limit),
      currentPage: page,
      totalOrders
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get single order
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Test email endpoint (for testing email configuration)
app.post('/api/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    await transporter.sendMail({
      from: `"Herman Perfume" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Test Email - Herman Perfume',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #4a2c5a 0%, #d4af37 100%); color: white; text-align: center; padding: 20px;">
            <h2>Herman Perfume</h2>
            <h3>Email Test Successful! ✅</h3>
          </div>
          <div style="padding: 20px; background: #fff; border: 1px solid #ddd;">
            <p>Congratulations! Your email configuration is working correctly.</p>
            <p>You can now send order confirmations and status updates to your customers.</p>
            <p><strong>Test Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `
    });

    res.json({ success: true, message: 'Test email sent successfully!' });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ error: 'Failed to send test email: ' + error.message });
  }
});

// Manual send confirmation (for existing orders)
app.post('/api/orders/:id/send-confirmation', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const notificationResults = await sendOrderConfirmation(order);
    
    res.json({
      success: true,
      message: 'Confirmation sent!',
      results: notificationResults
    });
  } catch (error) {
    console.error('Error sending confirmation:', error);
    res.status(500).json({ error: 'Failed to send confirmation' });
  }
});

// Update order status
app.put('/api/orders/:id', async (req, res) => {
  try {
    const { status, adminNotes, paymentStatus } = req.body;
    
    // Get the current order to check for status changes
    const currentOrder = await Order.findById(req.params.id);
    if (!currentOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updateData = { updatedAt: Date.now() };
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
    if (paymentStatus) updateData['payment.status'] = paymentStatus;
    
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
    console.log('✅ Order updated:', order.orderNumber);
    
    // Send status update notification if status changed
    if (status && status !== currentOrder.status) {
      try {
        const notificationResults = await sendStatusUpdateNotification(order, status);
        console.log('📧 Status update notifications:', notificationResults);
      } catch (notificationError) {
        console.error('⚠️ Status update notification error:', notificationError);
        // Don't fail the update if notifications fail
      }
    }
    
    res.json(order);
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(400).json({ error: error.message || 'Failed to update order' });
  }
});

// Get order by order number
app.get('/api/orders/number/:orderNumber', async (req, res) => {
  try {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Update the updatedAt field before saving
const Product = mongoose.model('Product', productSchema);

// Order Schema
const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: false, // Will be generated automatically
    unique: true,
    sparse: true // Allows multiple documents without this field during creation
  },
  customer: {
    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true },
    phone: { type: String, required: [true, 'Phone number is required'], trim: true },
    email: { type: String, required: false, trim: true }
  },
  delivery: {
    address: { type: String, required: [true, 'Address is required'], trim: true },
    city: { type: String, required: [true, 'City is required'], trim: true },
    postalCode: { type: String, required: false, trim: true }
  },
  payment: {
    method: { 
      type: String, 
      enum: {
        values: ['bkash', 'cod'],
        message: 'Payment method must be either bkash or cod'
      }, 
      required: [true, 'Payment method is required']
    },
    transactionId: { type: String, required: false, trim: true },
    status: { 
      type: String, 
      enum: ['pending', 'paid', 'failed'], 
      default: 'pending' 
    }
  },
  items: [{
    productId: { type: String, required: [true, 'Product ID is required'] },
    name: { type: String, required: [true, 'Product name is required'], trim: true },
    price: { 
      type: Number, 
      required: [true, 'Product price is required'],
      min: [0, 'Price cannot be negative']
    },
    quantity: { 
      type: Number, 
      required: [true, 'Product quantity is required'],
      min: [1, 'Quantity must be at least 1']
    },
    category: { type: String, required: false, default: 'other' }
  }],
  totals: {
    subtotal: { 
      type: Number, 
      required: [true, 'Subtotal is required'],
      min: [0, 'Subtotal cannot be negative']
    },
    deliveryCharge: { 
      type: Number, 
      required: [true, 'Delivery charge is required'],
      min: [0, 'Delivery charge cannot be negative']
    },
    total: { 
      type: Number, 
      required: [true, 'Total is required'],
      min: [0, 'Total cannot be negative']
    }
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  orderNotes: { type: String, required: false, default: '' },
  adminNotes: { type: String, required: false, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Generate order number
orderSchema.pre('save', function(next) {
  if (!this.orderNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.orderNumber = `HM${year}${month}${day}${random}`;
  }
  this.updatedAt = Date.now();
  next();
});

const Order = mongoose.model('Order', orderSchema);

// Email configuration
const transporter = nodemailer.createTransport({
  service: 'gmail', // or 'smtp.gmail.com'
  auth: {
    user: process.env.EMAIL_USER, // your gmail
    pass: process.env.EMAIL_PASS  // your gmail app password
  }
});

// Alternative: Using other email services
// For Outlook/Hotmail:
// const transporter = nodemailer.createTransport({
//   service: 'hotmail',
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS
//   }
// });

// SMS configuration (using ssl commerz SMS or other BD SMS providers)
async function sendSMS(phone, message) {
  try {
    // Example using SSL Wireless SMS API (popular in Bangladesh)
    const smsData = {
      user: process.env.SMS_USER,
      pass: process.env.SMS_PASS,
      msisdn: phone,
      sid: "HermanPerfume",
      msg: message,
      csms_id: Date.now().toString()
    };

    // Uncomment and configure based on your SMS provider
    // const response = await fetch('https://sms.sslwireless.com/pushapi/dynamic/server.php', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //   body: new URLSearchParams(smsData)
    // });

    console.log(`📱 SMS would be sent to ${phone}: ${message}`);
    return { success: true };
  } catch (error) {
    console.error('SMS Error:', error);
    return { success: false, error: error.message };
  }
}

// Email templates
function getOrderConfirmationEmail(order) {
  return {
    subject: `Order Confirmation - ${order.orderNumber} | Herman Perfume`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #4a2c5a 0%, #d4af37 100%); color: white; text-align: center; padding: 30px; border-radius: 10px 10px 0 0; }
          .content { background: #fff; padding: 30px; border: 1px solid #ddd; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
          .order-details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .items-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .items-table th, .items-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
          .items-table th { background: #f8f9fa; font-weight: bold; }
          .total-row { font-size: 18px; font-weight: bold; color: #d4af37; }
          .status-badge { background: #28a745; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; }
          .logo { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">Herman Perfume</div>
            <h2>Order Confirmation</h2>
            <p>Thank you for your order!</p>
          </div>
          
          <div class="content">
            <h3>Hello ${order.customer.firstName},</h3>
            <p>We've received your order and are preparing it for delivery. Here are your order details:</p>
            
            <div class="order-details">
              <h4>Order Information</h4>
              <p><strong>Order Number:</strong> ${order.orderNumber}</p>
              <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString('en-BD', { 
                year: 'numeric', month: 'long', day: 'numeric' 
              })}</p>
              <p><strong>Status:</strong> <span class="status-badge">${order.status.toUpperCase()}</span></p>
            </div>

            <div class="order-details">
              <h4>Delivery Information</h4>
              <p><strong>Name:</strong> ${order.customer.firstName} ${order.customer.lastName}</p>
              <p><strong>Phone:</strong> ${order.customer.phone}</p>
              <p><strong>Address:</strong> ${order.delivery.address}, ${order.delivery.city}</p>
            </div>

            <h4>Order Items</h4>
            <table class="items-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${order.items.map(item => `
                  <tr>
                    <td>${item.name}</td>
                    <td>${item.quantity}</td>
                    <td>৳${item.price}</td>
                    <td>৳${item.price * item.quantity}</td>
                  </tr>
                `).join('')}
                <tr>
                  <td colspan="3"><strong>Subtotal:</strong></td>
                  <td><strong>৳${order.totals.subtotal}</strong></td>
                </tr>
                <tr>
                  <td colspan="3"><strong>Delivery Charge:</strong></td>
                  <td><strong>৳${order.totals.deliveryCharge}</strong></td>
                </tr>
                <tr class="total-row">
                  <td colspan="3"><strong>Total Amount:</strong></td>
                  <td><strong>৳${order.totals.total}</strong></td>
                </tr>
              </tbody>
            </table>

            <div class="order-details">
              <h4>Payment Information</h4>
              <p><strong>Method:</strong> ${order.payment.method === 'bkash' ? 'bKash' : 'Cash on Delivery'}</p>
              ${order.payment.transactionId ? `<p><strong>Transaction ID:</strong> ${order.payment.transactionId}</p>` : ''}
              ${order.payment.method === 'cod' ? '<p><em>You can pay when you receive your order.</em></p>' : ''}
            </div>

            <h4>What's Next?</h4>
            <ul>
              <li>We'll call you within 24 hours to confirm your order</li>
              <li>Your order will be prepared and packaged</li>
              <li>We'll notify you when your order is shipped</li>
              <li>Delivery typically takes 2-3 business days</li>
            </ul>

            ${order.orderNotes ? `
              <div class="order-details">
                <h4>Your Notes</h4>
                <p><em>"${order.orderNotes}"</em></p>
              </div>
            ` : ''}
          </div>
          
          <div class="footer">
            <p><strong>Questions?</strong> Contact us:</p>
            <p>📞 Phone: ${process.env.CONTACT_PHONE || '+88 01XXXXXXXXX'}</p>
            <p>📧 Email: ${process.env.CONTACT_EMAIL || 'support@hermanperfume.com'}</p>
            <p>🌐 Website: www.hermanperfume.com</p>
            <hr style="margin: 20px 0;">
            <p style="font-size: 12px; color: #666;">
              This is an automated email. Please do not reply to this email address.
            </p>
            <p style="font-size: 12px; color: #666;">
              © 2025 Herman Perfume. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  };
}

// SMS templates
function getOrderConfirmationSMS(order) {
  return `Herman Perfume: Your order ${order.orderNumber} has been confirmed! Total: ৳${order.totals.total}. We'll call you within 24hrs. Track: www.hermanperfume.com/track`;
}

function getOrderStatusSMS(order, newStatus) {
  const statusMessages = {
    confirmed: `Your order ${order.orderNumber} is confirmed and being prepared.`,
    processing: `Your order ${order.orderNumber} is being processed.`,
    shipped: `Great news! Your order ${order.orderNumber} has been shipped and is on the way.`,
    delivered: `Your order ${order.orderNumber} has been delivered. Thank you for shopping with Herman Perfume!`,
    cancelled: `Your order ${order.orderNumber} has been cancelled. If you have questions, please call us.`
  };

  return `Herman Perfume: ${statusMessages[newStatus] || 'Order status updated.'} Track: www.hermanperfume.com/track`;
}

// Send order confirmation
async function sendOrderConfirmation(order) {
  const results = { email: null, sms: null };

  // Send email if customer provided email
  if (order.customer.email) {
    try {
      const emailTemplate = getOrderConfirmationEmail(order);
      await transporter.sendMail({
        from: `"Herman Perfume" <${process.env.EMAIL_USER}>`,
        to: order.customer.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html
      });
      results.email = { success: true };
      console.log(`✅ Order confirmation email sent to ${order.customer.email}`);
    } catch (error) {
      console.error('Email Error:', error);
      results.email = { success: false, error: error.message };
    }
  }

  // Send SMS
  try {
    const smsMessage = getOrderConfirmationSMS(order);
    results.sms = await sendSMS(order.customer.phone, smsMessage);
  } catch (error) {
    console.error('SMS Error:', error);
    results.sms = { success: false, error: error.message };
  }

  return results;
}

// Send status update notifications
async function sendStatusUpdateNotification(order, newStatus) {
  const results = { email: null, sms: null };

  // Send email if customer provided email
  if (order.customer.email) {
    try {
      const statusTitles = {
        confirmed: 'Order Confirmed',
        processing: 'Order Being Processed',
        shipped: 'Order Shipped',
        delivered: 'Order Delivered',
        cancelled: 'Order Cancelled'
      };

      await transporter.sendMail({
        from: `"Herman Perfume" <${process.env.EMAIL_USER}>`,
        to: order.customer.email,
        subject: `${statusTitles[newStatus]} - ${order.orderNumber} | Herman Perfume`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #4a2c5a 0%, #d4af37 100%); color: white; text-align: center; padding: 20px;">
              <h2>Herman Perfume</h2>
              <h3>${statusTitles[newStatus]}</h3>
            </div>
            <div style="padding: 20px; background: #fff; border: 1px solid #ddd;">
              <p>Hello ${order.customer.firstName},</p>
              <p>Your order <strong>${order.orderNumber}</strong> status has been updated to: <strong>${newStatus.toUpperCase()}</strong></p>
              ${newStatus === 'shipped' ? '<p>🚚 Your order is on the way! You should receive it within 1-2 business days.</p>' : ''}
              ${newStatus === 'delivered' ? '<p>🎉 Thank you for shopping with Herman Perfume! We hope you love your new fragrance.</p>' : ''}
              <p>Track your order: <a href="www.hermanperfume.com/track">www.hermanperfume.com/track</a></p>
            </div>
          </div>
        `
      });
      results.email = { success: true };
      console.log(`✅ Status update email sent to ${order.customer.email}`);
    } catch (error) {
      console.error('Email Error:', error);
      results.email = { success: false, error: error.message };
    }
  }

  // Send SMS
  try {
    const smsMessage = getOrderStatusSMS(order, newStatus);
    results.sms = await sendSMS(order.customer.phone, smsMessage);
  } catch (error) {
    console.error('SMS Error:', error);
    results.sms = { success: false, error: error.message };
  }

  return results;
}

// const Product = mongoose.model('Product', productSchema);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'perfume-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Routes

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      // Return sample data if no database connection
      const sampleProducts = [
        {
          _id: "1",
          name: "Midnight Elegance",
          description: "A sophisticated blend of sandalwood, vanilla, and amber that captivates the senses with its mysterious allure. Perfect for evening occasions.",
          price: 125,
          category: "oriental",
          notes: ["Sandalwood", "Vanilla", "Amber"],
          badge: "Bestseller",
          quantity: 50,
          inStock: true,
          image: ""
        },
        {
          _id: "2",
          name: "Garden Dreams",
          description: "Fresh and vibrant notes of jasmine, bergamot, and white tea create a perfect daytime companion that energizes and uplifts.",
          price: 98,
          category: "floral",
          notes: ["Jasmine", "Bergamot", "White Tea"],
          badge: "New",
          quantity: 30,
          inStock: true,
          image: ""
        },
        {
          _id: "3",
          name: "Royal Essence",
          description: "An opulent fragrance featuring rare oud, rose petals, and gold accents for the most discerning tastes. A true luxury experience.",
          price: 250,
          category: "oriental",
          notes: ["Oud", "Rose", "Gold Accents"],
          badge: "Limited",
          quantity: 10,
          inStock: true,
          image: ""
        },
        {
          _id: "4",
          name: "Ocean Breeze",
          description: "Refreshing aquatic notes combined with sea salt and driftwood create an invigorating maritime escape.",
          price: 89,
          category: "fresh",
          notes: ["Sea Salt", "Driftwood", "Aquatic"],
          badge: "",
          quantity: 40,
          inStock: true,
          image: ""
        },
        {
          _id: "5",
          name: "Forest Walk",
          description: "Earthy pine, cedar, and moss blend harmoniously to capture the essence of a peaceful woodland stroll.",
          price: 115,
          category: "woody",
          notes: ["Pine", "Cedar", "Moss"],
          badge: "",
          quantity: 25,
          inStock: true,
          image: ""
        },
        {
          _id: "6",
          name: "Summer Bloom",
          description: "A delightful bouquet of peony, lily of the valley, and soft musk that embodies the beauty of spring gardens.",
          price: 95,
          category: "floral",
          notes: ["Peony", "Lily of Valley", "Musk"],
          badge: "Popular",
          quantity: 35,
          inStock: true,
          image: ""
        }
      ];
      
      // Apply filters to sample data
      let filteredProducts = sampleProducts;
      const { category, inStock } = req.query;
      
      if (category && category !== 'all') {
        filteredProducts = filteredProducts.filter(p => p.category === category);
      }
      
      if (inStock === 'true') {
        filteredProducts = filteredProducts.filter(p => p.inStock === true);
      }
      
      return res.json(filteredProducts);
    }

    const { category, inStock } = req.query;
    let filter = {};
    
    if (category && category !== 'all') {
      filter.category = category;
    }
    
    if (inStock === 'true') {
      filter.inStock = true;
    }
    
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Add new product
app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, notes, badge, quantity } = req.body;
    
    // Parse notes if it's a string
    let parsedNotes = [];
    if (notes) {
      if (typeof notes === 'string') {
        parsedNotes = notes.split(',').map(note => note.trim()).filter(note => note.length > 0);
      } else if (Array.isArray(notes)) {
        parsedNotes = notes;
      }
    }
    
    const productData = {
      name,
      description,
      price: parseFloat(price),
      category: category.toLowerCase(),
      notes: parsedNotes,
      badge: badge || '',
      quantity: parseInt(quantity) || 0,
      inStock: parseInt(quantity) > 0
    };
    
    // Add image path if uploaded
    if (req.file) {
      productData.image = `/uploads/${req.file.filename}`;
    }
    
    const product = new Product(productData);
    const savedProduct = await product.save();
    
    console.log('✅ Product added:', savedProduct.name);
    res.status(201).json(savedProduct);
  } catch (error) {
    console.error('Error adding product:', error);
    res.status(400).json({ error: error.message || 'Failed to add product' });
  }
});

// Update product
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, notes, badge, quantity } = req.body;
    
    let parsedNotes = [];
    if (notes) {
      if (typeof notes === 'string') {
        parsedNotes = notes.split(',').map(note => note.trim()).filter(note => note.length > 0);
      } else if (Array.isArray(notes)) {
        parsedNotes = notes;
      }
    }
    
    const updateData = {
      name,
      description,
      price: parseFloat(price),
      category: category.toLowerCase(),
      notes: parsedNotes,
      badge: badge || '',
      quantity: parseInt(quantity) || 0,
      inStock: parseInt(quantity) > 0,
      updatedAt: Date.now()
    };
    
    if (req.file) {
      updateData.image = `/uploads/${req.file.filename}`;
    }
    
    const product = await Product.findByIdAndUpdate(
      req.params.id, 
      updateData, 
      { new: true, runValidators: true }
    );
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    console.log('✅ Product updated:', product.name);
    res.json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(400).json({ error: error.message || 'Failed to update product' });
  }
});

// Delete product
app.delete('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    console.log('🗑️ Product deleted:', product.name);
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Bulk insert sample products (for testing)
app.post('/api/products/bulk-insert', async (req, res) => {
  try {
    const sampleProducts = [
      {
        name: "Midnight Elegance",
        description: "A sophisticated blend of sandalwood, vanilla, and amber that captivates the senses with its mysterious allure. Perfect for evening occasions.",
        price: 125,
        category: "oriental",
        notes: ["Sandalwood", "Vanilla", "Amber"],
        badge: "Bestseller",
        quantity: 50
      },
      {
        name: "Garden Dreams",
        description: "Fresh and vibrant notes of jasmine, bergamot, and white tea create a perfect daytime companion that energizes and uplifts.",
        price: 98,
        category: "floral",
        notes: ["Jasmine", "Bergamot", "White Tea"],
        badge: "New",
        quantity: 30
      },
      {
        name: "Royal Essence",
        description: "An opulent fragrance featuring rare oud, rose petals, and gold accents for the most discerning tastes. A true luxury experience.",
        price: 250,
        category: "oriental",
        notes: ["Oud", "Rose", "Gold Accents"],
        badge: "Limited",
        quantity: 10
      },
      {
        name: "Ocean Breeze",
        description: "Refreshing aquatic notes combined with sea salt and driftwood create an invigorating maritime escape.",
        price: 89,
        category: "fresh",
        notes: ["Sea Salt", "Driftwood", "Aquatic"],
        badge: "",
        quantity: 40
      },
      {
        name: "Forest Walk",
        description: "Earthy pine, cedar, and moss blend harmoniously to capture the essence of a peaceful woodland stroll.",
        price: 115,
        category: "woody",
        notes: ["Pine", "Cedar", "Moss"],
        badge: "",
        quantity: 25
      },
      {
        name: "Summer Bloom",
        description: "A delightful bouquet of peony, lily of the valley, and soft musk that embodies the beauty of spring gardens.",
        price: 95,
        category: "floral",
        notes: ["Peony", "Lily of Valley", "Musk"],
        badge: "Popular",
        quantity: 35
      }
    ];
    
    // Set inStock based on quantity
    sampleProducts.forEach(product => {
      product.inStock = product.quantity > 0;
    });
    
    await Product.deleteMany({}); // Clear existing products
    const products = await Product.insertMany(sampleProducts);
    
    console.log('✅ Sample products inserted:', products.length);
    res.json({ 
      message: `${products.length} sample products inserted successfully`,
      products 
    });
  } catch (error) {
    console.error('Error inserting sample products:', error);
    res.status(500).json({ error: 'Failed to insert sample products' });
  }
});

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'products.html'));
});

app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

app.get('/checkout.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/orders', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'orders.html'));
});

app.get('/orders.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'orders.html'));
});

app.get('/email-test', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'email-test.html'));
});

app.get('/email-test.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'email-test.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
  }
  res.status(500).json({ error: error.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

module.exports = app;