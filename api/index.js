const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize Neon database connection
const sql = neon(process.env.DATABASE_URL);

// Middleware
app.use(cors());
app.use(express.json());

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// ==================== AUTH ROUTES ====================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check if user exists
    const existingUser = await sql`
      SELECT * FROM users WHERE email = ${email}
    `;

    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = await sql`
      INSERT INTO users (email, password, name)
      VALUES (${email}, ${hashedPassword}, ${name})
      RETURNING id, email, name, role, created_at
    `;

    const user = result[0];

    // Create token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({ token, user });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const result = await sql`
      SELECT * FROM users WHERE email = ${email}
    `;

    if (result.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const user = result[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Create token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

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
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ==================== CLIENT ROUTES ====================

// Get all clients
app.get('/api/clients', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT * FROM clients 
      WHERE therapist_id = ${req.user.id}
      ORDER BY created_at DESC
    `;
    res.json(result);
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
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.id}
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json(result[0]);
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
      INSERT INTO clients (therapist_id, name, email, phone, dob, address, insurance, notes)
      VALUES (${req.user.id}, ${name}, ${email}, ${phone}, ${dob}, ${address}, ${insurance}, ${notes})
      RETURNING *
    `;

    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Update client
app.put('/api/clients/:id', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, dob, address, insurance, notes, status } = req.body;

    const result = await sql`
      UPDATE clients 
      SET name = ${name}, email = ${email}, phone = ${phone}, dob = ${dob},
          address = ${address}, insurance = ${insurance}, notes = ${notes},
          status = ${status || 'active'}, updated_at = NOW()
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.id}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json(result[0]);
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
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.id}
      RETURNING id
    `;

    if (result.length === 0) {
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
      WHERE a.therapist_id = ${req.user.id}
      ORDER BY a.start_time DESC
    `;
    res.json(result);
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Create appointment
app.post('/api/appointments', authenticateToken, async (req, res) => {
  try {
    const { client_id, start_time, end_time, type, status, location, notes } = req.body;

    const result = await sql`
      INSERT INTO appointments (therapist_id, client_id, start_time, end_time, type, status, location, notes)
      VALUES (${req.user.id}, ${client_id}, ${start_time}, ${end_time}, ${type}, ${status || 'scheduled'}, ${location}, ${notes})
      RETURNING *
    `;

    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Update appointment
app.put('/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { client_id, start_time, end_time, type, notes, status } = req.body;  // Removed location
    
    const result = await sql`
      UPDATE appointments 
      SET 
        client_id = ${client_id},
        start_time = ${start_time},
        end_time = ${end_time},
        type = ${type},
        notes = ${notes},
        status = ${status}
      WHERE id = ${id} AND user_id = ${req.user.userId}
      RETURNING *
    `;
    
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
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.id}
      RETURNING id
    `;

    if (result.length === 0) {
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
      WHERE i.therapist_id = ${req.user.id}
      ORDER BY i.created_at DESC
    `;
    res.json(result);
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Create invoice
app.post('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const { client_id, amount, status, due_date, service_date, service_type, payment_method, notes } = req.body;

    const result = await sql`
      INSERT INTO invoices (therapist_id, client_id, amount, status, due_date, service_date, service_type, payment_method, notes)
      VALUES (${req.user.id}, ${client_id}, ${amount}, ${status || 'pending'}, ${due_date}, ${service_date}, ${service_type}, ${payment_method}, ${notes})
      RETURNING *
    `;

    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// Update invoice
app.put('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    const { amount, status, due_date, service_date, service_type, payment_method, notes } = req.body;

    const result = await sql`
      UPDATE invoices 
      SET amount = ${amount}, status = ${status}, due_date = ${due_date},
          service_date = ${service_date}, service_type = ${service_type},
          payment_method = ${payment_method}, notes = ${notes}, updated_at = NOW()
      WHERE id = ${req.params.id} AND therapist_id = ${req.user.id}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(result[0]);
  } catch (error) {
    console.error('Update invoice error:', error);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// ==================== NOTES ROUTES ====================

// Get all notes
app.get('/api/notes', authenticateToken, async (req, res) => {
  try {
    const { client_id } = req.query;
    
    let result;
    if (client_id) {
      result = await sql`
        SELECT n.*, c.name as client_name
        FROM notes n
        LEFT JOIN clients c ON n.client_id = c.id
        WHERE n.therapist_id = ${req.user.id} AND n.client_id = ${client_id}
        ORDER BY n.created_at DESC
      `;
    } else {
      result = await sql`
        SELECT n.*, c.name as client_name
        FROM notes n
        LEFT JOIN clients c ON n.client_id = c.id
        WHERE n.therapist_id = ${req.user.id}
        ORDER BY n.created_at DESC
      `;
    }
    
    res.json(result);
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Create note
app.post('/api/notes', authenticateToken, async (req, res) => {
  try {
    const { client_id, type, content, session_date } = req.body;

    const result = await sql`
      INSERT INTO notes (therapist_id, client_id, type, content, session_date)
      VALUES (${req.user.id}, ${client_id}, ${type}, ${content}, ${session_date})
      RETURNING *
    `;

    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// ==================== DOCUMENTS ROUTES ====================

// Get all documents
app.get('/api/documents', authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT * FROM documents 
      WHERE therapist_id = ${req.user.id}
      ORDER BY created_at DESC
    `;
    res.json(result);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Create document
app.post('/api/documents', authenticateToken, async (req, res) => {
  try {
    const { title, category, file_url, file_type } = req.body;

    const result = await sql`
      INSERT INTO documents (therapist_id, title, category, file_url, file_type)
      VALUES (${req.user.id}, ${title}, ${category}, ${file_url}, ${file_type})
      RETURNING *
    `;

    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Create document error:', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// ==================== ANALYTICS ROUTES ====================

// Get dashboard analytics
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
  try {
    // Total clients
    const clientsResult = await sql`
      SELECT COUNT(*) as count FROM clients WHERE therapist_id = ${req.user.id}
    `;

    // Total appointments this month
    const appointmentsResult = await sql`
      SELECT COUNT(*) as count FROM appointments 
      WHERE therapist_id = ${req.user.id} 
      AND start_time >= DATE_TRUNC('month', CURRENT_DATE)
    `;

    // Total revenue this month
    const revenueResult = await sql`
      SELECT COALESCE(SUM(amount), 0) as total FROM invoices 
      WHERE therapist_id = ${req.user.id} 
      AND status = 'paid'
      AND service_date >= DATE_TRUNC('month', CURRENT_DATE)
    `;

    // Outstanding balance
    const outstandingResult = await sql`
      SELECT COALESCE(SUM(amount), 0) as total FROM invoices 
      WHERE therapist_id = ${req.user.id} 
      AND status = 'pending'
    `;

    res.json({
      totalClients: parseInt(clientsResult[0].count),
      monthlyAppointments: parseInt(appointmentsResult[0].count),
      monthlyRevenue: parseFloat(revenueResult[0].total),
      outstandingBalance: parseFloat(outstandingResult[0].total)
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route
app.get('/api', (req, res) => {
  res.json({ 
    message: 'ClinicalCanvas API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth/register, /api/auth/login',
      clients: '/api/clients',
      appointments: '/api/appointments',
      invoices: '/api/invoices',
      notes: '/api/notes',
      documents: '/api/documents',
      analytics: '/api/analytics/dashboard'
    }
  });
});

// Start server (only for local development)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`ClinicalCanvas API running on port ${PORT}`);
  });
}

// Export for Vercel
module.exports = app;
