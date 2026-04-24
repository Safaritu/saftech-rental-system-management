/* Saftech Pro Rental ERP (Frontend-only)
   - All data stored in localStorage under key: saftech_rental_db
   - Pages share this module via <script src="assets/app.js"></script>
*/

(() => {
  const DB_KEY = "saftech_rental_db";
  const SESSION_KEY = "saftech_rental_session";

  const UNIT_STATUSES = Object.freeze({
    VACANT: "Vacant",
    OCCUPIED_PENDING_READING: "Occupied (Pending Reading)",
    BILLED_WAITING_PAYMENT: "Billed (Waiting for Payment)",
    UNDER_REVIEW: "Under Review",
    PAID_CLEARED: "Paid (Cleared)",
  });

  function nowIso() {
    return new Date().toISOString();
  }

  function monthKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function money(n) {
    const v = Number(n || 0);
    return v.toLocaleString("en-KE");
  }

  function safeJsonParse(str, fallback) {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  function getDb() {
    const raw = localStorage.getItem(DB_KEY);
    const db = safeJsonParse(raw, null);
    return db && typeof db === "object" ? db : null;
  }

  function setDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  function seedDbIfMissing() {
    if (getDb()) return;

    const units = ["1A", "1B", "1C", "1D", "1E", "2A", "2B", "2C", "2D", "2E"].map((id, idx) => ({
      id,
      floor: id.startsWith("1") ? 1 : 2,
      rent: idx % 2 === 0 ? 15000 : 13000,
      tenantId: null,
      meter: {
        previous: 0,
        current: null,
        updatedAt: null,
      },
      status: UNIT_STATUSES.VACANT,
    }));

    const tenants = [
      { id: "t1", name: "John Mwangi", phone: "0712345678", unitId: "1A" },
      { id: "t2", name: "Mary Wanjiku", phone: "0798765432", unitId: "1C" },
      { id: "t3", name: "Peter Kamau", phone: "0700112233", unitId: "1E" },
      { id: "t4", name: "Asha Ali", phone: "0722334455", unitId: "2B" },
      { id: "t5", name: "Brian Otieno", phone: "0744556677", unitId: "2D" },
    ];

    // Link tenants to units
    for (const t of tenants) {
      const u = units.find((x) => x.id === t.unitId);
      if (!u) continue;
      u.tenantId = t.id;
      u.status = UNIT_STATUSES.OCCUPIED_PENDING_READING;
      u.meter.previous = 10 + Math.floor(Math.random() * 25);
      u.meter.updatedAt = nowIso();
    }

    const db = {
      meta: { createdAt: nowIso(), version: 1 },
      settings: {
        propertyName: "Saftech Resolutions Apartments",
        propertyLocation: "Nairobi",
        caretakerName: "Caretaker",
        caretakerPhone: "07XXXXXXXX",
        waterRate: 235,
        garbageFee: 100,
        currency: "KES",
      },
      auth: {
        staffPin: "1234", // demo pin (admin/caretaker)
      },
      units,
      tenants,
      bills: [],
      uploads: [], // tenant submissions (sms text / images)
      payments: [], // caretaker confirmations / auto matches
      notifications: [], // reminder log
    };

    setDb(db);
  }

  function requireDb() {
    seedDbIfMissing();
    const db = getDb();
    if (!db) throw new Error("DB init failed");
    return db;
  }

  function updateDb(mutator) {
    const db = requireDb();
    mutator(db);
    setDb(db);
    return db;
  }

  function getSession() {
    return safeJsonParse(localStorage.getItem(SESSION_KEY), null);
  }

  function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function guardStaff(page = "login.html") {
    const s = getSession();
    if (!s || (s.role !== "admin" && s.role !== "caretaker")) {
      window.location.href = page;
      return false;
    }
    return true;
  }

  function guardTenant(page = "login.html") {
    const s = getSession();
    if (!s || s.role !== "tenant") {
      window.location.href = page;
      return false;
    }
    return true;
  }

  function logout() {
    clearSession();
    window.location.href = "login.html";
  }

  function getTenantById(db, id) {
    return db.tenants.find((t) => t.id === id) || null;
  }

  function getUnitById(db, unitId) {
    return db.units.find((u) => u.id === unitId) || null;
  }

  function getTenantForUnit(db, unit) {
    if (!unit || !unit.tenantId) return null;
    return getTenantById(db, unit.tenantId);
  }

  function getOpenBillForUnit(db, unitId) {
    const mk = monthKey();
    const candidates = db.bills.filter((b) => b.unitId === unitId && b.monthKey === mk);
    const open = candidates.find((b) => b.status !== "Paid");
    return open || candidates[candidates.length - 1] || null;
  }

  /* ========= Billing engine =========
     Formula:
       waterUnits = (currentMeter - previousMeter)
       waterCost  = waterUnits * waterRate
       total      = waterCost + garbage + rent
  */
  function calculateBill({ previousMeter, currentMeter, waterRate, garbageFee, rent }) {
    const prev = Number(previousMeter);
    const curr = Number(currentMeter);
    const rate = Number(waterRate);
    const garb = Number(garbageFee);
    const r = Number(rent);

    const diff = curr - prev;
    if (!Number.isFinite(diff) || diff < 0) {
      return { ok: false, error: "Current meter must be >= previous meter." };
    }
    const waterUnits = diff;
    const waterCost = waterUnits * rate;
    const total = waterCost + garb + r;
    return {
      ok: true,
      previousMeter: prev,
      currentMeter: curr,
      waterUnits,
      waterRate: rate,
      waterCost,
      garbageFee: garb,
      rent: r,
      total,
    };
  }

  function generateBillForUnit(unitId, currentMeter) {
    return updateDb((db) => {
      const unit = getUnitById(db, unitId);
      if (!unit) throw new Error("Unit not found");
      if (!unit.tenantId) throw new Error("Unit is vacant");

      const prev = unit.meter.previous ?? 0;
      const calc = calculateBill({
        previousMeter: prev,
        currentMeter,
        waterRate: db.settings.waterRate,
        garbageFee: db.settings.garbageFee,
        rent: unit.rent,
      });
      if (!calc.ok) throw new Error(calc.error);

      const bill = {
        id: uid("bill"),
        unitId,
        tenantId: unit.tenantId,
        monthKey: monthKey(),
        createdAt: nowIso(),
        status: "Unpaid",
        breakdown: calc,
      };

      db.bills.push(bill);

      unit.meter.current = Number(currentMeter);
      unit.meter.updatedAt = nowIso();
      unit.status = UNIT_STATUSES.BILLED_WAITING_PAYMENT;
    });
  }

  function submitTenantSms({ unitId, tenantPhone, smsText, declaredAmount }) {
    return updateDb((db) => {
      const unit = getUnitById(db, unitId);
      if (!unit) throw new Error("Unit not found");
      const tenant = getTenantForUnit(db, unit);
      if (!tenant) throw new Error("Unit has no tenant");
      if (String(tenant.phone) !== String(tenantPhone)) throw new Error("Phone does not match tenant record");

      const bill = getOpenBillForUnit(db, unitId);
      if (!bill) throw new Error("No bill found for this unit");

      const upload = {
        id: uid("upl"),
        createdAt: nowIso(),
        type: "sms",
        unitId,
        tenantId: tenant.id,
        tenantPhone: tenant.phone,
        text: smsText,
        declaredAmount: declaredAmount != null ? Number(declaredAmount) : null,
        parsed: parseMpesaSms(smsText),
        status: "Under Review",
        linkedBillId: bill.id,
      };
      db.uploads.push(upload);
      unit.status = UNIT_STATUSES.UNDER_REVIEW;
    });
  }

  function parseMpesaSms(text) {
    const raw = String(text || "");

    // Amount: captures "Ksh 1,234.00" / "KES 1234" / "KSH1,234"
    const amountMatch = raw.match(/\b(?:KSH|Ksh|KES)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/);
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null;

    // Transaction code often like "QWE12ABC34" (10 chars) or similar
    const txMatch = raw.match(/\b[A-Z0-9]{10}\b/);
    const transactionCode = txMatch ? txMatch[0] : null;

    // Unit ID: allow "Unit 1A", "House 2C", or plain "1A"
    const unitMatch = raw.match(/\b(?:Unit|House|Room)\s*([12][A-E])\b/i) || raw.match(/\b([12][A-E])\b/);
    const unitId = unitMatch ? String(unitMatch[1]).toUpperCase() : null;

    return { amount, transactionCode, unitId };
  }

  function tryAutoMatchUploads() {
    return updateDb((db) => {
      const mk = monthKey();
      const pending = db.uploads.filter((u) => u.type === "sms" && u.status === "Under Review");

      for (const up of pending) {
        const unit = getUnitById(db, up.unitId);
        if (!unit) continue;

        const bill = db.bills.find((b) => b.id === up.linkedBillId) || getOpenBillForUnit(db, unit.id);
        if (!bill || bill.monthKey !== mk) continue;

        const paidAmount = up.parsed?.amount ?? up.declaredAmount;
        if (!paidAmount) continue;

        // Match if amounts are equal within 2 shillings (SMS rounding / formatting)
        const expected = Number(bill.breakdown.total);
        if (Math.abs(Number(paidAmount) - expected) <= 2) {
          // Create payment record and mark as paid
          const payment = {
            id: uid("pay"),
            createdAt: nowIso(),
            method: "Auto-SMS",
            unitId: unit.id,
            tenantId: bill.tenantId,
            billId: bill.id,
            amount: Number(paidAmount),
            transactionCode: up.parsed?.transactionCode || null,
            note: "Auto-matched from tenant SMS.",
          };
          db.payments.push(payment);
          up.status = "Matched";
          bill.status = "Paid";
          unit.status = UNIT_STATUSES.PAID_CLEARED;
          unit.meter.previous = unit.meter.current ?? unit.meter.previous;
          unit.meter.current = null;
        }
      }
    });
  }

  function markUnitPaidManual(unitId, note = "Marked as paid by caretaker.") {
    return updateDb((db) => {
      const unit = getUnitById(db, unitId);
      if (!unit) throw new Error("Unit not found");
      const bill = getOpenBillForUnit(db, unitId);
      if (!bill) throw new Error("No open bill for this unit");
      if (bill.status === "Paid") return;

      const payment = {
        id: uid("pay"),
        createdAt: nowIso(),
        method: "Manual",
        unitId,
        tenantId: bill.tenantId,
        billId: bill.id,
        amount: Number(bill.breakdown.total),
        transactionCode: null,
        note,
      };
      db.payments.push(payment);
      bill.status = "Paid";
      unit.status = UNIT_STATUSES.PAID_CLEARED;
      unit.meter.previous = unit.meter.current ?? unit.meter.previous;
      unit.meter.current = null;
    });
  }

  async function sendReminder(unitId) {
    seedDbIfMissing();
    const db = requireDb();
    const unit = getUnitById(db, unitId);
    const tenant = getTenantForUnit(db, unit);
    const msg = tenant
      ? `Reminder sent to ${tenant.name} (${tenant.phone}) for Unit ${unitId}.`
      : `Reminder logged for Unit ${unitId}.`;

    // Browser notification (if allowed), otherwise fallback alert
    try {
      if ("Notification" in window) {
        const perm = await Notification.requestPermission();
        if (perm === "granted") {
          new Notification("Saftech Pro Reminder", { body: msg });
        } else {
          alert(msg);
        }
      } else {
        alert(msg);
      }
    } catch {
      alert(msg);
    }

    updateDb((db2) => {
      db2.notifications.push({ id: uid("ntf"), createdAt: nowIso(), unitId, message: msg });
    });
  }

  function fmtStatusBadge(status) {
    if (status === UNIT_STATUSES.PAID_CLEARED) return "success";
    if (status === UNIT_STATUSES.BILLED_WAITING_PAYMENT) return "review";
    if (status === UNIT_STATUSES.UNDER_REVIEW) return "warning";
    if (status === UNIT_STATUSES.OCCUPIED_PENDING_READING) return "warning";
    return "neutral";
  }

  // Expose API for pages
  window.SaftechERP = {
    DB_KEY,
    SESSION_KEY,
    UNIT_STATUSES,
    seedDbIfMissing,
    requireDb,
    updateDb,
    getDb,
    setDb,
    getSession,
    setSession,
    guardStaff,
    guardTenant,
    logout,
    money,
    monthKey,
    calculateBill,
    generateBillForUnit,
    submitTenantSms,
    parseMpesaSms,
    tryAutoMatchUploads,
    markUnitPaidManual,
    sendReminder,
    getUnitById,
    getTenantForUnit,
    getOpenBillForUnit,
    fmtStatusBadge,
  };
})();

