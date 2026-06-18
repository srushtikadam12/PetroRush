require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// MONGODB CONNECTION
// ============================================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/petrorush')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('❌ MongoDB error:', err.message));

// ============================================
// USER MODEL
// ============================================
const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String },
  aadhaar: { type: String },
  vehicleNumber: { type: String },
  vehicleType: { type: String },
  otp: { type: String },
  otpExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// ============================================
// CONTACT MESSAGE MODEL
// ============================================
const contactSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);

// ============================================
// EMAIL TRANSPORTER
// ============================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Test email connection
transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Email error:', error.message);
  } else {
    console.log('✅ Email service ready');
  }
});

// ============================================
// GENERATE OTP
// ============================================
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// ============================================
// SEND OTP EMAIL (since we don't have Twilio)
// We simulate SMS by sending OTP to owner email
// ============================================
async function sendOTPEmail(phone, otp) {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: process.env.CONTACT_EMAIL,
    subject: `PetroRush OTP for ${phone}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:20px;background:#f9f9f9;border-radius:10px;">
        <h2 style="color:#FF6B00;">PetroRush OTP</h2>
        <p>OTP requested for phone: <strong>+91 ${phone}</strong></p>
        <div style="background:#000;color:#FF6B00;font-size:32px;font-weight:900;text-align:center;padding:20px;border-radius:8px;letter-spacing:8px;">
          ${otp}
        </div>
        <p style="color:#888;font-size:12px;margin-top:16px;">This OTP expires in 5 minutes.</p>
      </div>
    `
  };
  await transporter.sendMail(mailOptions);
}

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'PetroRush backend running ✅' });
});

// SEND OTP
app.post('/api/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.length !== 10) {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Save OTP to database
    await User.findOneAndUpdate(
      { phone },
      { otp, otpExpiry },
      { upsert: true, new: true }
    );

    // Send OTP email to owner (for demo)
    await sendOTPEmail(phone, otp);

    console.log(`📱 OTP ${otp} sent for phone ${phone}`);
    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// VERIFY OTP + LOGIN
app.post('/api/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found. Please sign up first.' });
    }
    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    if (new Date() > user.otpExpiry) {
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    // Clear OTP
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        phone: user.phone,
        name: user.name,
        vehicleNumber: user.vehicleNumber,
        vehicleType: user.vehicleType
      }
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// SIGNUP — SAVE USER DETAILS
app.post('/api/signup', async (req, res) => {
  try {
    const { phone, name, aadhaar, vehicleNumber, vehicleType } = req.body;

    if (!phone || !name || !aadhaar || !vehicleNumber || !vehicleType) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Update user with full details
    const user = await User.findOneAndUpdate(
      { phone },
      { name, aadhaar, vehicleNumber, vehicleType, otp: null, otpExpiry: null },
      { upsert: true, new: true }
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Send welcome email to owner
    const welcomeMail = {
      from: process.env.GMAIL_USER,
      to: process.env.CONTACT_EMAIL,
      subject: '🎉 New PetroRush User Signup!',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:12px;">
          <h2 style="color:#FF6B00;">New User Signup! 🚀</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px;color:#888;">Name</td><td style="padding:8px;font-weight:bold;">${name}</td></tr>
            <tr style="background:#fff;"><td style="padding:8px;color:#888;">Phone</td><td style="padding:8px;font-weight:bold;">+91 ${phone}</td></tr>
            <tr><td style="padding:8px;color:#888;">Vehicle</td><td style="padding:8px;font-weight:bold;">${vehicleNumber} (${vehicleType})</td></tr>
            <tr style="background:#fff;"><td style="padding:8px;color:#888;">Signed up</td><td style="padding:8px;font-weight:bold;">${new Date().toLocaleString('en-IN')}</td></tr>
          </table>
        </div>
      `
    };
    await transporter.sendMail(welcomeMail);

    res.json({ success: true, message: 'Account created successfully', token });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, message: 'Signup failed' });
  }
});

// CONTACT FORM
app.post('/api/contact', async (req, res) => {
  try {
    const { name, phone, email, message } = req.body;

    if (!name || !phone || !email || !message) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Save to database
    await Contact.create({ name, phone, email, message });

    // Send email to owner
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: process.env.CONTACT_EMAIL,
      subject: `📬 New Contact Message from ${name} — PetroRush`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:12px;">
          <h2 style="color:#FF6B00;">New Contact Message 📬</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:10px;color:#888;width:120px;">Name</td><td style="padding:10px;font-weight:bold;">${name}</td></tr>
            <tr style="background:#fff;"><td style="padding:10px;color:#888;">Phone</td><td style="padding:10px;font-weight:bold;">${phone}</td></tr>
            <tr><td style="padding:10px;color:#888;">Email</td><td style="padding:10px;font-weight:bold;"><a href="mailto:${email}">${email}</a></td></tr>
            <tr style="background:#fff;"><td style="padding:10px;color:#888;">Message</td><td style="padding:10px;">${message}</td></tr>
            <tr><td style="padding:10px;color:#888;">Time</td><td style="padding:10px;">${new Date().toLocaleString('en-IN')}</td></tr>
          </table>
          <a href="mailto:${email}" style="display:inline-block;margin-top:16px;background:#FF6B00;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reply to ${name}</a>
        </div>
      `
    };
    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// PROTECTED ROUTE EXAMPLE
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-otp -otpExpiry');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

// JWT MIDDLEWARE
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ success: false, message: 'Invalid token' });
  }
}

// START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 PetroRush backend running on http://localhost:${PORT}`);
  console.log(`📧 Emails will be sent to: ${process.env.CONTACT_EMAIL}`);
});
