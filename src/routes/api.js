const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../config/db'); 

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
        cb(null, `receipt_${Date.now()}_${Math.round(Math.random() * 1e9)}${safeExt}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
});

// 1. Fetch all units (Dashboard & Verification)
router.get('/units', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.*,
                    COALESCE(bc.bill_count, 0) AS bill_count
             FROM units u
             LEFT JOIN (
                SELECT unit_id, COUNT(*)::int AS bill_count
                FROM bills
                GROUP BY unit_id
             ) bc ON UPPER(bc.unit_id) = UPPER(u.id)
             ORDER BY u.id ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Fetch Error:", err.message);
        res.status(500).json({ error: "Could not fetch units" });
    }
});

// 1b. Get app settings (single-row table)
router.get('/settings', async (_req, res) => {
    try {
        await pool.query(
            `CREATE TABLE IF NOT EXISTS app_settings (
                id integer PRIMARY KEY,
                property_name text DEFAULT 'Saftech Resolutions Apartments',
                property_location text DEFAULT 'Nairobi',
                caretaker_name text DEFAULT 'Caretaker',
                caretaker_phone text DEFAULT '',
                water_rate numeric DEFAULT 235,
                garbage_fee numeric DEFAULT 100,
                staff_pin text DEFAULT '1234',
                updated_at timestamptz DEFAULT now()
            )`
        );
        await pool.query(
            `INSERT INTO app_settings (id)
             VALUES (1)
             ON CONFLICT (id) DO NOTHING`
        );
        const result = await pool.query(`SELECT * FROM app_settings WHERE id = 1`);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Could not fetch settings" });
    }
});

router.put('/settings', async (req, res) => {
    const {
        property_name,
        property_location,
        caretaker_name,
        caretaker_phone,
        water_rate,
        garbage_fee,
        staff_pin
    } = req.body;

    try {
        await pool.query(
            `CREATE TABLE IF NOT EXISTS app_settings (
                id integer PRIMARY KEY,
                property_name text DEFAULT 'Saftech Resolutions Apartments',
                property_location text DEFAULT 'Nairobi',
                caretaker_name text DEFAULT 'Caretaker',
                caretaker_phone text DEFAULT '',
                water_rate numeric DEFAULT 235,
                garbage_fee numeric DEFAULT 100,
                staff_pin text DEFAULT '1234',
                updated_at timestamptz DEFAULT now()
            )`
        );
        await pool.query(
            `INSERT INTO app_settings (id)
             VALUES (1)
             ON CONFLICT (id) DO NOTHING`
        );

        const result = await pool.query(
            `UPDATE app_settings
             SET property_name = COALESCE($1, property_name),
                 property_location = COALESCE($2, property_location),
                 caretaker_name = COALESCE($3, caretaker_name),
                 caretaker_phone = COALESCE($4, caretaker_phone),
                 water_rate = COALESCE($5, water_rate),
                 garbage_fee = COALESCE($6, garbage_fee),
                 staff_pin = COALESCE($7, staff_pin),
                 updated_at = NOW()
             WHERE id = 1
             RETURNING *`,
            [property_name, property_location, caretaker_name, caretaker_phone, water_rate, garbage_fee, staff_pin]
        );

        res.json({ success: true, settings: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: "Could not update settings" });
    }
});

// 2. Onboard Tenant
router.post('/units/:id/onboard', async (req, res) => {
    const { id } = req.params; 
    const { tenant_name, tenant_phone, base_rent, security_deposit } = req.body;
    try {
        await pool.query(
            `ALTER TABLE units
             ADD COLUMN IF NOT EXISTS security_deposit numeric DEFAULT 0`
        );
        const result = await pool.query(
            `UPDATE units SET 
                tenant_name = $1, 
                tenant_phone = $2, 
                base_rent = $3, 
                security_deposit = $4,
                status = 'Occupied', 
                updated_at = NOW() 
             WHERE UPPER(id) = UPPER($5) RETURNING *`,
            [tenant_name, tenant_phone, base_rent, security_deposit || 0, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Unit not found" });
        }
        res.json({ success: true, unit: result.rows[0] });
    } catch (err) {
        console.error("Onboard Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. Save Readings & Record Bill
router.post('/readings', async (req, res) => {
    const {
        unitId, current_reading, previous_reading, water_units, total_amount,
        water_charge, rent_amount, garbage_fee, deposit_amount
    } = req.body;
    try {
        // Start a transaction to ensure both updates happen together
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`ALTER TABLE units ADD COLUMN IF NOT EXISTS security_deposit numeric DEFAULT 0`);
            await client.query(`ALTER TABLE bills ADD COLUMN IF NOT EXISTS deposit_amount numeric(10, 2) DEFAULT 0`);

            const unitUpdate = await client.query(
                `UPDATE units SET 
                    previous_reading = $1, 
                    current_reading = $2, 
                    water_units = $3,
                    total_bill = $4,
                    updated_at = NOW() 
                 WHERE UPPER(id) = UPPER($5) RETURNING base_rent, garbage_fee, security_deposit`,
                [previous_reading, current_reading, water_units, total_amount, unitId]
            );

            if (unitUpdate.rowCount === 0) {
                throw new Error("Unit not found");
            }

            const baseRent = Number(rent_amount ?? unitUpdate.rows[0].base_rent ?? 0);
            const garbageFee = Number(garbage_fee ?? unitUpdate.rows[0].garbage_fee ?? 100);
            const deposit = Number(deposit_amount ?? 0);
            const waterCharge = Number(water_charge ?? (Number(total_amount || 0) - baseRent - garbageFee - deposit));

            await client.query(
                `INSERT INTO bills (unit_id, rent_amount, water_units, water_charge, garbage_fee, deposit_amount, total_amount, status) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')`,
                [unitId, baseRent, water_units, waterCharge, garbageFee, deposit, total_amount]
            );

            await client.query('COMMIT');
            console.log(`✅ Saftech: Bill recorded for Unit ${unitId}`);
            res.json({ success: true });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("❌ Sync Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 4. Fetch Pending Clearances (verify.html)
router.get('/payments/pending', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM units
             WHERE COALESCE(total_bill, 0) > 0
               AND COALESCE(tenant_name, '') <> ''
             ORDER BY id ASC`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Approve Payment (Atomic Update)
router.post('/payments/approve', async (req, res) => {
    const { unitId } = req.body;
    if (!unitId) {
        return res.status(400).json({ error: "unitId is required" });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Reset Unit balance
        const unitResult = await client.query(
            `UPDATE units
             SET total_bill = 0,
                 water_units = 0,
                 previous_reading = COALESCE(current_reading, previous_reading),
                 status = 'Paid (Cleared)',
                 updated_at = NOW()
             WHERE UPPER(id) = UPPER($1)
             RETURNING id`,
            [unitId]
        );
        if (unitResult.rowCount === 0) {
            throw new Error("Unit not found");
        }

        // Mark the most recent pending bill as Paid
        await client.query(
            `UPDATE bills
             SET status = 'Paid'
             WHERE id = (
                SELECT id FROM bills
                WHERE UPPER(unit_id) = UPPER($1) AND status = 'Pending'
                ORDER BY created_at DESC
                LIMIT 1
             )`,
            [unitId]
        );

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Approval Error:", err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 6. Fetch Payment History (tenant.html)
router.get('/payments/history/:unitId', async (req, res) => {
    const { unitId } = req.params;
    try {
        const result = await pool.query(
            `SELECT * FROM bills 
             WHERE UPPER(unit_id) = UPPER($1) 
             ORDER BY created_at DESC`,
            [unitId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("History Fetch Error:", err.message);
        res.status(500).json({ error: "Could not fetch history" });
    }
});

// 7. Tenant uploads M-Pesa confirmation for caretaker review
router.post('/payments/uploads', upload.single('receipt_image'), async (req, res) => {
    const { unitId, tenant_phone, message, tx_code } = req.body;
    if (!unitId || !message) {
        return res.status(400).json({ error: "unitId and message are required" });
    }

    try {
        const normalizedPhone = (tenant_phone || '').trim();
        let resolvedPhone = normalizedPhone;
        if (!resolvedPhone) {
            const unitInfo = await pool.query(
                `SELECT tenant_phone FROM units WHERE UPPER(id) = UPPER($1) LIMIT 1`,
                [unitId]
            );
            resolvedPhone = unitInfo.rows[0]?.tenant_phone || 'Unknown';
        }

        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
        const duplicate = await pool.query(
            `SELECT id
             FROM tenant_uploads
             WHERE UPPER(unit_id) = UPPER($1)
               AND (
                    ($2::varchar IS NOT NULL AND tx_code = $2)
                    OR message = $3
               )
             ORDER BY created_at DESC
             LIMIT 1`,
            [unitId, tx_code || null, message]
        );
        if (duplicate.rowCount > 0) {
            return res.status(409).json({ error: "Duplicate upload detected for this unit/message." });
        }
        const result = await pool.query(
            `INSERT INTO tenant_uploads (unit_id, tenant_phone, message, tx_code, image_url, status)
             VALUES ($1, $2, $3, $4, $5, 'Pending')
             RETURNING *`,
            [unitId, resolvedPhone, message, tx_code || null, imageUrl]
        );
        res.json({
            success: true,
            upload: result.rows[0],
            image_uploaded: Boolean(req.file),
        });
    } catch (err) {
        if (err.code === '42P01') {
            return res.status(500).json({ error: "tenant_uploads table is missing. Run the SQL migration first." });
        }
        if (err.code === '23505') {
            return res.status(409).json({
                error: "This M-Pesa code already exists. Please use another transaction code."
            });
        }
        console.error("Upload Save Error:", err.message);
        res.status(500).json({ error: "Could not save tenant upload" });
    }
});

// 8. Caretaker view of pending tenant upload confirmations
router.get('/payments/uploads/pending', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM tenant_uploads
             WHERE status = 'Pending'
             ORDER BY created_at ASC`
        );
        res.json(result.rows);
    } catch (err) {
        if (err.code === '42P01') {
            return res.json([]);
        }
        console.error("Upload Pending Error:", err.message);
        res.status(500).json({ error: "Could not fetch uploads" });
    }
});

