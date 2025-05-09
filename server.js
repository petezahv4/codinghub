const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const session = require('express-session');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware
app.use(session({
  secret: 'your-secret-key', // Replace with a strong secret in production
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set secure: true in production with HTTPS
}));

// Serve static files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse query parameters and body
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Path to data.json
const DATA_FILE = path.join(__dirname, 'data.json');

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'petezahindsutries@gmail.com',
    pass: 'jgkw bxvx kpwv easl' // 16-character app-specific password
  }
});

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.session.user) {
    return next();
  }
  return res.redirect('/login?state=unauthorized');
};

// Initialize data.json if it doesn't exist
async function initializeDataFile() {
  try {
    await fs.access(DATA_FILE);
  } catch (err) {
    await fs.writeFile(DATA_FILE, JSON.stringify({ users: [] }, null, 2));
    console.log('Created data.json');
  }
}

// Call initialization on startup
initializeDataFile().catch(err => console.error('Error initializing data.json:', err.message));

// Public routes
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/account/signup/index.html'));
});

app.get('/login', async (req, res) => {
  const { user, pass } = req.query;

  // If no user/pass query params, serve the login page
  if (!user || !pass) {
    return res.sendFile(path.join(__dirname, 'public/pages/account/login/index.html'));
  }

  // Handle login logic
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const { users } = JSON.parse(data);

    const validUser = users.find(u => u.username === user && u.password === pass);

    if (!validUser) {
      return res.redirect('/login?state=invalid');
    }

    if (!validUser.isVerified) {
      return res.redirect('/login?state=unverified');
    }

    // Set session user
    req.session.user = user;
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Error reading user data:', err.message);
    return res.redirect('/login?state=error');
  }
});

app.post('/signup', async (req, res) => {
  const { user, email, pass } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  if (!user || !email || !pass) {
    console.error('Signup failed: Missing required fields');
    return res.redirect('/signup?state=error');
  }

  try {
    // Read existing users
    let data, users;
    try {
      data = await fs.readFile(DATA_FILE, 'utf8');
      users = JSON.parse(data).users;
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      throw new Error('Failed to read user data');
    }

    // Check if username or email already exists
    if (users.some(u => u.username === user)) {
      console.log(`Signup failed: Username ${user} already exists`);
      return res.redirect('/signup?state=exists');
    }
    if (users.some(u => u.email === email)) {
      console.log(`Signup failed: Email ${email} already exists`);
      return res.redirect('/signup?state=email_exists');
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Add new user with verification status
    const newUser = {
      username: user,
      email: email,
      password: pass,
      ip: ip,
      progress: {},
      isVerified: false,
      verificationToken: verificationToken
    };
    users.push(newUser);

    // Write updated users back to file
    try {
      await fs.writeFile(DATA_FILE, JSON.stringify({ users }, null, 2));
    } catch (err) {
      console.error('Error writing to data.json:', err.message);
      throw new Error('Failed to save user data');
    }

    // Send verification email
    const verificationLink = `http://localhost:${PORT}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    const mailOptions = {
      from: 'petezahindsutries@gmail.com',
      to: email,
      subject: 'Verify Your CodingHub Account',
      html: `
        <h2>Welcome to CodingHub!</h2>
        <p>Please verify your email by clicking the link below:</p>
        <a href="${verificationLink}">Verify Email</a>
        <p>If you did not sign up for CodingHub, please ignore this email.</p>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`Verification email sent to ${email}`);
    } catch (err) {
      console.error('Error sending verification email:', err.message);
      // Allow signup to proceed even if email fails (for debugging)
      // In production, you might want to handle this differently
    }

    // Redirect to signup with success message
    return res.redirect('/signup?state=verify_email_sent');
  } catch (err) {
    console.error('Signup error:', err.message, err.stack);
    return res.redirect('/signup?state=error');
  }
});

app.get('/verify-email', async (req, res) => {
  const { token, email } = req.query;

  if (!token || !email) {
    console.log('Email verification failed: Missing token or email');
    return res.redirect('/signup?state=verify_error');
  }

  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const { users } = JSON.parse(data);

    const userIndex = users.findIndex(u => u.email === email && u.verificationToken === token);

    if (userIndex === -1) {
      console.log(`Email verification failed: Invalid token for ${email}`);
      return res.redirect('/signup?state=verify_invalid');
    }

    // Mark user as verified and remove verification token
    users[userIndex].isVerified = true;
    delete users[userIndex].verificationToken;

    // Write updated users back to file
    await fs.writeFile(DATA_FILE, JSON.stringify({ users }, null, 2));
    console.log(`Email verified for ${email}`);

    // Redirect to login with success message
    return res.redirect('/login?state=verified');
  } catch (err) {
    console.error('Error during email verification:', err.message);
    return res.redirect('/signup?state=verify_error');
  }
});

// Protected routes
app.get('/editor', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/editor/index.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/dashboard/index.html'));
});

// Progress routes
app.get('/progress', requireAuth, async (req, res) => {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const { users } = JSON.parse(data);
    const user = users.find(u => u.username === req.session.user);
    if (user) {
      res.json(user.progress || {});
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    console.error('Error reading progress:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/progress', requireAuth, async (req, res) => {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const { users } = JSON.parse(data);
    const userIndex = users.findIndex(u => u.username === req.session.user);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Merge new progress with existing progress
    users[userIndex].progress = { ...users[userIndex].progress, ...req.body };
    await fs.writeFile(DATA_FILE, JSON.stringify({ users }, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving progress:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Catch-all for other static assets
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', req.path));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});