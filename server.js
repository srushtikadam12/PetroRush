require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Resend } = require('resend');
 
const app = express();
app.use(cors());
app.use(express.json());
 
// ============================================
// RESEND EMAIL
// ============================================
const resend = new Resend(process.env.RESEND_API_KEY);
 
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
  email: { type: String },
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
// GENERATE OTP
// ============================================
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
 
// ============================================
// SEND OTP TO USER'S OWN EMAIL
// ============================================
async function sendOTPToUser(userEmail, phone, otp) {
  await resend.emails.send({
    from: 'PetroRush <onboarding@resend.dev>',
    to: userEmail,
    subject: `Your PetroRush OTP: ${otp}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:0;background:#f5f5f5;">
        <div style="background:#000;padding:28px 32px;text-align:center;">
          <h1 style="color:#FF6B00;margin:0;font-size:28px;letter-spacing:3px;">PETRORUSH</h1>
          <p style="color:#888;margin:6px 0 0;font-size:13px;">Fuel delivered to your location</p>
        </div>
        <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;">
          <h2 style="color:#111;font-size:20px;margin:0 0 8px;">Your OTP Code</h2>
          <p style="color:#888;font-size:14px;margin:0 0 24px;">Use this code to verify your phone number <strong>+91 ${phone}</strong></p>
          <div style="background:#000;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
            <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#FF6B00;">${otp}</div>
          </div>
          <p style="color:#e53935;font-size:13px;margin:0 0 8px;">⏱ This OTP expires in <strong>5 minutes</strong></p>
          <p style="color:#888;font-size:12px;margin:0;">If you did not request this OTP, please ignore this email.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
          <p style="color:#aaa;font-size:11px;text-align:center;margin:0;">© 2024 PetroRush · Fuel at your doorstep</p>
        </div>
      </div>
    `
  });
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
    const { phone, email } = req.body;
    if (!phone || phone.length !== 10) {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required to receive OTP' });
    }
 
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);
 
    await User.findOneAndUpdate(
      { phone },
      { otp, otpExpiry, email },
      { upsert: true, new: true }
    );
 
    await sendOTPToUser(email, phone, otp);
 
    console.log(`📱 OTP ${otp} sent to ${email} for phone ${phone}`);
    res.json({ success: true, message: `OTP sent to ${email}` });
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
      return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });
    }
    if (new Date() > user.otpExpiry) {
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }
 
    user.otp = null;
    user.otpExpiry = null;
    await user.save();
 
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
        email: user.email,
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
 
// SIGNUP
app.post('/api/signup', async (req, res) => {
  try {
    const { phone, email, name, aadhaar, vehicleNumber, vehicleType } = req.body;
 
    if (!phone || !email || !name || !aadhaar || !vehicleNumber || !vehicleType) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
 
    const user = await User.findOneAndUpdate(
      { phone },
      { name, email, aadhaar, vehicleNumber, vehicleType, otp: null, otpExpiry: null },
      { upsert: true, new: true }
    );
 
    const token = jwt.sign(
      { userId: user._id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
 
    // Welcome email to user
    await resend.emails.send({
      from: 'PetroRush <onboarding@resend.dev>',
      to: email,
      subject: '🎉 Welcome to PetroRush!',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f5f5;">
          <div style="background:#000;padding:28px 32px;text-align:center;">
            <h1 style="color:#FF6B00;margin:0;font-size:28px;letter-spacing:3px;">PETRORUSH</h1>
            <p style="color:#888;margin:6px 0 0;font-size:13px;">Fuel delivered to your location</p>
          </div>
          <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;">
            <h2 style="color:#111;">Welcome, ${name}! 🎉</h2>
            <p style="color:#888;font-size:14px;">Your PetroRush account has been created successfully.</p>
            <div style="background:#f9f9f9;border-radius:10px;padding:20px;margin:20px 0;">
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px;color:#888;font-size:13px;">Phone</td><td style="padding:8px;font-weight:bold;font-size:13px;">+91 ${phone}</td></tr>
                <tr style="background:#fff;"><td style="padding:8px;color:#888;font-size:13px;">Vehicle</td><td style="padding:8px;font-weight:bold;font-size:13px;">${vehicleNumber} (${vehicleType})</td></tr>
              </table>
            </div>
            <p style="color:#888;font-size:13px;">You can now order fuel anytime, anywhere. Just tap <strong>Order Fuel Now</strong>!</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
            <p style="color:#aaa;font-size:11px;text-align:center;">© 2024 PetroRush · Fuel at your doorstep</p>
          </div>
        </div>
      `
    });
 
    // Notify owner
    await resend.emails.send({
      from: 'PetroRush <onboarding@resend.dev>',
      to: process.env.CONTACT_EMAIL,
      subject: `🚀 New PetroRush signup: ${name}`,
      html: `<p>New user: <b>${name}</b> | Phone: <b>+91 ${phone}</b> | Email: <b>${email}</b> | Vehicle: <b>${vehicleNumber}</b> | Time: ${new Date().toLocaleString('en-IN')}</p>`
    });
 
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
    await Contact.create({ name, phone, email, message });
 
    await resend.emails.send({
      from: 'PetroRush <onboarding@resend.dev>',
      to: process.env.CONTACT_EMAIL,
      subject: `📬 New message from ${name} — PetroRush`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;padding:24px;background:#f9f9f9;border-radius:12px;">
          <h2 style="color:#FF6B00;">New Contact Message 📬</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:10px;color:#888;">Name</td><td style="padding:10px;font-weight:bold;">${name}</td></tr>
            <tr style="background:#fff;"><td style="padding:10px;color:#888;">Phone</td><td style="padding:10px;font-weight:bold;">${phone}</td></tr>
            <tr><td style="padding:10px;color:#888;">Email</td><td style="padding:10px;"><a href="mailto:${email}">${email}</a></td></tr>
            <tr style="background:#fff;"><td style="padding:10px;color:#888;">Message</td><td style="padding:10px;">${message}</td></tr>
            <tr><td style="padding:10px;color:#888;">Time</td><td style="padding:10px;">${new Date().toLocaleString('en-IN')}</td></tr>
          </table>
          <a href="mailto:${email}" style="display:inline-block;margin-top:16px;background:#FF6B00;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reply to ${name}</a>
        </div>
      `
    });
 
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
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
 
// PROFILE
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-otp -otpExpiry');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});
 
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 PetroRush backend running on http://localhost:${PORT}`);
  console.log(`📧 Using Resend for emails`);
  console.log(`📬 Contact emails go to: ${process.env.CONTACT_EMAIL}`);
});
 