const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sql } = require('@vercel/postgres');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// ==================== AUTH ROUTES ====================

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    
    // Check if user exists
    const existingUser = await sql`
      SELECT * FROM users WHERE email = ${email}
    `;
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = await sql`
      INSERT INTO users (email, password, name, role, created_at)
      VALUES (${email}, ${hashedPassword}, ${name}, ${role || 'therapist'}, NOW())
      RETURNING id, email, name, role
    `;

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET);

    res.json({ token, user });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await sql`
      SELECT * FROM users WHERE email = ${email}
    `;

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ==================== CLIENT ROUTES ====================

// Get all clients
app.get('/api/clients', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT * FROM clients 
      WHERE therapist_id = ${req.user.userId}
      ORDER BY created_at DESC
    `;
    res.json(result.rows);
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Get single client
app.get('/api/clients/:id', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT * FROM clients 
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.userId}
    `;
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

// Create client
app.post('/api/clients', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, dob, address, insurance, notes } = req.body;

    const result = await sql`
      INSERT INTO clients (
        therapist_id, name, email, phone, dob, address, insurance, notes, created_at
      )
      VALUES (
        ${req.user.userId}, ${name}, ${email}, ${phone}, ${dob}, 
        ${address}, ${insurance}, ${notes}, NOW()
      )
      RETURNING *
    `;

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Update client
app.put('/api/clients/:id', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, dob, address, insurance, notes } = req.body;

    const result = await sql`
      UPDATE clients 
      SET name = ${name}, email = ${email}, phone = ${phone}, 
          dob = ${dob}, address = ${address}, insurance = ${insurance}, 
          notes = ${notes}, updated_at = NOW()
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.userId}
      RETURNING *
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// Delete client
app.delete('/api/clients/:id', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      DELETE FROM clients 
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.userId}
      RETURNING id
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// ==================== APPOINTMENT ROUTES ====================

// Get all appointments
app.get('/api/appointments', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT a.*, c.name as client_name 
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      WHERE a.therapist_id = ${req.user.userId}
      ORDER BY a.start_time ASC
    `;
    res.json(result.rows);
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Create appointment
app.post('/api/appointments', authenticateToken, async (req, res) => {
  try {
    const { client_id, start_time, end_time, type, notes } = req.body;

    const result = await sql`
      INSERT INTO appointments (
        therapist_id, client_id, start_time, end_time, type, notes, created_at
      )
      VALUES (
        ${req.user.userId}, ${client_id}, ${start_time}, ${end_time}, 
        ${type}, ${notes}, NOW()
      )
      RETURNING *
    `;

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Update appointment
app.put('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const { client_id, start_time, end_time, type, notes, status } = req.body;

    const result = await sql`
      UPDATE appointments 
      SET client_id = ${client_id}, start_time = ${start_time}, 
          end_time = ${end_time}, type = ${type}, notes = ${notes},
          status = ${status}, updated_at = NOW()
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.userId}
      RETURNING *
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Delete appointment
app.delete('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      DELETE FROM appointments 
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.userId}
      RETURNING id
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    res.json({ message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

// ==================== INVOICE ROUTES ====================

// Get all invoices
app.get('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT i.*, c.name as client_name 
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.therapist_id = ${req.user.userId}
      ORDER BY i.created_at DESC
    `;
    res.json(result.rows);
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Create invoice
app.post('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const { client_id, amount, description, due_date, status } = req.body;

    const result = await sql`
      INSERT INTO invoices (
        therapist_id, client_id, amount, description, due_date, status, created_at
      )
      VALUES (
        ${req.user.userId}, ${client_id}, ${amount}, ${description}, 
        ${due_date}, ${status || 'pending'}, NOW()
      )
      RETURNING *
    `;

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// Update invoice
app.put('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    const { amount, description, due_date, status, paid_date } = req.body;

    const result = await sql`
      UPDATE invoices 
      SET amount = ${amount}, description = ${description}, 
          due_date = ${due_date}, status = ${status}, 
          paid_date = ${paid_date}, updated_at = NOW()
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.userId}
      RETURNING *
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update invoice error:', error);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// ==================== NOTES ROUTES ====================

// Get all notes
app.get('/api/notes', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT n.*, c.name as client_name 
      FROM notes n
      LEFT JOIN clients c ON n.client_id = c.id
      WHERE n.therapist_id = ${req.user.userId}
      ORDER BY n.created_at DESC
    `;
    res.json(result.rows);
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Create note
app.post('/api/notes', authenticateToken, async (req, res) => {
  try {
    const { client_id, appointment_id, content, type } = req.body;

    const result = await sql`
      INSERT INTO notes (
        therapist_id, client_id, appointment_id, content, type, created_at
      )
      VALUES (
        ${req.user.userId}, ${client_id}, ${appointment_id}, 
        ${content}, ${type || 'session'}, NOW()
      )
      RETURNING *
    `;

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// ==================== ANALYTICS ROUTES ====================

// Get dashboard analytics
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
  try {
    // Get total clients
    const clientCount = await sql`
      SELECT COUNT(*) as count FROM clients 
      WHERE therapist_id = ${req.user.userId}
    `;

    // Get appointments this week
    const weekAppointments = await sql`
      SELECT COUNT(*) as count FROM appointments 
      WHERE therapist_id = ${req.user.userId}
      AND start_time >= NOW() - INTERVAL '7 days'
    `;

    // Get revenue this month
    const monthRevenue = await sql`
      SELECT SUM(amount) as total FROM invoices 
      WHERE therapist_id = ${req.user.userId}
      AND status = 'paid'
      AND paid_date >= DATE_TRUNC('month', NOW())
    `;

    // Get pending invoices
    const pendingInvoices = await sql`
      SELECT SUM(amount) as total FROM invoices 
      WHERE therapist_id = ${req.user.userId}
      AND status = 'pending'
    `;

    res.json({
      totalClients: parseInt(clientCount.rows[0].count),
      weekAppointments: parseInt(weekAppointments.rows[0].count),
      monthRevenue: parseFloat(monthRevenue.rows[0].total || 0),
      pendingInvoices: parseFloat(pendingInvoices.rows[0].total || 0)
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'ClinicalCanvas API is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`ClinicalCanvas API running on port ${PORT}`);
});

// Export for Vercel
module.exports = app;