// 8b. Latest upload per unit (any status) for verification context
router.get('/payments/uploads/latest', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT ON (unit_id) *
             FROM tenant_uploads
             ORDER BY unit_id, created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        if (err.code === '42P01') {
            return res.json([]);
        }
        console.error("Upload Latest Error:", err.message);
        res.status(500).json({ error: "Could not fetch latest uploads" });
    }
});

// 8c. Full uploads list for caretaker table
router.get('/payments/uploads', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM tenant_uploads
             ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        if (err.code === '42P01') {
            return res.json([]);
        }
        console.error("Upload List Error:", err.message);
        res.status(500).json({ error: "Could not fetch uploads list" });
    }
});

// 9. Review tenant upload proof (approve/reject)
router.post('/payments/uploads/:id/review', async (req, res) => {
    const { id } = req.params;
    const { action } = req.body;

    if (!['approve', 'reject'].includes(String(action || '').toLowerCase())) {
        return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const uploadResult = await client.query(
            `SELECT * FROM tenant_uploads WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (uploadResult.rowCount === 0) {
            throw new Error("Upload not found");
        }

        const uploadRow = uploadResult.rows[0];
        const isApprove = String(action).toLowerCase() === 'approve';
        const nextStatus = isApprove ? 'Approved' : 'Rejected';

        await client.query(
            `UPDATE tenant_uploads
             SET status = $1, updated_at = NOW()
             WHERE id = $2`,
            [nextStatus, id]
        );

        if (isApprove) {
            await client.query(
                `UPDATE units
                 SET total_bill = 0,
                     water_units = 0,
                     previous_reading = COALESCE(current_reading, previous_reading),
                     status = 'Paid (Cleared)',
                     updated_at = NOW()
                 WHERE UPPER(id) = UPPER($1)`,
                [uploadRow.unit_id]
            );

            await client.query(
                `UPDATE bills
                 SET status = 'Paid'
                 WHERE id = (
                    SELECT id FROM bills
                    WHERE UPPER(unit_id) = UPPER($1) AND status = 'Pending'
                    ORDER BY created_at DESC
                    LIMIT 1
                 )`,
                [uploadRow.unit_id]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, status: nextStatus });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Upload Review Error:", err.message);
        res.status(500).json({ error: err.message || "Could not review upload" });
    } finally {
        client.release();
    }
});

// 10. Queue bill statement SMS for one unit
router.post('/notifications/units/:unitId/statement', async (req, res) => {
    const { unitId } = req.params;
    try {
        await pool.query(
            `CREATE TABLE IF NOT EXISTS outbound_messages (
                id bigserial PRIMARY KEY,
                unit_id varchar(10),
                phone varchar(20),
                message text NOT NULL,
                status varchar(20) NOT NULL DEFAULT 'Queued',
                created_at timestamptz NOT NULL DEFAULT now()
            )`
        );

        const unitResult = await pool.query(
            `SELECT id, tenant_name, tenant_phone, total_bill
             FROM units
             WHERE UPPER(id) = UPPER($1)
             LIMIT 1`,
            [unitId]
        );
        if (unitResult.rowCount === 0) {
            return res.status(404).json({ error: "Unit not found" });
        }
        const unit = unitResult.rows[0];
        if (!unit.tenant_phone) {
            return res.status(400).json({ error: "Tenant phone missing for this unit" });
        }

        const msg = `SAFTECH: Hello ${unit.tenant_name || 'Tenant'}, Unit ${unit.id} bill is KES ${Number(unit.total_bill || 0).toLocaleString()}. Please pay by due date.`;
        await pool.query(
            `INSERT INTO outbound_messages (unit_id, phone, message, status)
             VALUES ($1, $2, $3, 'Queued')`,
            [unit.id, unit.tenant_phone, msg]
        );

        res.json({ success: true, queued: 1 });
    } catch (err) {
        console.error("Statement Queue Error:", err.message);
        res.status(500).json({ error: "Could not queue statement SMS" });
    }
});

// 11. Queue reminder SMS for all due tenants by date
router.post('/notifications/reminders/queue', async (req, res) => {
    const { dueDate } = req.body;
    if (!dueDate) {
        return res.status(400).json({ error: "dueDate is required (YYYY-MM-DD)" });
    }
    try {
        await pool.query(
            `CREATE TABLE IF NOT EXISTS outbound_messages (
                id bigserial PRIMARY KEY,
                unit_id varchar(10),
                phone varchar(20),
                message text NOT NULL,
                status varchar(20) NOT NULL DEFAULT 'Queued',
                created_at timestamptz NOT NULL DEFAULT now()
            )`
        );

        const units = await pool.query(
            `SELECT id, tenant_name, tenant_phone, total_bill, rent_due_date
             FROM units
             WHERE COALESCE(total_bill, 0) > 0
               AND COALESCE(tenant_phone, '') <> ''
               AND rent_due_date IS NOT NULL
               AND rent_due_date <= $1::date`,
            [dueDate]
        );

        for (const u of units.rows) {
            const msg = `SAFTECH REMINDER: Hello ${u.tenant_name || 'Tenant'}, Unit ${u.id} bill balance is KES ${Number(u.total_bill || 0).toLocaleString()}. Due date: ${u.rent_due_date}.`;
            await pool.query(
                `INSERT INTO outbound_messages (unit_id, phone, message, status)
                 VALUES ($1, $2, $3, 'Queued')`,
                [u.id, u.tenant_phone, msg]
            );
        }

        res.json({ success: true, queued: units.rowCount, dueDate });
    } catch (err) {
        console.error("Reminder Queue Error:", err.message);
        res.status(500).json({ error: "Could not queue reminders" });
    }
});

module.exports = router;