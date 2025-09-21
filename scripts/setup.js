// setup.js - Run this script to set up your database with sample data
const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://sadabmahmud444:febR25@cluster0.pkmkv4i.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// Product Schema (same as in server.js)
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

productSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Product = mongoose.model('Product', productSchema);

// Sample data
const sampleProducts = [
  {
    name: "Midnight Elegance",
    description: "A sophisticated blend of sandalwood, vanilla, and amber that captivates the senses with its mysterious allure. Perfect for evening occasions and special moments.",
    price: 125,
    category: "oriental",
    notes: ["Sandalwood", "Vanilla", "Amber", "Musk"],
    badge: "Bestseller",
    quantity: 50,
    inStock: true
  },
  {
    name: "Garden Dreams",
    description: "Fresh and vibrant notes of jasmine, bergamot, and white tea create a perfect daytime companion that energizes and uplifts your spirit.",
    price: 98,
    category: "floral",
    notes: ["Jasmine", "Bergamot", "White Tea", "Peach"],
    badge: "New",
    quantity: 30,
    inStock: true
  },
  {
    name: "Royal Essence",
    description: "An opulent fragrance featuring rare oud, rose petals, and gold accents for the most discerning tastes. A true luxury experience.",
    price: 250,
    category: "oriental",
    notes: ["Oud", "Rose", "Saffron", "Amber"],
    badge: "Limited",
    quantity: 10,
    inStock: true
  },
  {
    name: "Ocean Breeze",
    description: "Refreshing aquatic notes combined with sea salt and driftwood create an invigorating maritime escape that transports you to coastal paradises.",
    price: 89,
    category: "fresh",
    notes: ["Sea Salt", "Driftwood", "Aquatic", "Citrus"],
    badge: "",
    quantity: 40,
    inStock: true
  },
  {
    name: "Forest Walk",
    description: "Earthy pine, cedar, and moss blend harmoniously to capture the essence of a peaceful woodland stroll through ancient forests.",
    price: 115,
    category: "woody",
    notes: ["Pine", "Cedar", "Moss", "Vetiver"],
    badge: "",
    quantity: 25,
    inStock: true
  },
  {
    name: "Summer Bloom",
    description: "A delightful bouquet of peony, lily of the valley, and soft musk that embodies the beauty of spring gardens in full bloom.",
    price: 95,
    category: "floral",
    notes: ["Peony", "Lily of Valley", "Musk", "Green Leaves"],
    badge: "Popular",
    quantity: 35,
    inStock: true
  },
  {
    name: "Desert Winds",
    description: "Warm spices and exotic resins create a mysterious and captivating fragrance inspired by ancient trade routes and desert caravans.",
    price: 140,
    category: "oriental",
    notes: ["Frankincense", "Myrrh", "Cardamom", "Leather"],
    badge: "",
    quantity: 20,
    inStock: true
  },
  {
    name: "Morning Dew",
    description: "Light and refreshing with notes of green apple, cucumber, and white flowers. Perfect for everyday wear and morning routines.",
    price: 75,
    category: "fresh",
    notes: ["Green Apple", "Cucumber", "White Flowers", "Mint"],
    badge: "New",
    quantity: 45,
    inStock: true
  },
  {
    name: "Autumn Leaves",
    description: "Rich and warm with tobacco, leather, and spiced woods. Captures the essence of crisp autumn days and cozy evenings.",
    price: 130,
    category: "woody",
    notes: ["Tobacco", "Leather", "Cedarwood", "Cinnamon"],
    badge: "",
    quantity: 15,
    inStock: true
  },
  {
    name: "Rose Garden",
    description: "A classic and elegant rose fragrance with modern twists. Bulgarian rose petals meet contemporary florals for timeless sophistication.",
    price: 110,
    category: "floral",
    notes: ["Bulgarian Rose", "Peony", "Violet", "White Musk"],
    badge: "Popular",
    quantity: 28,
    inStock: true
  }
];

async function setupDatabase() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Clear existing products
    console.log('🔄 Clearing existing products...');
    await Product.deleteMany({});
    console.log('✅ Existing products cleared');

    // Insert sample products
    console.log('🔄 Inserting sample products...');
    const insertedProducts = await Product.insertMany(sampleProducts);
    console.log(`✅ ${insertedProducts.length} sample products inserted`);

    // Display summary
    console.log('\n📊 Database Setup Summary:');
    console.log('========================');
    
    const categories = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    
    categories.forEach(cat => {
      console.log(`${cat._id.charAt(0).toUpperCase() + cat._id.slice(1)}: ${cat.count} products`);
    });

    const totalValue = await Product.aggregate([
      { $group: { _id: null, total: { $sum: { $multiply: ['$price', '$quantity'] } } } }
    ]);
    
    console.log(`\nTotal inventory value: $${totalValue[0]?.total.toLocaleString() || 0}`);
    console.log('\n🎉 Database setup completed successfully!');
    console.log('\nYou can now:');
    console.log('1. Start your server: npm start');
    console.log('2. Visit http://localhost:3000 for the website');
    console.log('3. Visit http://localhost:3000/admin.html for the admin panel');

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run setup if this script is executed directly
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase, sampleProducts };