// middleware/auth.js
import { parse } from 'cookie';

export async function requireAuth(req, res, next) {
  try {
    const cookies = parse(req.headers.cookie || '');
    const sessionId = cookies.session_id;

    if (!sessionId) {
      return res.status(401).json({ error: 'Unauthorized - No session' });
    }

    // Validate session from database
    const session = await db.query(
      `SELECT s.*, u.id as user_id, u.email, u.role 
       FROM sessions s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [sessionId]
    );

    if (session.rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid session' });
    }

    // Attach user to request
    req.user = session.rows[0];
    
    if (next) next();
    return req.user;
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

export async function requirePatientAccess(req, res, patientId) {
  const user = req.user;

  // Check if user has permission to access this patient
  const permission = await db.query(
    `SELECT * FROM user_permissions 
     WHERE user_id = $1 AND patient_id = $2 AND can_view_forms = true`,
    [user.user_id, patientId]
  );

  // Or if user is the patient themselves
  const isOwnPatient = await db.query(
    `SELECT * FROM patients WHERE id = $1 AND user_id = $2`,
    [patientId, user.user_id]
  );

  if (permission.rows.length === 0 && isOwnPatient.rows.length === 0) {
    return res.status(403).json({ error: 'Forbidden - No access to this patient' });
  }

  return true;
}

export async function logFormAccess(userId, patientId, formType, action, req) {
  const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  await db.query(
    `INSERT INTO form_audit_log (user_id, patient_id, form_type, action, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, patientId, formType, action, ipAddress, userAgent]
  );
}
